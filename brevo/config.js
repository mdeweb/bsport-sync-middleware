/**
 * Configuration de la synchro Bsport → Brevo.
 * Toutes les valeurs viennent des variables d'environnement (Railway ou fichier .env local).
 * Aucune clé n'est écrite dans le code.
 */

function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "oui"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function json(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Variable d'environnement JSON invalide : ${value.slice(0, 40)}…`);
  }
}

export function loadConfig(env = process.env) {
  return {
    // --- Bsport (mêmes variables que le middleware existant) ---
    // API publique Bsport (doc : api-docs.production.bsport.io). Variable distincte de BSPORT_DOMAIN,
    // utilisée par le middleware existant sur l'ancien domaine.
    bsportDomain: env.BSPORT_PUBLIC_DOMAIN || "public.production.bsport.io",
    bsportApiKey: env.BSPORT_API_KEY || "",
    bsportClientId: env.BSPORT_CLIENT_ID || "tsg-franchise",
    bsportFranchisorId: env.BSPORT_FRANCHISOR_ID || "92",
    bsportCompanyId: env.SANCTUARY_PASS_STUDIO_ID || "4781",
    // Studios des marques : {"id_bsport": "Nom du studio"}. Les réservations, abonnements et achats
    // se trouvent dans ces studios, pas dans le Sanctuary Pass.
    sourceStudios: json(env.BSPORT_SOURCE_STUDIOS, {}),
    bsportPageSize: int(env.BSPORT_PAGE_SIZE, 100), // Bsport plafonne à 100 par page
    bsportPauseMs: int(env.BSPORT_PAUSE_MS, 200),
    // Pages demandées en parallèle (la base Sanctuary Pass fait ~840 pages de 500).
    bsportConcurrency: int(env.BSPORT_CONCURRENCY, 2),
    // Historique : réservations et factures lues mois par mois depuis cette date (pages courtes, reprise possible).
    backfillFrom: env.BSPORT_BACKFILL_FROM || "2018-01-01",
    // Carnets : seuls ceux achetés dans les N derniers mois peuvent encore être actifs.
    classPassLookbackMonths: int(env.BSPORT_CLASS_PASS_MONTHS, 24),
    // Carnets désactivés par défaut : ~300 000 carnets « actifs » par studio, visiblement partagés entre studios,
    // donc additionner les crédits les compterait plusieurs fois. À réactiver après confirmation de Bsport.
    readClassPasses: bool(env.BSPORT_CLASS_PASSES, false),

    // --- Brevo ---
    brevoApiKey: env.BREVO_API_KEY || "",
    brevoBaseUrl: env.BREVO_BASE_URL || "https://api.brevo.com/v3",
    brevoListId: int(env.BREVO_LIST_ID, 0),
    // Dernier jour déjà importé (AAAA-MM-JJ), utilisé si le serveur n'a pas encore d'état.
    initialLastDay: /^\d{4}-\d{2}-\d{2}$/.test(env.BREVO_LAST_DAY || "") ? env.BREVO_LAST_DAY : "",
    brevoStaffListId: int(env.BREVO_STAFF_LIST_ID, 0),
    brevoBatchSize: int(env.BREVO_BATCH_SIZE, 5000),

    // --- Règles métier ---
    // false tant que la recette n'est pas validée : la synchro calcule tout mais n'écrit rien dans Brevo.
    enabled: bool(env.BREVO_SYNC_ENABLED, false),
    // Décision TSG (A. Wilhelm, 5 oct.) : sans information, le membre est considéré comme ayant accepté.
    unknownOptinIsOptin: env.BREVO_UNKNOWN_OPTIN !== "refus",
    // "blacklist" : les membres sans accord marketing sont importés mais bloqués à l'envoi.
    // "skip"      : ils ne sont pas importés (et bloqués s'ils existent déjà dans Brevo).
    nonOptinMode: env.BREVO_NON_OPTIN_MODE === "skip" ? "skip" : "blacklist",
    // Ancien membre après N jours sans activité (décision TSG : 1 an).
    formerMemberDays: int(env.FORMER_MEMBER_DAYS, 365),
    // Marques : { "Nom de marque": ["id_studio", ...] } → un attribut booléen MARQUE_<NOM> par marque.
    brands: json(env.BREVO_BRANDS, {}),
    // Suppressions : la synchro refuse de supprimer plus que ce seuil en une fois.
    maxDeleteCount: int(env.BREVO_MAX_DELETE_COUNT, 20),
    maxDeleteRatio: parseFloat(env.BREVO_MAX_DELETE_RATIO || "0.02"),

    // --- Planification ---
    scheduleHour: int(env.BREVO_SYNC_HOUR, 16),
    scheduleMinute: int(env.BREVO_SYNC_MINUTE, 0),
    timezone: env.BREVO_SYNC_TZ || "Europe/Paris",

    // --- Divers ---
    // Secret demandé par POST /sync/brevo (lancement manuel).
    manualSecret: env.BREVO_SYNC_SECRET || "",
    // Dossier persistant (volume Railway) pour la liste d'exclusion. Vide = pas de liste d'exclusion.
    dataDir: env.DATA_DIR || "",
    // URL appelée en POST (JSON) en cas d'erreur ou d'alerte. Vide = logs seulement.
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || "",
  };
}

export function assertConfig(config, { needBrevo = true, needBsport = true } = {}) {
  const missing = [];
  if (needBsport && !config.bsportApiKey) missing.push("BSPORT_API_KEY");
  if (needBrevo && !config.brevoApiKey) missing.push("BREVO_API_KEY");
  if (needBrevo && !config.brevoListId) missing.push("BREVO_LIST_ID");
  if (missing.length) {
    throw new Error(`Configuration incomplète, variables manquantes : ${missing.join(", ")}`);
  }
}
