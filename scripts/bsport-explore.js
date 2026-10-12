/**
 * Vérifie l'accès à l'API publique Bsport et compte les données, en lecture seule.
 * N'affiche et n'enregistre aucune donnée personnelle : uniquement des compteurs et des noms de champs.
 *
 *   node scripts/bsport-explore.js
 * Résultat aussi écrit dans bsport-structure.json.
 */
import "./_env.js";
import { writeFileSync } from "node:fs";
import { loadConfig, assertConfig } from "../brevo/config.js";
import { BsportClient, PATHS } from "../brevo/bsport-client.js";

const config = loadConfig();
assertConfig(config, { needBrevo: false });
const client = new BsportClient(config);
const started = Date.now();
client.onProgress = ({ read, total }) =>
  process.stdout.write(`\r  lecture en cours : ${read}${total ? ` / ${total}` : ""} membres (${Math.round((Date.now() - started) / 1000)} s)   `);
const out = { domaine: config.bsportDomain, studios: {} };

async function count(path, companyId, params = {}) {
  try {
    const data = await client.get(client.url(path, { ...params, page: 1, page_size: 1 }), companyId);
    const first = (data.results || [])[0];
    return { total: data.count, champs: first ? Object.keys(first) : [] };
  } catch (err) {
    return { erreur: err.message.replace(/[\w.+-]+@[\w.-]+/g, "<email>").slice(0, 200) };
  }
}

try {
  await client.ping(config.bsportCompanyId);
  out.ping = "OK";
  console.log(`Connexion OK à ${config.bsportDomain}`);
} catch (err) {
  out.ping = err.message.slice(0, 200);
  console.log(`ÉCHEC de connexion : ${out.ping}`);
}

// Base Sanctuary Pass : lecture complète pour compter les consentements (compteurs uniquement).
try {
  console.log("Lecture de la base Sanctuary Pass…");
  const clients = await client.listAll(PATHS.clients, config.bsportCompanyId);
  process.stdout.write("\n");
  const n = (f) => clients.filter(f).length;
  out.sanctuaryPass = {
    total: clients.length,
    sansEmail: n((c) => !c.email),
    archives: n((c) => c.is_archived === true),
    accordEmailOui: n((c) => c.is_email_accepted === true),
    accordEmailNon: n((c) => c.is_email_accepted === false),
    accordEmailInconnu: n((c) => c.is_email_accepted === undefined || c.is_email_accepted === null),
    accordSmsOui: n((c) => c.is_sms_accepted === true),
    avecTelephone: n((c) => Boolean(c.phone_number)),
    champs: clients[0] ? Object.keys(clients[0]) : [],
  };
  console.log("Sanctuary Pass :", out.sanctuaryPass);
} catch (err) {
  out.sanctuaryPass = { erreur: err.message.slice(0, 200) };
  console.log("ÉCHEC lecture Sanctuary Pass :", out.sanctuaryPass.erreur);
}

for (const [id, name] of Object.entries(config.sourceStudios)) {
  out.studios[`${id} ${name}`] = {
    membres: await count(PATHS.clients, id),
    abonnements: await count(PATHS.subscriptions, id),
    carnets: await count(PATHS.classPasses, id),
    reservationsHonorees: await count(PATHS.bookings, id, { has_attended: "true" }),
    factures: await count(PATHS.invoices, id),
  };
  console.log(`Studio ${id} ${name} :`, Object.fromEntries(Object.entries(out.studios[`${id} ${name}`]).map(([k, v]) => [k, v.total ?? v.erreur])));
}
if (!Object.keys(config.sourceStudios).length) {
  console.log("\nBSPORT_SOURCE_STUDIOS est vide : les studios des marques n'ont pas été interrogés.");
}

writeFileSync("bsport-structure.json", JSON.stringify(out, null, 2));
console.log("\nRésultat écrit dans bsport-structure.json (compteurs et noms de champs uniquement).");
