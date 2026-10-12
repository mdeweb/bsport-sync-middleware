import { PATHS } from "./bsport-client.js";

/**
 * Collecte Bsport pour la synchro Brevo.
 *
 * - La base de contacts est celle du Sanctuary Pass (studio 4781), relue en entier à chaque synchro
 *   pour suivre les consentements et les suppressions.
 * - L'activité (abonnements, carnets, réservations, achats) est lue dans les studios des marques
 *   et rattachée au membre par son email, car un même membre a un identifiant différent par studio.
 * - Mode "full" : tout l'historique, une seule fois. Mode "delta" : seulement les réservations et
 *   factures des jours écoulés depuis la dernière synchro, ajoutées aux totaux déjà dans Brevo.
 * - Tout est traité page par page : rien n'oblige à garder des millions de réservations en mémoire.
 * - Les notes clients (qui peuvent contenir des informations médicales) ne sont jamais lues.
 */

const SUB_STATUS = { 0: "Non démarré", 1: "En cours", 2: "Arrêté", 3: "En pause", 4: "Terminé" };

const idOf = (value) => (value && typeof value === "object" ? value.id : value);
const day = (value) => (value ? String(value).slice(0, 10) : undefined);
const maxDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const minDate = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const money = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};
export const cleanEmail = (email) => (email ? String(email).trim().toLowerCase() : undefined);

/** Fiche Sanctuary Pass réduite aux champs utiles (les notes et documents ne sont pas conservés). */
export function slimClient(c) {
  return {
    id: c.id,
    email: c.email,
    firstname: c.firstname,
    lastname: c.lastname,
    phone_number: c.phone_number,
    gender: c.gender,
    zip: c.address?.zip_code,
    city: c.address?.city,
    joined_date: c.joined_date,
    is_email_accepted: c.is_email_accepted,
    is_sms_accepted: c.is_sms_accepted,
    is_archived: c.is_archived,
  };
}

function emptyActivity() {
  return {
    studios: new Map(), // nom du studio → nombre de séances
    firstJoined: undefined,
    subscription: undefined,
    creditsLeft: 0,
    hasActivePass: false,
    passName: undefined,
    passEnd: undefined,
    lastBooking: undefined,
    bookingsCount: 0,
    totalSpent: 0,
    purchasesCount: 0,
    lastPurchase: undefined,
  };
}

/** Garde l'abonnement le plus pertinent : en cours ou en pause d'abord, sinon le plus récent. */
function betterSubscription(current, candidate) {
  if (!current) return candidate;
  const rank = (s) => (s.status === 1 ? 3 : s.status === 3 ? 2 : s.status === 0 ? 1 : 0);
  if (rank(candidate) !== rank(current)) return rank(candidate) > rank(current) ? candidate : current;
  return (candidate.created_at || "") > (current.created_at || "") ? candidate : current;
}

/**
 * Agrège l'activité par email, au fil des pages.
 * since/until : fenêtre [since, until) appliquée aux réservations et factures (since vide = pas de borne basse).
 */
export class ActivityAggregator {
  constructor({ today, since = null, until = today, studioClients = {} }) {
    this.today = today;
    this.since = since;
    this.until = until;
    this.studioClients = studioClients; // { studioId: { clientId: email } }, modifié en place
    this.byEmail = new Map();
    this.unmatched = 0; // activité d'un membre de studio inconnu (sans email)
  }

  inWindow(d) {
    return Boolean(d) && (!this.since || d >= this.since) && d < this.until;
  }

  activity(email) {
    let a = this.byEmail.get(email);
    if (!a) {
      a = emptyActivity();
      this.byEmail.set(email, a);
    }
    return a;
  }

  emailFor(studioId, clientRef) {
    const map = this.studioClients[studioId];
    return map ? map[String(idOf(clientRef))] : undefined;
  }

  forClient(studioId, clientRef) {
    // Fiche jointe par Bsport (expand[]=client_id) : l'email est directement dans la ligne.
    if (clientRef && typeof clientRef === "object" && clientRef.email !== undefined) {
      const email = cleanEmail(clientRef.email);
      if (!email) {
        this.unmatched += 1;
        return undefined;
      }
      const a = this.activity(email);
      a.firstJoined = minDate(a.firstJoined, day(clientRef.joined_date));
      return a;
    }
    const email = this.emailFor(studioId, clientRef);
    if (!email) {
      this.unmatched += 1;
      return undefined;
    }
    return this.activity(email);
  }

  addClients(studioId, studioName, rows) {
    if (!this.studioClients[studioId]) this.studioClients[studioId] = {};
    const map = this.studioClients[studioId];
    for (const c of rows) {
      const email = cleanEmail(c.email);
      if (!email) continue;
      map[String(c.id)] = email;
      const a = this.activity(email);
      if (!a.studios.has(studioName)) a.studios.set(studioName, 0);
      a.firstJoined = minDate(a.firstJoined, day(c.joined_date));
    }
  }

