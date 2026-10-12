/**
 * Compte rapide (une requête par ligne, aucune donnée personnelle) pour vérifier
 * que la liste des membres est bien limitée au studio demandé.
 *   node scripts/bsport-count.js
 */
import "./_env.js";
import { loadConfig } from "../brevo/config.js";
import { BsportClient, PATHS } from "../brevo/bsport-client.js";

const config = loadConfig();
const client = new BsportClient(config);
const sp = config.bsportCompanyId;

async function count(label, params, { withoutFranchisor = false } = {}) {
  const headers = client.headers(sp);
  if (withoutFranchisor) delete headers["X-Franchisor-ID"];
  const res = await fetch(client.url(PATHS.clients, { ...params, page: 1, page_size: 1 }), { headers });
  const body = await res.json().catch(() => ({}));
  console.log(`${label.padEnd(45)} → ${res.ok ? body.count : `erreur ${res.status}`}`);
}

await count("Sans filtre (comme le script d'exploration)", {});
await count(`Filtre company_id=${sp}`, { company_id: sp });
await count("Sans l'en-tête franchiseur", {}, { withoutFranchisor: true });
await count(`Filtre company_id=${sp}, sans franchiseur`, { company_id: sp }, { withoutFranchisor: true });
await count("Membres non archivés", { is_archived: "false" });
