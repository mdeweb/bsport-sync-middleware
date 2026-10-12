import { log } from "./logger.js";

/** Heure, minute et date du jour dans le fuseau demandé (gère l'heure d'été). */
export function localParts(date, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/**
 * Lance `task` une fois par jour à l'heure configurée (16h00 Europe/Paris par défaut).
 * Vérifie toutes les 30 secondes ; si le service redémarre après l'heure prévue, la synchro
 * du jour n'est pas rejouée (elle peut être lancée à la main via POST /sync/brevo).
 */
export function startDailySchedule(config, task, { intervalMs = 30000 } = {}) {
  let lastRunDay = null;
  let running = false;
  const tick = async () => {
    const { day, hour, minute } = localParts(new Date(), config.timezone);
    if (running || lastRunDay === day) return;
    if (hour !== config.scheduleHour || minute !== config.scheduleMinute) return;
    lastRunDay = day;
    running = true;
    try {
      await task();
    } catch (err) {
      log("error", "Synchro planifiée en échec", { error: err.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  log("info", "Synchro Brevo planifiée", {
    heure: `${String(config.scheduleHour).padStart(2, "0")}:${String(config.scheduleMinute).padStart(2, "0")}`,
    fuseau: config.timezone,
    ecriture: config.enabled,
  });
  return { stop: () => clearInterval(timer), tick };
}