  addSubscriptions(studioId, rows) {
    for (const s of rows) {
      const a = this.forClient(studioId, s.client_id);
      if (a) a.subscription = betterSubscription(a.subscription, s);
    }
  }

  addClassPasses(studioId, rows) {
    for (const p of rows) {
      if (p.is_disabled) continue;
      const end = day(p.ending_date);
      if (end && end < this.today) continue;
      const a = this.forClient(studioId, p.client_id);
      if (!a) continue;
      a.creditsLeft += Number(p.available_credits_amount) || 0;
      a.hasActivePass = true;
      const name = p.class_pass_id && typeof p.class_pass_id === "object" ? p.class_pass_id.name : undefined;
      if (name) a.passName = name;
      a.passEnd = maxDate(a.passEnd, end);
    }
  }

  addBookings(studioId, studioName, rows) {
    for (const b of rows) {
      if (b.has_attended === false) continue;
      const d = day(b.class_start_at);
      if (!this.inWindow(d)) continue;
      const a = this.forClient(studioId, b.client_id);
      if (!a) continue;
      a.bookingsCount += 1;
      a.lastBooking = maxDate(a.lastBooking, d);
      a.studios.set(studioName, (a.studios.get(studioName) || 0) + 1);
    }
  }

  addInvoices(studioId, rows) {
    for (const inv of rows) {
      if (inv.canceled_at) continue;
      const paid = money(inv.paid_amount);
      if (paid <= 0) continue;
      const d = day(inv.issued_at || inv.created_at);
      if (!this.inWindow(d)) continue;
      const a = this.forClient(studioId, inv.client_id);
      if (!a) continue;
      a.totalSpent += paid;
      a.purchasesCount += 1;
      a.lastPurchase = maxDate(a.lastPurchase, d);
    }
  }

  get(email) {
    return this.byEmail.get(email);
  }

  /** Copie sérialisable (pour reprendre un passage complet interrompu). */
  snapshot() {
    return [...this.byEmail].map(([email, a]) => [email, { ...a, studios: [...a.studios] }]);
  }

  restore(entries) {
    for (const [email, a] of entries) this.byEmail.set(email, { ...a, studios: new Map(a.studios) });
  }
}

