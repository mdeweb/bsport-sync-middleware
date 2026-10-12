/**
 * Diagnostic rapide (2 à 3 minutes, lecture seule, uniquement des compteurs).
 *   node scripts/bsport-diagnostic.js
 * Résultat aussi dans bsport-diagnostic.json.
 */
import "./_env.js";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../brevo/config.js";
import { BsportClient, PATHS } from "../brevo/bsport-client.js";

const config = loadConfig();
const client = new BsportClient(config);
const sp = config.bsportCompanyId;
const studio = Object.keys(config.sourceStudios)[0];
const out = { studioTeste: `${studio} ${config.sourceStudios[studio]}` };

async function timed(label, fn) {
  const t = Date.now();
  try {
    const value = await fn();
    out[label] = { ...value, secondes: Math.round((Date.now() - t) / 100) / 10 };
  } catch (err) {
    out[label] = { erreur: err.message.slice(0, 160), secondes: Math.round((Date.now() - t) / 100) / 10 };
  }
  console.log(label, out[label]);
}
const page = async (path, company, params = {}) => client.get(client.url(path, { ...params, page: 1, page_size: 500 }), company);

// 1. Taille de page réelle et total annoncé.
await timed("membresSanctuary", async () => { const d = await page(PATHS.clients, sp); return { total: d.count, lignesParPage: d.results.length }; });
await timed("membresStudio", async () => { const d = await page(PATHS.clients, studio); return { total: d.count, lignesParPage: d.results.length }; });
// 2. Les identifiants membres sont-ils les mêmes dans le studio et dans le Sanctuary Pass ?
await timed("identifiantsCommuns", async () => {
  const a = await page(PATHS.clients, sp, { ordering: "id" });
  const b = await page(PATHS.clients, studio, { ordering: "id" });
  const idsA = new Set(a.results.map((c) => c.id));
  const emailsA = new Map(a.results.map((c) => [c.id, String(c.email || "").toLowerCase()]));
  const memeId = b.results.filter((c) => idsA.has(c.id));
  return {
    lignesComparees: b.results.length,
    memeIdentifiant: memeId.length,
    memeIdentifiantEtMemeEmail: memeId.filter((c) => emailsA.get(c.id) === String(c.email || "").toLowerCase()).length,
  };
});
// 3. Carnets : quelle requête répond, et en combien de temps ?
await timed("carnetsSansFiltre", async () => { const d = await page(PATHS.classPasses, studio); return { total: d.count, lignesParPage: d.results.length }; });
await timed("carnetsActifs", async () => { const d = await page(PATHS.classPasses, studio, { is_disabled: "false", has_credits_available: "true" }); return { total: d.count }; });
// 4. Volumes de réservations et factures sur un mois récent.
await timed("reservationsSeptembre", async () => { const d = await page(PATHS.bookings, studio, { has_attended: "true", class_started_after_date: "2026-09-01", class_started_before_date: "2026-10-01" }); return { total: d.count }; });
await timed("reservationsToutes", async () => { const d = await page(PATHS.bookings, studio, { has_attended: "true" }); return { total: d.count }; });
await timed("facturesSeptembre", async () => { const d = await page(PATHS.invoices, studio, { created_after: "2026-09-01", created_before: "2026-10-01" }); return { total: d.count }; });
await timed("abonnements", async () => { const d = await page(PATHS.subscriptions, studio); return { total: d.count, lignesParPage: d.results.length }; });

writeFileSync("bsport-diagnostic.json", JSON.stringify(out, null, 2));
console.log("\nRésultat écrit dans bsport-diagnostic.json.");
