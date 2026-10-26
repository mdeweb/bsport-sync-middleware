import { BsportClient } from "./bsport-client.js";
import { collectBsport, mergeWithExisting, toMember, cleanEmail } from "./bsport-collect.js";
import { SyncState, addDays } from "./state.js";
import { localParts } from "./scheduler.js";
import { BrevoClient } from "./brevo-client.js";
import { ExclusionList } from "./exclusions.js";
import { dedupeSms, isValidEmail, mergeDuplicates, toBrevoContact } from "./mapper.js";
import { log, sendAlert } from "./logger.js";

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Calcule tout ce que la synchro doit faire, sans rien écrire.
 * members : membres normalisés Bsport. brevoContacts : contacts déjà présents dans la liste Brevo.
 */
export function buildPlan({ members, brevoContacts, exclusions, config, now = new Date() }) {
  const report = {
    bsportTotal: members.length,
    invalid: 0,
    excluded: 0,
    duplicatesMerged: 0,
    smsDuplicatesRemoved: 0,
    staff: 0,
    optin: 0,
    nonOptin: 0,
    emailChanges: 0,
    toUnblock: 0,
    toDelete: 0,
    orphans: 0,
    deletionsBlocked: false,
  };

  // 1. Fiches exploitables uniquement (identifiant et email valides).
  const valid = members.filter((m) => m.id && isValidEmail(m.email));
  report.invalid = members.length - valid.length;
  const bsportIds = new Set(valid.map((m) => m.id));
  const bsportEmails = new Set(valid.map((m) => m.email));

  // 2. Droit à l'oubli.
  const allowed = valid.filter((m) => !exclusions.has(m.email));
  report.excluded = valid.length - allowed.length;

  // 3. Une seule fiche par email.
  const merged = mergeDuplicates(allowed);
  report.duplicatesMerged = allowed.length - merged.length;

  // 4. Changements d'email : même identifiant Bsport, adresse différente dans Brevo.
  const brevoByEmail = new Map(brevoContacts.map((c) => [String(c.email).toLowerCase(), c]));
  const brevoById = new Map();
  for (const contact of brevoContacts) {
    const id = contact.attributes && contact.attributes.BSPORT_ID;
    if (id) brevoById.set(String(id), contact);
  }
  const emailChanges = [];
  for (const member of merged) {
    const existing = brevoById.get(member.id);
    if (!existing) continue;
    const oldEmail = String(existing.email).toLowerCase();
    if (oldEmail !== member.email && !brevoByEmail.has(member.email)) {
      emailChanges.push({ id: member.id, oldEmail, newEmail: member.email });
    }
  }
  report.emailChanges = emailChanges.length;

  // 5. Répartition : staff, accord marketing, sans accord.
  const batches = { optin: [], nonOptin: [], staffOptin: [], staffNonOptin: [] };
  const unblock = [];
  for (const member of merged) {
    const contact = toBrevoContact(member, config, now);
    const hasOptin = member.optinEmail === true; // accord inconnu = pas d'accord
    // Contact que la synchro avait bloqué faute d'accord, et qui a donné son accord depuis dans Bsport.
    // Un contact désinscrit par lui-même dans Brevo (ACCEPT_EMAIL resté à true) n'est jamais débloqué.
    const existing = brevoByEmail.get(member.email);
    if (hasOptin && existing && existing.emailBlacklisted === true && existing.attributes?.ACCEPT_EMAIL === false) {
      unblock.push(member.email);
    }
    if (member.isStaff) {
      report.staff += 1;
      (hasOptin ? batches.staffOptin : batches.staffNonOptin).push(contact);
      continue;
    }
    if (hasOptin) {
      report.optin += 1;
      batches.optin.push(contact);
    } else {
      report.nonOptin += 1;
      // Mode "skip" : on ne crée pas le contact, mais s'il existe déjà on le bloque à l'envoi.
      if (config.nonOptinMode === "blacklist" || brevoByEmail.has(member.email)) batches.nonOptin.push(contact);
    }
  }
  report.toUnblock = unblock.length;
  const sms = dedupeSms([
    ...batches.optin,
    ...batches.nonOptin,
    ...batches.staffOptin,
    ...batches.staffNonOptin,
  ]);
  report.smsDuplicatesRemoved = sms.removed;
  report.smsNumerosPartages = sms.sharedNumbers;
  report.smsContactsNumeroPartage = sms.sharedContacts;
  report.smsMaxContactsMemeNumero = sms.maxShare;

  // 6. Suppressions : contacts Brevo dont le membre n'existe plus dans Bsport, ou exclus.
  const movedEmails = new Set(emailChanges.map((c) => c.oldEmail));
  const toDelete = [];
  for (const contact of brevoContacts) {
    const email = String(contact.email).toLowerCase();
    const id = contact.attributes && contact.attributes.BSPORT_ID ? String(contact.attributes.BSPORT_ID) : null;
    if (exclusions.has(email)) {
      toDelete.push({ email, reason: "exclusion" });
    } else if (id && !bsportIds.has(id) && !movedEmails.has(email)) {
      toDelete.push({ email, reason: "supprimé dans Bsport" });
    } else if (!id && !bsportEmails.has(email)) {
      report.orphans += 1; // ancien import manuel, inconnu de Bsport : laissé tel quel, à arbitrer
    }
  }
  const limit = Math.max(config.maxDeleteCount, Math.floor(brevoContacts.length * config.maxDeleteRatio));
  const unexpected = toDelete.filter((d) => d.reason !== "exclusion");
  if (unexpected.length > limit) {
    report.deletionsBlocked = true;
    report.deletionsRequested = unexpected.length;
    report.deletionsLimit = limit;
  }
  const deletions = report.deletionsBlocked ? toDelete.filter((d) => d.reason === "exclusion") : toDelete;
  report.toDelete = deletions.length;

  return { report, batches, emailChanges, unblock, deletions };
}

