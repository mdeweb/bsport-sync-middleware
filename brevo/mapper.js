import { brandAttributeName } from "./attributes.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email) {
  return typeof email === "string" && EMAIL_RE.test(email);
}

/**
 * Adresse relais d'une plateforme partenaire (ClassPass, Gymlib) : la plateforme rejette les emails
 * marketing (hard bounce). Ces contacts sont importés mais toujours bloqués à l'envoi (demande TSG du 27/10/2026).
 */
const RELAY_EMAIL = /@(members\.classpass\.com|([a-z0-9-]+\.)*gymlib\.com)$/i;
export function isRelayEmail(email) {
  return typeof email === "string" && RELAY_EMAIL.test(email.trim());
}

/** Numéro au format international pour l'attribut SMS de Brevo. Renvoie undefined si inexploitable. */
export function normalizePhone(phone, defaultPrefix = "33") {
  if (!phone) return undefined;
  let digits = String(phone).replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("+")) {
    const rest = digits.slice(1).replace(/\D/g, "");
    return rest.length >= 8 && rest.length <= 15 ? `+${rest}` : undefined;
  }
  if (digits.startsWith("0") && digits.length === 10) return `+${defaultPrefix}${digits.slice(1)}`;
  return undefined;
}

function latest(...dates) {
  const valid = dates.filter(Boolean).sort();
  return valid.length ? valid[valid.length - 1] : undefined;
}

function daysBetween(dateText, now) {
  return Math.floor((now.getTime() - new Date(`${dateText}T00:00:00Z`).getTime()) / 86400000);
}

/** Date la plus récente entre le dernier achat et la dernière réservation (définition TSG). */
export function lastActivity(member) {
  return latest(member.lastPurchase, member.lastBooking, member.previousActivity);
}

export function memberStatus(member, config, now = new Date()) {
  const activity = lastActivity(member) || member.joinedAt;
  if (!activity) return undefined;
  return daysBetween(activity, now) > config.formerMemberDays ? "Ancien membre" : "Actif";
}

/**
 * Fusionne plusieurs fiches Bsport qui partagent le même email en une seule.
 * La fiche la plus récemment active sert de base, les studios et disciplines sont réunis.
 */
export function mergeDuplicates(members) {
  const byEmail = new Map();
  for (const member of members) {
    const current = byEmail.get(member.email);
    if (!current) {
      byEmail.set(member.email, { ...member, studios: [...member.studios], disciplines: [...member.disciplines] });
      continue;
    }
    const newer = (lastActivity(member) || member.joinedAt || "") > (lastActivity(current) || current.joinedAt || "");
    const base = newer ? member : current;
    const other = newer ? current : member;
    const merged = { ...other, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) };
    merged.studios = [...new Set([...current.studios, ...member.studios])];
    merged.disciplines = [...new Set([...current.disciplines, ...member.disciplines])];
    merged.optinEmail = current.optinEmail === false || member.optinEmail === false ? false : base.optinEmail;
    merged.isStaff = current.isStaff || member.isStaff;
    byEmail.set(member.email, merged);
  }
  return [...byEmail.values()];
}

function clean(attributes) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

/** Membre normalisé → contact Brevo { email, attributes }. */
export function toBrevoContact(member, config, now = new Date()) {
  const attributes = {
    PRENOM: member.firstName,
    NOM: member.lastName,
    GENRE: member.gender,
    CODE_POSTAL: member.zip,
    CITY: member.city,
    BSPORT_ID: member.id,
    EMAIL_2: member.secondaryEmail,
    FIRST_DATE_JOINED: member.joinedAt,
    STUDIO_PRINCIPAL: member.mainStudio,
    STUDIOS_FREQUENTES: member.studios.length ? member.studios.join(", ") : member.mainStudio === "Aucun" ? "Aucun" : undefined,
    TYPE_PASS: member.passType,
    STATUT_ABO: member.subStatus,
    DATE_DEBUT_ABO: member.subStart,
    DATE_FIN_ABO: member.subEnd,
    REMAINING_CREDITS: member.creditsLeft,
    LAST_BOOKING_DATE: member.lastBooking,
    ATTENDED_BOOKINGS: member.bookingsCount,
    DISCIPLINES: member.disciplines.length ? member.disciplines.join(", ") : undefined,
    TOTAL_PAID_AMOUNT: member.totalSpent,
    TOTAL_PAID_COUNTS: member.purchasesCount,
    LAST_PAYMENT_DATE: member.lastPurchase,
    DATE_DERNIERE_ACTIVITE: lastActivity(member),
    STATUT_MEMBRE: memberStatus(member, config, now),
    SOURCE: member.source,
    ACCEPT_EMAIL: member.optinEmail,
    ACCEPT_SMS: member.optinSms,
    DATE_OPTIN: member.optinDate,
    SANCTUARY_PASS: true,
    BSPORT_ARCHIVE: member.archived,
  };
  // Marques : uniquement si les studios du membre sont connus, pour ne jamais écraser un « oui » par un « non ».
  for (const [brand, studioIds] of member.studios.length ? Object.entries(config.brands || {}) : []) {
    const ids = studioIds.map(String);
    attributes[brandAttributeName(brand)] =
      member.studios.some((studio) => ids.includes(studio)) || ids.includes(String(member.mainStudio));
  }
  const sms = member.optinSms === false ? undefined : normalizePhone(member.phone);
  if (sms) attributes.SMS = sms;
  return { email: member.email, attributes: clean(attributes) };
}

/**
 * Un même numéro ne peut appartenir qu'à un contact dans Brevo.
 * - numéro présent sur plus de `maxShare` contacts : numéro bidon ou de réception, retiré partout ;
 * - sinon il n'est gardé que sur le premier contact.
 */
export function dedupeSms(contacts, maxShare = 3) {
  const counts = new Map();
  for (const contact of contacts) {
    const sms = contact.attributes.SMS;
    if (sms) counts.set(sms, (counts.get(sms) || 0) + 1);
  }
  const seen = new Set();
  const stats = { removed: 0, sharedNumbers: 0, sharedContacts: 0, maxShare: 0 };
  for (const n of counts.values()) {
    if (n > stats.maxShare) stats.maxShare = n;
    if (n > maxShare) {
      stats.sharedNumbers += 1;
      stats.sharedContacts += n;
    }
  }
  for (const contact of contacts) {
    const sms = contact.attributes.SMS;
    if (!sms) continue;
    if (counts.get(sms) > maxShare || seen.has(sms)) {
      delete contact.attributes.SMS;
      stats.removed += 1;
    } else {
      seen.add(sms);
    }
  }
  return stats;
}
