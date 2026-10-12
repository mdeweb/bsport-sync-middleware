/**
 * Diagnostic n°3 (30 secondes, lecture seule) : peut-on obtenir l'email du membre directement
 * avec chaque réservation, facture ou abonnement (paramètre expand) ?
 * N'affiche que oui/non et les noms de champs, jamais de données personnelles.
 *   node scripts/bsport-diagnostic3.js
 */
import "./_env.js";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../brevo/config.js";
import { BsportClient, PATHS } from "../brevo/bsport-client.js";

const config = loadConfig();
const client = new BsportClient(config);
const studio = Object.keys(config.sourceStudios)[0];
const out = {};
const tests = [
  ["reservations", PATHS.bookings, { has_attended: "true", class_started_after_date: "2026-09-01", class_started_before_date: "2026-10-01" }],
  ["factures", PATHS.invoices, { created_after: "2026-09-01", created_before: "2026-10-01" }],
  ["abonnements", PATHS.subscriptions, {}],
];
for (const [label, path, params] of tests) {
  for (const expand of ["client_id", "client"]) {
    const key = `${label} expand=${expand}`;
    try {
      const d = await client.get(client.url(path, { ...params, "expand[]": expand, page: 1, page_size: 5 }), studio);
      const row = (d.results || [])[0] || {};
      const c = row.client_id && typeof row.client_id === "object" ? row.client_id : row.client && typeof row.client === "object" ? row.client : null;
      out[key] = c ? { ficheJointe: true, emailPresent: Boolean(c.email), champs: Object.keys(c) } : { ficheJointe: false, typeClientId: typeof row.client_id };
    } catch (err) {
      out[key] = { erreur: err.message.slice(0, 120) };
    }
    console.log(key, out[key]);
  }
}
// Lecture de quelques membres par identifiants (paramètre ids), en secours.
try {
  const b = await client.get(client.url(PATHS.bookings, { has_attended: "true", page: 1, page_size: 20 }), studio);
  const ids = [...new Set(b.results.map((r) => (typeof r.client_id === "object" ? r.client_id?.id : r.client_id)).filter(Boolean))];
  const t = Date.now();
  const c = await client.get(client.url(PATHS.clients, { ids: ids.join(","), page: 1, page_size: 100 }), studio);
  out.membresParIdentifiants = { demandes: ids.length, recus: c.results.length, avecEmail: c.results.filter((x) => x.email).length, secondes: (Date.now() - t) / 1000 };
} catch (err) {
  out.membresParIdentifiants = { erreur: err.message.slice(0, 120) };
}
console.log("membresParIdentifiants", out.membresParIdentifiants);
writeFileSync("bsport-diagnostic3.json", JSON.stringify(out, null, 2));
console.log("\nRésultat écrit dans bsport-diagnostic3.json.");