/** Exécute une synchro. Renvoie le rapport. */
export async function runSync(config, { fetchImpl = fetch, now = new Date(), forceFull = false, contactsOnly = false, onProgress = null } = {}) {
  const startedAt = Date.now();
  const bsport = new BsportClient(config, fetchImpl);
  if (onProgress) bsport.onProgress = onProgress;
  const brevo = new BrevoClient(config, fetchImpl);
  const exclusions = new ExclusionList(config.dataDir);
  const state = new SyncState(config.dataDir);
  const canReadBrevo = Boolean(config.brevoApiKey && config.brevoListId);

  // Jour courant à Paris. Réservations et factures sont comptées jusqu'à la veille incluse.
  const realToday = localParts(now, config.timezone).day;
  // Premier démarrage sur un nouveau serveur : BREVO_LAST_DAY indique le dernier jour déjà importé.
  if (!state.lastDay && config.initialLastDay) state.lastDay = config.initialLastDay;
  const mode = contactsOnly ? "contacts" : forceFull || !state.lastDay ? "full" : "delta";
  const since = mode === "delta" ? addDays(state.lastDay, 1) : null;
  // Passage complet interrompu (ou fait à blanc) : on reprend là où il s'était arrêté, avec la même date de fin.
  const checkpoint = mode === "full" ? state.loadBackfill() : null;
  const today = checkpoint?.today || realToday;
  const onStudioDone =
    mode === "full"
      ? ({ doneStudios, activity }) => {
          state.saveBackfill({ today, doneStudios, activity: activity.snapshot() });
          log("info", "Studio terminé, reprise possible à partir d'ici", { studios: doneStudios.length });
        }
      : null;

  try {
    // Lecture complète de Bsport d'abord : en cas d'échec on s'arrête avant toute écriture.
    const data = await collectBsport(bsport, config, { mode, since, today, studioClients: state.studioClients, checkpoint, onStudioDone });
    if (data.sanctuary.length === 0) {
      throw new Error("Bsport a renvoyé 0 membre : synchro annulée par sécurité.");
    }
    const brevoContacts = canReadBrevo ? await brevo.listContacts(config.brevoListId) : [];
    const brevoByEmail = new Map(brevoContacts.map((c) => [String(c.email).toLowerCase(), c]));
    let members = data.sanctuary.map((c) => toMember(c, data.activity.get(cleanEmail(c.email)), config, { full: mode === "full" }));
    if (mode === "delta") {
      members = members.map((m) => mergeWithExisting(m, brevoByEmail.get(m.email)?.attributes));
    }
    const plan = buildPlan({ members, brevoContacts, exclusions, config, now });
    const report = {
      ...plan.report,
      mode,
      window: mode === "delta" ? `${since} → ${addDays(today, -1)}` : mode === "full" ? `historique → ${addDays(today, -1)}` : "contacts seuls",
      resumedStudios: checkpoint?.doneStudios?.length || 0,
      unmatchedActivity: data.activity.unmatched,
      dryRun: !config.enabled,
      brevoBefore: brevoContacts.length,
      errors: [],
    };

    if (!config.enabled) {
      log("info", "Synchro à blanc terminée (rien n'a été écrit dans Brevo)", report);
      return report;
    }

    // Changements d'email avant l'import, pour mettre à jour le contact au lieu d'en créer un second.
    for (const change of plan.emailChanges) {
      try {
        await brevo.updateContactEmail(change.oldEmail, change.newEmail);
      } catch (err) {
        report.errors.push(`Changement d'email ${change.id} : ${err.message}`);
      }
    }

    const imports = [
      { contacts: plan.batches.optin, listIds: [config.brevoListId], emailBlacklist: false },
      { contacts: plan.batches.nonOptin, listIds: [config.brevoListId], emailBlacklist: true },
    ];
    if (config.brevoStaffListId) {
      imports.push({ contacts: plan.batches.staffOptin, listIds: [config.brevoStaffListId], emailBlacklist: false });
      imports.push({ contacts: plan.batches.staffNonOptin, listIds: [config.brevoStaffListId], emailBlacklist: true });
    }
    report.importProcesses = [];
    for (const batch of imports) {
      for (const contacts of chunk(batch.contacts, config.brevoBatchSize)) {
        try {
          const result = await brevo.importContacts({ ...batch, contacts });
          report.importProcesses.push(result.processId);
        } catch (err) {
          report.errors.push(`Import de ${contacts.length} contacts : ${err.message}`);
        }
      }
    }

    // Aucun déblocage automatique : un contact bloqué dans Brevo (désinscription, hard bounce,
    // plainte) le reste. report.toUnblock indique seulement combien auraient pu l'être.

    report.deleted = 0;
    for (const deletion of plan.deletions) {
      try {
        await brevo.deleteContact(deletion.email);
        report.deleted += 1;
      } catch (err) {
        if (err.status !== 404) report.errors.push(`Suppression : ${err.message}`);
      }
    }

    report.durationMs = Date.now() - startedAt;
    // L'état n'avance que si tout s'est bien passé : sinon la prochaine synchro reprend la même fenêtre.
    if (!report.errors.length && mode !== "contacts") {
      state.lastDay = addDays(today, -1);
      state.save();
      if (mode === "full") state.clearBackfill();
    }
    if (report.deletionsBlocked) {
      await sendAlert(config, "Suppressions bloquées : trop de contacts à supprimer d'un coup, à vérifier.", {
        requested: report.deletionsRequested,
        limit: report.deletionsLimit,
      });
    }
    if (report.errors.length) {
      await sendAlert(config, `Synchro terminée avec ${report.errors.length} erreur(s).`, { errors: report.errors.slice(0, 10) });
    }
    log("info", "Synchro Brevo terminée", report);
    return report;
  } catch (err) {
    await sendAlert(config, `Synchro interrompue : ${err.message}`);
    throw err;
  }
}
