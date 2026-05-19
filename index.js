/**
 * Bsport → Sanctuary Pass Sync Middleware
 * ----------------------------------------
 * Reçoit les webhooks member-create de chaque studio Bsport source
 * et crée automatiquement le membre dans le studio central Sanctuary Pass.
 *
 * Stack : Node.js 18+ — aucune dépendance externe hormis express
 * Hébergement : Railway, Render, ou autre
 */

import express from "express";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

const CONFIG = {
  port: process.env.PORT || 3000,
  bsportDomain: process.env.BSPORT_DOMAIN || "api.production.bsport.io",
  bsportApiKey: process.env.BSPORT_API_KEY || "YOUR_API_KEY",
  bsportFranchisorId: process.env.BSPORT_FRANCHISOR_ID || "92",
  sanctuaryPassStudioId: process.env.SANCTUARY_PASS_STUDIO_ID || "4781",
  allowedSourceStudioIds: process.env.ALLOWED_SOURCE_STUDIO_IDS
    ? process.env.ALLOWED_SOURCE_STUDIO_IDS.split(",")
    : [],
  maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || "1000"),
};

// ---------------------------------------------------------------------------
// UTILITAIRES
// ---------------------------------------------------------------------------

function formatDate(isoString) {
  if (!isoString) return null;
  return isoString.split("T")[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level, message, data = {}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    })
  );
}

// ---------------------------------------------------------------------------
// CRÉATION DU MEMBRE DANS SANCTUARY PASS (Bsport)
// ---------------------------------------------------------------------------

async function createMemberInSanctuaryPass(member, attempt = 1) {
  const url = `https://${CONFIG.bsportDomain}/api/v1/members/`;

  const payload = {
    email: member.email,
    first_name: member.firstname,
    last_name: member.lastname,
    membership: {
      joined_date: formatDate(member.date_joined),
      membership_id: member.membership_ID || undefined,
      barcode: member.barcode || undefined,
      is_email_accepted: member.accept_email ?? undefined,
      is_sms_accepted: member.accept_sms ?? undefined,
    },
  };

  payload.membership = Object.fromEntries(
    Object.entries(payload.membership).filter(([, v]) => v !== undefined)
  );

  const headers = {
    "Content-Type": "application/json",
    "X-Api-Key": CONFIG.bsportApiKey,
    "X-Client-ID": "tsg-franchise",
    "X-Franchisor-ID": CONFIG.bsportFranchisorId,
    "X-Company-ID": CONFIG.sanctuaryPassStudioId,
  };

  log("info", "Appel API Bsport", { url, email: member.email, headers: { ...headers, "X-Api-Key": "***" } });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const responseBody = await response.json().catch(() => ({}));

    log("info", "Réponse API Bsport", { status: response.status, body: responseBody, email: member.email });

    // 201 : membre créé
    if (response.status === 201) {
      log("info", "Membre créé dans Sanctuary Pass", { email: member.email });
      return { success: true, status: 201, alreadyExists: false };
    }

    // 409 CLI-101 : déjà existant → succès fonctionnel
    if (response.status === 409 && responseBody?.code === "CLI-101" || responseBody?.code === "MEM-101") {
      log("info", "Membre déjà présent dans Sanctuary Pass (CLI-101)", { email: member.email });
      return { success: true, status: 409, alreadyExists: true };
    }

    // 409 CLI-102 : verrou temporaire → retry
    if (response.status === 409 && responseBody?.code === "CLI-102" || responseBody?.code === "MEM-102") {
      if (attempt < CONFIG.maxRetries) {
        const delay = CONFIG.retryDelayMs * Math.pow(2, attempt - 1);
        log("warn", `CLI-102 — retry dans ${delay}ms (tentative ${attempt})`, { email: member.email });
        await sleep(delay);
        return createMemberInSanctuaryPass(member, attempt + 1);
      }
      log("error", "CLI-102 — nombre max de tentatives atteint", { email: member.email });
      return { success: false, status: 409, alreadyExists: false };
    }

    log("error", "Erreur API Bsport", { email: member.email, status: response.status, body: responseBody });
    return { success: false, status: response.status, alreadyExists: false };

  } catch (err) {
    log("error", "Exception lors de l'appel API Bsport", { email: member.email, error: err.message });
    return { success: false, status: 0, alreadyExists: false };
  }
}

// ---------------------------------------------------------------------------
// ENDPOINT WEBHOOK — POST /webhook/bsport
// ---------------------------------------------------------------------------

// GET : vérification URL par Bsport
app.get("/webhook/bsport", (req, res) => res.status(200).json({ status: "ok" }));

app.post("/webhook/bsport", async (req, res) => {
  const body = req.body;

  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Payload invalide" });
  }

  const { event_type, data } = body;

  if (event_type !== "member-create") {
    log("info", "Événement ignoré (non member-create)", { event_type });
    return res.status(200).json({ ignored: true, reason: "event_type ignoré" });
  }

  const member = data?.member;

  if (!member?.email) {
    log("warn", "Webhook reçu sans email", { body });
    return res.status(400).json({ error: "Email manquant" });
  }

  if (!member?.firstname || !member?.lastname) {
    log("warn", "Webhook reçu sans prénom/nom", { email: member.email });
    return res.status(400).json({ error: "Prénom ou nom manquant" });
  }

  log("info", "Webhook member-create reçu", { memberId: member.id, email: member.email });

  // Répondre immédiatement à Bsport pour éviter le timeout
  res.status(200).json({ received: true });

  // Traitement asynchrone
  try {
    const result = await createMemberInSanctuaryPass(member);
    log("info", "Synchronisation Bsport terminée", { email: member.email, result });
  } catch (err) {
    log("error", "Erreur non gérée", { email: member?.email, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ENDPOINT DE SANTÉ
// ---------------------------------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    sanctuaryPassStudioId: CONFIG.sanctuaryPassStudioId,
    franchisorId: CONFIG.bsportFranchisorId,
    allowedStudios: CONFIG.allowedSourceStudioIds,
  });
});

// ---------------------------------------------------------------------------
// DÉMARRAGE
// ---------------------------------------------------------------------------

app.listen(CONFIG.port, () => {
  log("info", `Middleware Bsport démarré sur le port ${CONFIG.port}`);
});
