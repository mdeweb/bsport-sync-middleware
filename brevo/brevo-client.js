import { log, sleep } from "./logger.js";

/**
 * L'import Brevo ignore les vrais booléens (true/false) : les champs oui/non doivent être envoyés
 * en texte « yes » / « no » (vérifié le 26/10/2026 avec scripts/brevo-test-booleens.js).
 */
export function toImportFormat(contact) {
  const attributes = Object.fromEntries(
    Object.entries(contact.attributes || {}).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "yes" : "no") : v])
  );
  return { ...contact, attributes };
}

/** Appels à l'API Brevo v3 utilisés par la synchro. */
export class BrevoClient {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async request(method, path, body, attempt = 1) {
    const response = await this.fetch(`${this.config.brevoBaseUrl}${path}`, {
      method,
      headers: { "api-key": this.config.brevoApiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 429 || response.status >= 500) {
      if (attempt >= 4) throw new Error(`Brevo ${response.status} après ${attempt} tentatives : ${method} ${path}`);
      const delay = 1000 * Math.pow(2, attempt - 1);
      log("warn", `Brevo ${response.status}, nouvelle tentative dans ${delay} ms`, { method, path });
      await sleep(delay);
      return this.request(method, path, body, attempt + 1);
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(`Brevo ${response.status} sur ${method} ${path} : ${data.message || text.slice(0, 300)}`);
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  // --- Préparation du compte ---
  async listAttributes() {
    const data = await this.request("GET", "/contacts/attributes");
    return data.attributes || [];
  }

  createAttribute(name, type) {
    return this.request("POST", `/contacts/attributes/normal/${encodeURIComponent(name)}`, { type });
  }

  async listLists() {
    const lists = [];
    for (let offset = 0; ; offset += 50) {
      const data = await this.request("GET", `/contacts/lists?limit=50&offset=${offset}`);
      lists.push(...(data.lists || []));
      if (!data.lists || data.lists.length < 50) return lists;
    }
  }

  async listFolders() {
    const data = await this.request("GET", "/contacts/folders?limit=50&offset=0");
    return data.folders || [];
  }

  createFolder(name) {
    return this.request("POST", "/contacts/folders", { name });
  }

  createList(name, folderId) {
    return this.request("POST", "/contacts/lists", { name, folderId });
  }

  // --- Lecture des contacts d'une liste ---
  /** Contacts de la liste, réduits aux attributs dont la synchro a besoin (420 000 contacts à tenir en mémoire). */
  async listContacts(listId) {
    const keep = ["BSPORT_ID", "ACCEPT_EMAIL", "ATTENDED_BOOKINGS", "TOTAL_PAID_AMOUNT", "TOTAL_PAID_COUNTS", "LAST_BOOKING_DATE", "DATE_DERNIERE_ACTIVITE", "LAST_PAYMENT_DATE", "FIRST_DATE_JOINED", "STUDIOS_FREQUENTES", "STUDIO_PRINCIPAL"];
    const contacts = [];
    for (let offset = 0; ; offset += 500) {
      const data = await this.request("GET", `/contacts/lists/${listId}/contacts?limit=500&offset=${offset}`);
      const rows = data.contacts || [];
      for (const c of rows) {
        const attributes = {};
        for (const k of keep) if (c.attributes && c.attributes[k] !== undefined) attributes[k] = c.attributes[k];
        contacts.push({ email: c.email, emailBlacklisted: c.emailBlacklisted, attributes });
      }
      if (rows.length < 500) return contacts;
    }
  }

  // --- Écriture ---
  /** Import par lot. emailBlacklist = true bloque l'envoi d'emails à tous les contacts du lot. */
  importContacts({ contacts, listIds, emailBlacklist = false }) {
    return this.request("POST", "/contacts/import", {
      jsonBody: contacts.map(toImportFormat),
      listIds,
      updateExistingContacts: true,
      emptyContactsAttributes: false,
      emailBlacklist,
      smsBlacklist: false,
      disableNotification: true,
    });
  }

  getProcess(processId) {
    return this.request("GET", `/processes/${processId}`);
  }

  /** Change l'adresse d'un contact existant, sans perdre son historique. */
  updateContactEmail(oldEmail, newEmail) {
    return this.request("PUT", `/contacts/${encodeURIComponent(oldEmail)}`, { attributes: { EMAIL: newEmail } });
  }

  setEmailBlacklisted(email, blacklisted) {
    return this.request("PUT", `/contacts/${encodeURIComponent(email)}`, { emailBlacklisted: blacklisted });
  }

  deleteContact(email) {
    return this.request("DELETE", `/contacts/${encodeURIComponent(email)}`);
  }
}