/** Fenêtres mensuelles [début, fin) entre deux dates, pour éviter la pagination profonde. */
export function monthWindows(from, to) {
  const windows = [];
  let cursor = `${from.slice(0, 7)}-01`;
  while (cursor < to) {
    const d = new Date(`${cursor}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const next = d.toISOString().slice(0, 10);
    windows.push([cursor < from ? from : cursor, next < to ? next : to]);
    cursor = next;
  }
  return windows;
}

function monthsBefore(dayText, months) {
  const d = new Date(`${dayText}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Lit Bsport et renvoie { sanctuary, activity }.
 * - mode "contacts" : seulement la base Sanctuary Pass, sans activité (premier import rapide).
 * - mode "full" : tout l'historique, lu mois par mois ; reprise possible studio par studio (checkpoint).
 * - mode "delta" : réservations et factures de la fenêtre [since, today).
 */
export async function collectBsport(client, config, { mode, since, today, studioClients, checkpoint = null, onStudioDone = null }) {
  const activity = new ActivityAggregator({ today, since: mode === "delta" ? since : null, studioClients });
  if (checkpoint?.activity) activity.restore(checkpoint.activity);
  const doneStudios = new Set(checkpoint?.doneStudios || []);

  if (mode !== "contacts") {
    for (const [studioId, studioName] of Object.entries(config.sourceStudios)) {
      if (mode === "full" && doneStudios.has(studioId)) continue; // déjà lu lors d'un passage interrompu
      await collectStudio(client, config, activity, { mode, since, today, studioId, studioName });
      doneStudios.add(studioId);
      if (onStudioDone) await onStudioDone({ studioId, doneStudios: [...doneStudios], activity });
    }
  }

  // Base Sanctuary Pass lue en dernier : c'est l'état le plus frais au moment de l'import.
  const sanctuary = [];
  await client.forEachPage(PATHS.clients, config.bsportCompanyId, {}, (rows) => {
    for (const c of rows) sanctuary.push(slimClient(c));
  });
  return { sanctuary, activity };
}

// Chaque ligne arrive avec la fiche du membre (et donc son email) : plus besoin de relire
// les ~400 000 fiches de chaque studio pour savoir à qui appartient une réservation.
const EXPAND = { "expand[]": "client_id" };

async function collectStudio(client, config, activity, { mode, since, today, studioId, studioName }) {
  // Abonnements : état courant, relus en entier.
  await client.forEachPage(PATHS.subscriptions, studioId, { ...EXPAND }, (rows) => activity.addSubscriptions(studioId, rows));
  // Carnets actifs (désactivés par défaut, voir config.readClassPasses).
  if (config.readClassPasses) {
    await client.forEachPage(PATHS.classPasses, studioId, { ...EXPAND, is_disabled: "false", has_credits_available: "true" }, (rows) =>
      activity.addClassPasses(studioId, rows)
    );
  }
  if (mode === "delta" && since && since >= today) return; // déjà compté aujourd'hui
  const windows = mode === "delta" && since ? [[since, today]] : monthWindows(config.backfillFrom, today);
  for (const [from, to] of windows) {
    await client.forEachPage(
      PATHS.bookings,
      studioId,
      { ...EXPAND, has_attended: "true", class_started_after_date: from, class_started_before_date: to },
      (rows) => activity.addBookings(studioId, studioName, rows)
    );
    await client.forEachPage(PATHS.invoices, studioId, { ...EXPAND, created_after: from, created_before: to }, (rows) =>
      activity.addInvoices(studioId, rows)
    );
  }
}

function addDay(d, n) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** Membre normalisé (format attendu par mapper.js). */
export function toMember(spClient, activity, config, { full = false } = {}) {
  const a = activity || emptyActivity();
  const optin = (value) => (value === undefined || value === null ? (config.unknownOptinIsOptin ? true : undefined) : Boolean(value));
  const studios = [...a.studios.entries()];
  const main = [...studios].sort((x, y) => y[1] - x[1])[0];
  const sub = a.subscription;
  return {
    id: spClient.id !== undefined ? String(spClient.id) : undefined,
    email: cleanEmail(spClient.email),
    firstName: spClient.firstname || undefined,
    lastName: spClient.lastname || undefined,
    phone: spClient.phone_number || undefined,
    gender: spClient.gender || undefined,
    zip: spClient.zip || spClient.address?.zip_code || undefined,
    city: spClient.city || spClient.address?.city || undefined,
    joinedAt: minDate(day(spClient.joined_date), a.firstJoined),
    optinEmail: optin(spClient.is_email_accepted),
    optinSms: optin(spClient.is_sms_accepted),
    optinDate: undefined, // la date du consentement n'est pas exposée par l'API
    archived: spClient.is_archived === true,
    isStaff: false,
    secondaryEmail: undefined,
    mainStudio: main ? main[0] : undefined,
    studios: studios.map(([name]) => name),
    passType: sub?.name || (a.hasActivePass ? a.passName || "Carnet" : undefined),
    subStatus: sub ? SUB_STATUS[sub.status] : a.hasActivePass ? "Carnet actif" : undefined,
    subStart: sub ? day(sub.first_billing_date || sub.created_at) : undefined,
    subEnd: sub && (sub.status === 2 || sub.status === 4) ? day(sub.last_billing_date) : a.passEnd,
    // Carnets lus : 0 si plus aucun carnet actif. Carnets non lus : vide, Brevo garde sa valeur.
    creditsLeft: a.hasActivePass ? a.creditsLeft : config.readClassPasses ? 0 : undefined,
    lastBooking: a.lastBooking,
    // Mode complet : 0 explicite, pour écraser les valeurs de l'ancien import. Mode delta : vide = inchangé.
    bookingsCount: a.bookingsCount || (full ? 0 : undefined),
    disciplines: [],
    totalSpent: a.totalSpent ? Math.round(a.totalSpent * 100) / 100 : full ? 0 : undefined,
    purchasesCount: a.purchasesCount || (full ? 0 : undefined),
    lastPurchase: a.lastPurchase,
    source: undefined,
  };
}

/**
 * Mode delta : ajoute l'activité des derniers jours aux totaux déjà présents dans Brevo.
 * Sans nouvelle activité, les champs restent vides et Brevo garde ses valeurs.
 */
export function mergeWithExisting(member, attrs) {
  if (!attrs) return member;
  const m = { ...member };
  const num = (v) => Number(v) || 0;
  if (member.bookingsCount) m.bookingsCount = member.bookingsCount + num(attrs.ATTENDED_BOOKINGS);
  if (member.totalSpent) m.totalSpent = Math.round((member.totalSpent + num(attrs.TOTAL_PAID_AMOUNT)) * 100) / 100;
  if (member.purchasesCount) m.purchasesCount = member.purchasesCount + num(attrs.TOTAL_PAID_COUNTS);
  m.lastBooking = maxDate(member.lastBooking, day(attrs.LAST_BOOKING_DATE));
  m.previousActivity = day(attrs.DATE_DERNIERE_ACTIVITE);
  m.joinedAt = minDate(member.joinedAt, day(attrs.FIRST_DATE_JOINED));
  const previous = attrs.STUDIOS_FREQUENTES ? String(attrs.STUDIOS_FREQUENTES).split(", ").filter(Boolean) : [];
  m.studios = [...new Set([...previous, ...member.studios])];
  m.mainStudio = attrs.STUDIO_PRINCIPAL || member.mainStudio;
  return m;
}
