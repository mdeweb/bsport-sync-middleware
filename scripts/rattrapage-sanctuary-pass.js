/**
 * Rattrapage : crée dans le Sanctuary Pass les membres dont l'inscription n'a pas été transmise
 * par le middleware entre le 12/10/2026 09:11 et sa correction (459 inscriptions, liste tirée
 * des logs Railway : rattrapage-ids.txt, identifiants Bsport uniquement).
 *
 *   node scripts/rattrapage-sanctuary-pass.js            → à blanc : retrouve les fiches et compte
 *   node scripts/rattrapage-sanctuary-pass.js --ecrire   → crée réellement les membres
 *
 * Même appel que le middleware (index.js) : POST /api/v1/management/clients/ sur
 * public.production.bsport.io, avec accord email et SMS à oui comme demandé par TSG.
 * Un membre déjà présent (409 CLI-101 / MEM-101) est compté et ignoré.
 * N'affiche que des nombres, jamais de données personnelles.
 */
import "./_env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../brevo/config.js";
import { BsportClient, PATHS } from "../brevo/bsport-client.js";

const config = loadConfig();
const write = process.argv.includes("--ecrire");
const domain = process.env.BSPORT_DOMAIN || "public.production.bsport.io";
const client = new BsportClient(config);
const ids = [...new Set(readFileSync("rattrapage-ids.txt", "utf8").split(/[\s,]+/).filter(Boolean))];

// 1. Retrouver les fiches dans les studios (par identifiant, 100 par appel).
const found = new Map();
for (const studioId of Object.keys(config.sourceStudios)) {
  const missing = ids.filter((id) => !found.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    try {
      const d = await client.get(client.url(PATHS.clients, { ids: batch.join(","), page: 1, page_size: 100 }), studioId);
      for (const c of d.results || []) if (batch.includes(String(c.id))) found.set(String(c.id), c);
    } catch (err) {
      console.log(`Studio ${studioId} : lecture impossible (${err.message.slice(0, 60)})`);
    }
  }
}
const usable = [...found.values()].filter((c) => c.email && c.firstname && c.lastname);
const out = {
  ecriture: write,
  inscriptionsRatees: ids.length,
  fichesRetrouvees: found.size,
  fichesIntrouvables: ids.length - found.size,
  sansEmailOuNom: found.size - usable.length,
  aTransmettre: usable.length,
  crees: 0,
  dejaPresents: 0,
  erreurs: 0,
  codesErreur: {},
};
console.log(`${ids.length} inscriptions ratées : ${found.size} fiches retrouvées, ${usable.length} à transmettre.`);

// 2. Création dans le Sanctuary Pass, exactement comme le middleware.
if (write) {
  const headers = {
    "Content-Type": "application/json",
    "X-Api-Key": config.bsportApiKey,
    "X-Client-ID": "tsg-matthieu",
    "X-Franchisor-ID": String(config.bsportFranchisorId || "92"),
    "X-Company-ID": String(config.bsportCompanyId),
  };
  let n = 0;
  for (const c of usable) {
    n += 1;
    const membership = { joined_date: String(c.joined_date || "").slice(0, 10) || undefined, barcode: c.barcode || undefined, is_email_accepted: true, is_sms_accepted: true };
    const payload = { email: c.email, firstname: c.firstname, lastname: c.lastname, membership: Object.fromEntries(Object.entries(membership).filter(([, v]) => v !== undefined)) };
    let status = 0;
    let code = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`https://${domain}/api/v1/management/clients/`, { method: "POST", headers, body: JSON.stringify(payload) });
        status = res.status;
        const body = await res.json().catch(() => ({}));
        code = body?.code || (body?.detail ? String(body.detail).slice(0, 40) : Object.keys(body || {}).join(","));
      } catch (err) {
        status = 0;
        code = err.message.slice(0, 40);
      }
      if (!(status === 409 && /102/.test(code)) && status !== 429 && status < 500) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    if (status === 201) out.crees += 1;
    else if (status === 409 && /101/.test(code)) out.dejaPresents += 1;
    else {
      out.erreurs += 1;
      const key = `${status} ${code}`;
      out.codesErreur[key] = (out.codesErreur[key] || 0) + 1;
      if (status === 401 || status === 403 || (out.erreurs >= 5 && out.crees === 0 && out.dejaPresents === 0)) {
        console.log("\nTrop d'erreurs dès le départ : arrêt du rattrapage.", key);
        break;
      }
    }
    process.stdout.write(`\r  ${n} / ${usable.length} — créés ${out.crees}, déjà présents ${out.dejaPresents}, erreurs ${out.erreurs}   `);
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log("");
}
writeFileSync("rattrapage-sanctuary-pass.json", JSON.stringify(out, null, 2));
console.log(out);
console.log(write ? "Rattrapage terminé." : "À blanc : rien n'a été créé. Relancer avec --ecrire pour créer les membres.");
