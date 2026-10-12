/**
 * Diagnostic n°2 (1 à 2 minutes, lecture seule, compteurs uniquement) :
 * les membres et les carnets sont-ils communs à tous les studios ?
 *   node scripts/bsport-diagnostic2.js
 */
import "./_env.js";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../brevo/config.js";
import { BsportClient, PATHS } from "../brevo/bsport-client.js";

const config = loadConfig();
const client = new BsportClient(config);
const out = { studios: {} };
const count = async (path, company, params = {}) => {
  try {
    const t = Date.now();
    const d = await client.get(client.url(path, { ...params, page: 1, page_size: 1 }), company);
    return `${d.count} (${Math.round((Date.now() - t) / 100) / 10} s)`;
  } catch (err) {
    return `erreur ${err.message.match(/Bsport (\d+)/)?.[1] || "?"}`;
  }
};

for (const [id, name] of Object.entries(config.sourceStudios)) {
  out.studios[`${id} ${name}`] = {
    membres: await count(PATHS.clients, id),
    carnets: await count(PATHS.classPasses, id),
    carnetsActifs: await count(PATHS.classPasses, id, { is_disabled: "false", has_credits_available: "true" }),
    reservationsHonorees: await count(PATHS.bookings, id, { has_attended: "true" }),
    factures: await count(PATHS.invoices, id),
    abonnements: await count(PATHS.subscriptions, id),
  };
  console.log(id, name, out.studios[`${id} ${name}`]);
}

// Les identifiants membres sont-ils les mêmes d'un studio à l'autre ? (100 premiers par identifiant)
const ids = Object.keys(config.sourceStudios).slice(0, 2);
const first = async (company) =>
  (await client.get(client.url(PATHS.clients, { ordering: "id", page: 1, page_size: 100 }), company)).results.map((c) => c.id);
const [a, b] = await Promise.all(ids.map(first));
const setA = new Set(a);
out.identifiantsCommunsEntreStudios = { studios: ids, comparees: b.length, communs: b.filter((x) => setA.has(x)).length };
console.log("Identifiants communs entre", ids.join(" et "), ":", out.identifiantsCommunsEntreStudios);

writeFileSync("bsport-diagnostic2.json", JSON.stringify(out, null, 2));
console.log("\nRésultat écrit dans bsport-diagnostic2.json.");
