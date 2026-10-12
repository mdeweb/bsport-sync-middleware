// Même format de log JSON que le middleware existant (lisible dans Railway).
export function log(level, message, data = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, scope: "brevo-sync", message, ...data }));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendAlert(config, message, data = {}) {
  log("error", `ALERTE : ${message}`, data);
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[Synchro Brevo TSG] ${message}`, ...data }),
    });
  } catch (err) {
    log("error", "Envoi de l'alerte impossible", { error: err.message });
  }
}
