/**
 * Prépare le compte Brevo : crée les attributs manquants et, si besoin, les listes.
 *
 * Usage :
 *   node scripts/brevo-setup.js            → affiche ce qui serait créé, sans rien modifier
 *   node scripts/brevo-setup.js --apply    → crée réellement les attributs manquants,
 *                                            et la liste « Sanctuary Pass (synchro Bsport) » si BREVO_LIST_ID est vide
 */
import "./_env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../brevo/config.js";
import { allAttributes } from "../brevo/attributes.js";
import { BrevoClient } from "../brevo/brevo-client.js";

const apply = process.argv.includes("--apply");
const config = loadConfig();
if (!config.brevoApiKey) throw new Error("BREVO_API_KEY manquante.");
const brevo = new BrevoClient(config);

const existing = new Map((await brevo.listAttributes()).map((a) => [a.name.toUpperCase(), a]));
const wanted = allAttributes(config);
const missing = wanted.filter((a) => !existing.has(a.name));
const mismatched = wanted.filter((a) => existing.has(a.name) && existing.get(a.name).type && existing.get(a.name).type !== a.type);

console.log(`Attributs attendus : ${wanted.length}, déjà présents : ${wanted.length - missing.length}, à créer : ${missing.length}`);
for (const a of missing) console.log(`  + ${a.name} (${a.type})`);
for (const a of mismatched) console.log(`  ! ${a.name} existe en type "${existing.get(a.name).type}", attendu "${a.type}" : à corriger à la main`);

const lists = await brevo.listLists();
console.log(`\nListes existantes : ${lists.length}`);
for (const l of lists) console.log(`  - ${l.id} : ${l.name} (${l.uniqueSubscribers ?? l.totalSubscribers ?? "?"} contacts)`);
console.log(`\nBREVO_LIST_ID actuel : ${config.brevoListId || "non défini"}`);
console.log(`BREVO_STAFF_LIST_ID actuel : ${config.brevoStaffListId || "non défini"}`);

writeFileSync(
  "brevo-setup.json",
  JSON.stringify(
    {
      attributsACreer: missing,
      attributsTypeDifferent: mismatched.map((a) => ({ ...a, typeActuel: existing.get(a.name).type })),
      attributsExistants: [...existing.values()].map((a) => ({ name: a.name, type: a.type, category: a.category })),
      listes: lists.map((l) => ({ id: l.id, name: l.name, contacts: l.uniqueSubscribers ?? l.totalSubscribers, folderId: l.folderId })),
    },
    null,
    2
  )
);
console.log("\nRésultat écrit dans brevo-setup.json (noms de listes et d'attributs, aucun contact).");

if (!apply) {
  console.log("\nRien n'a été modifié. Relancer avec --apply pour créer les attributs manquants.");
} else {
  for (const a of missing) {
    await brevo.createAttribute(a.name, a.type);
    console.log(`Créé : ${a.name}`);
  }
  if (!config.brevoListId) {
    const name = "Sanctuary Pass (synchro Bsport)";
    const found = lists.find((l) => l.name === name);
    const listId = found ? found.id : (await brevo.createList(name, (await brevo.listFolders())[0]?.id)).id;
    console.log(`\nListe « ${name} » : numéro ${listId}. À reporter dans BREVO_LIST_ID.`);
    writeFileSync("brevo-setup.json", JSON.stringify({ ...JSON.parse(readFileSync("brevo-setup.json", "utf8")), listeSynchro: listId }, null, 2));
  }
  console.log("\nTerminé.");
}
