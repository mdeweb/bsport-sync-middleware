/**
 * Attributs Brevo utilisés par la synchro. Ceux qui existaient déjà dans le compte (import d'août 2025)
 * sont réutilisés sous leur nom d'origine pour être remis à jour : PRENOM, NOM, SMS, CITY, ACCEPT_EMAIL,
 * ACCEPT_SMS, FIRST_DATE_JOINED, LAST_BOOKING_DATE, ATTENDED_BOOKINGS, TOTAL_PAID_AMOUNT,
 * TOTAL_PAID_COUNTS, REMAINING_CREDITS, LAST_PAYMENT_DATE. scripts/brevo-setup.js ne crée que les manquants.
 * Gardés à part volontairement : CODE_POSTAL (ZIPCODE est numérique et perd le 0 de 06000),
 * GENRE (GENDER est une liste de valeurs fixes), BSPORT_ID (EXT_ID contient des identifiants d'origine inconnue).
 * Liste validée par TSG dans l'onglet « Mapping champs » (date de naissance exclue, langue en attente),
 * plus les attributs demandés pour leurs segments (dernière activité, nombre d'achats, date d'accord).
 * Les catégories sont en "text" pour ne pas bloquer l'import sur une valeur inconnue.
 */
export const ATTRIBUTES = [
  { name: "PRENOM", type: "text" },
  { name: "NOM", type: "text" },
  { name: "GENRE", type: "text" },
  { name: "CODE_POSTAL", type: "text" },
  { name: "CITY", type: "text" },
  { name: "BSPORT_ID", type: "text" },
  { name: "EMAIL_2", type: "text" },
  { name: "FIRST_DATE_JOINED", type: "date" },
  { name: "STUDIO_PRINCIPAL", type: "text" },
  { name: "STUDIOS_FREQUENTES", type: "text" },
  { name: "TYPE_PASS", type: "text" },
  { name: "STATUT_ABO", type: "text" },
  { name: "DATE_DEBUT_ABO", type: "date" },
  { name: "DATE_FIN_ABO", type: "date" },
  { name: "REMAINING_CREDITS", type: "float" },
  { name: "LAST_BOOKING_DATE", type: "date" },
  { name: "ATTENDED_BOOKINGS", type: "float" },
  { name: "DISCIPLINES", type: "text" },
  { name: "TOTAL_PAID_AMOUNT", type: "float" },
  { name: "TOTAL_PAID_COUNTS", type: "float" },
  { name: "LAST_PAYMENT_DATE", type: "date" },
  { name: "DATE_DERNIERE_ACTIVITE", type: "date" },
  { name: "STATUT_MEMBRE", type: "text" },
  { name: "SOURCE", type: "text" },
  { name: "ACCEPT_EMAIL", type: "boolean" },
  { name: "ACCEPT_SMS", type: "boolean" },
  { name: "DATE_OPTIN", type: "date" },
  { name: "SANCTUARY_PASS", type: "boolean" },
  { name: "BSPORT_ARCHIVE", type: "boolean" },
];

export function brandAttributeName(brand) {
  const slug = String(brand)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `MARQUE_${slug}`;
}

export function allAttributes(config) {
  const brands = Object.keys(config.brands || {}).map((brand) => ({ name: brandAttributeName(brand), type: "boolean" }));
  return [...ATTRIBUTES, ...brands];
}
