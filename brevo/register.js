import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { startDailySchedule } from "./scheduler.js";
import { runSync } from "./sync.js";

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Branche la synchro Brevo sur l'application Express existante.
 * Dans index.js :
 *   import { registerBrevoSync } from "./brevo/register.js";
 *   registerBrevoSync(app);
 */
export function registerBrevoSync(app, env = process.env) {
  const config = loadConfig(env);
  if (!config.bsportApiKey) {
    log("warn", "Synchro Brevo non démarrée : BSPORT_API_KEY manquante");
    return null;
  }
  let running = false;
  let lastReport = null;

  const run = async () => {
    if (running) return null;
    running = true;
    try {
      lastReport = { at: new Date().toISOString(), ...(await runSync(config)) };
      return lastReport;
    } catch (err) {
      lastReport = { at: new Date().toISOString(), failed: true, error: err.message };
      throw err;
    } finally {
      running = false;
    }
  };

  // Lancement manuel, protégé par l'en-tête X-Sync-Secret.
  app.post("/sync/brevo", async (req, res) => {
    if (!sameSecret(req.get("X-Sync-Secret"), config.manualSecret)) {
      return res.status(403).json({ error: "Secret invalide" });
    }
    if (running) return res.status(409).json({ error: "Une synchro est déjà en cours" });
    res.status(202).json({ started: true, ecriture: config.enabled });
    run().catch(() => {});
  });

  // Dernier rapport (compteurs uniquement, aucune donnée personnelle).
  app.get("/sync/brevo/status", (req, res) => {
    if (!sameSecret(req.get("X-Sync-Secret"), config.manualSecret)) {
      return res.status(403).json({ error: "Secret invalide" });
    }
    res.json({ running, ecriture: config.enabled, lastReport });
  });

  return startDailySchedule(config, run);
}
