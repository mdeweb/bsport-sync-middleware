/**
 * Lance une synchro tout de suite.
 *   node scripts/brevo-sync-once.js          → à blanc si BREVO_SYNC_ENABLED n'est pas "true"
 *   node scripts/brevo-sync-once.js --dry    → force le mode à blanc
 *   node scripts/brevo-sync-once.js --ecrire → écrit réellement dans Brevo (même si BREVO_SYNC_ENABLED vaut false)
 *   node scripts/brevo-sync-once.js --full   → relit tout l'historique (sinon : seulement depuis la dernière synchro)
 *   node scripts/brevo-sync-once.js --contacts-only → seulement la base Sanctuary Pass, sans activité (rapide)
 * Un passage complet interrompu reprend au dernier studio terminé (DATA_DIR obligatoire).
 */
import "./_env.js";
import { writeFileSync } from "node:fs";
import { loadConfig, assertConfig } from "../brevo/config.js";
import { runSync } from "../brevo/sync.js";

const config = loadConfig();
if (process.argv.includes("--ecrire")) config.enabled = true;
if (process.argv.includes("--dry")) config.enabled = false;
assertConfig(config, { needBrevo: config.enabled });
const started = Date.now();
const studios = config.sourceStudios;
const names = { "/api/v2/management/clients/": "membres", "/api/v2/management/client-subscriptions/": "abonnements", "/api/v2/management/client-class-passes/": "carnets", "/api/v2/management/bookings/": "réservations", "/api/v2/management/invoices/": "factures" };
console.log(`Synchro lancée (${config.enabled ? "écriture dans Brevo" : "à blanc, rien n'est écrit dans Brevo"}). Avancement ci-dessous.`);
const onProgress = ({ path, companyId, read, total }) => {
  const studio = String(companyId) === String(config.bsportCompanyId) ? "Sanctuary Pass" : studios[companyId] || companyId;
  const minutes = Math.round((Date.now() - started) / 60000);
  process.stdout.write(`\r  ${studio} › ${names[path] || path} : ${read}${total ? ` / ${total}` : ""}  (${minutes} min)            `);
};
const report = await runSync(config, {
  onProgress,
  forceFull: process.argv.includes("--full"),
  contactsOnly: process.argv.includes("--contacts-only"),
});
// Rapport écrit aussi dans un fichier : uniquement des compteurs, aucune donnée personnelle.
writeFileSync("brevo-rapport.json", JSON.stringify({ termineLe: new Date().toISOString(), dureeMinutes: Math.round((Date.now() - started) / 60000), ...report }, null, 2));
console.log("\nRapport :");
console.table(Object.fromEntries(Object.entries(report).filter(([, v]) => typeof v !== "object")));
if (report.errors?.length) console.log("Erreurs :", report.errors);
console.log("\nRapport écrit dans brevo-rapport.json.");
