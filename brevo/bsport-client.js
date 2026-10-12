import { log, sleep } from "./logger.js";

/**
 * Lecture de l'API publique Bsport v2 (endpoints /api/v2/management/…).
 * Authentification : X-Api-Key + X-Client-ID, et X-Company-ID pour choisir le studio interrogé.
 * Pagination : ?page=&page_size=, réponse { count, next, results }.
 */
export class BsportClient {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  headers(companyId) {
    return {
      Accept: "application/json",
      "X-Api-Key": this.config.bsportApiKey,
      "X-Client-ID": this.config.bsportClientId,
      "X-Franchisor-ID": this.config.bsportFranchisorId,
      "X-Company-ID": String(companyId),
    };
  }

  url(path, params = {}) {
    const query = new URLSearchParams(params).toString();
    return `https://${this.config.bsportDomain}${path}${query ? `?${query}` : ""}`;
  }

  async get(url, companyId, attempt = 1) {
    const response = await this.fetch(url, { method: "GET", headers: this.headers(companyId) });
    if (response.status === 429 || response.status >= 500) {
      // 502/504 : Bsport met trop de temps à répondre. On patiente de plus en plus (jusqu'à 30 s).
      if (attempt >= 7) throw new Error(`Bsport ${response.status} après ${attempt} tentatives : ${url}`);
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
      log("warn", `Bsport ${response.status}, nouvelle tentative dans ${delay} ms`, { url });
      await sleep(delay);
      return this.get(url, companyId, attempt + 1);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Bsport ${response.status} sur ${url} (studio ${companyId}) : ${body.slice(0, 300)}`);
    }
    return response.json();
  }

  /**
   * Parcourt un endpoint paginé page par page, sans tout garder en mémoire.
   * Après la première page, les suivantes sont demandées par groupes (BSPORT_CONCURRENCY en parallèle).
   * Lève une erreur si une page échoue : l'appelant ne travaille jamais sur une liste partielle.
   */
  async forEachPage(path, companyId, params, onRows) {
    const size = this.config.bsportPageSize;
    const pageUrl = (page) => this.url(path, { ...params, page, page_size: size });
    const first = await this.get(pageUrl(1), companyId);
    const firstRows = Array.isArray(first) ? first : first.results || [];
    await onRows(firstRows);
    let read = firstRows.length;
    const total = Array.isArray(first) ? undefined : first.count;
    if (this.onProgress) this.onProgress({ path, companyId, read, total });

    // Bsport plafonne la taille des pages (100 lignes même si on en demande 500) : on se base sur la taille réelle.
    const effective = firstRows.length && firstRows.length < size && total > firstRows.length ? firstRows.length : size;
    if (typeof total === "number") {
      const pageUrlEff = (page) => this.url(path, { ...params, page, page_size: effective });
      const pages = Math.ceil(total / effective);
      const concurrency = Math.max(1, this.config.bsportConcurrency || 1);
      for (let start = 2; start <= pages; start += concurrency) {
        const batch = [];
        for (let p = start; p < start + concurrency && p <= pages; p += 1) batch.push(this.get(pageUrlEff(p), companyId));
        for (const data of await Promise.all(batch)) {
          const rows = Array.isArray(data) ? data : data.results || [];
          await onRows(rows);
          read += rows.length;
        }
        if (this.onProgress) this.onProgress({ path, companyId, read, total });
        if (this.config.bsportPauseMs) await sleep(this.config.bsportPauseMs);
      }
    } else {
      // Pas de total annoncé : on suit les liens "next" un par un.
      let url = Array.isArray(first) ? null : first.next || null;
      while (url) {
        const data = await this.get(url, companyId);
        const rows = data.results || [];
        await onRows(rows);
        read += rows.length;
        if (this.onProgress) this.onProgress({ path, companyId, read, total });
        url = data.next || null;
        if (url && this.config.bsportPauseMs) await sleep(this.config.bsportPauseMs);
      }
    }
    log("info", "Lecture Bsport", { path, studio: companyId, lignes: read });
    return read;
  }

  /** Toutes les lignes d'un endpoint paginé (à réserver aux petits volumes). */
  async listAll(path, companyId, params = {}) {
    const rows = [];
    await this.forEachPage(path, companyId, params, (results) => {
      rows.push(...results);
    });
    return rows;
  }

  ping(companyId) {
    return this.get(this.url("/api/v2/monitoring/health/ping/"), companyId);
  }
}

export const PATHS = {
  clients: "/api/v2/management/clients/",
  subscriptions: "/api/v2/management/client-subscriptions/",
  classPasses: "/api/v2/management/client-class-passes/",
  bookings: "/api/v2/management/bookings/",
  invoices: "/api/v2/management/invoices/",
};
