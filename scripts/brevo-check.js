/**
 * Vérifie, après un import, que Brevo a bien traité tous les envois (lecture seule).
 * N'affiche que des nombres, jamais de données personnelles.
 *   node scripts/brevo-check.js
 */
import "./_env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../brevo/config.js";
import { BrevoClient } from "../brevo/brevo-client.js";

const config = loadConfig();
const brevo = new BrevoClient(config);
const report = JSON.parse(readFileSync("brevo-rapport.json", "utf8"));
const ids = report.importProcesses || [];
const statuses = {};
for (const id of ids) {
  let status;
  try {
    status = (await brevo.request("GET", `/processes/${id}`)).status || "inconnu";
  } catch (err) {
    status = `erreur ${err.message.slice(0, 40)}`;
  }
  statuses[status] = (statuses[status] || 0) + 1;
}
const list = await brevo.request("GET", `/contacts/lists/${config.brevoListId}`);
const all = await brevo.request("GET", "/contacts?limit=1&offset=0");
const out = {
  envoisImport: ids.length,
  statutsEnvois: statuses,
  liste: { id: list.id, nom: list.name, contacts: list.totalSubscribers ?? list.uniqueSubscribers, bloques: list.totalBlacklisted },
  contactsDansLeCompte: all.count,
};
console.log(JSON.stringify(out, null, 2));
writeFileSync("brevo-check.json", JSON.stringify(out, null, 2));
