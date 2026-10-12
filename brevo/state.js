import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";

/**
 * État conservé entre deux synchros (volume Railway, DATA_DIR) :
 * - lastDay : dernier jour dont les réservations et factures ont été comptées ;
 * (Les réservations arrivent désormais avec l'email du membre : plus de correspondance à garder.)
 * Sans DATA_DIR, chaque synchro repart de zéro et relit tout l'historique (plusieurs heures).
 */
export class SyncState {
  constructor(dataDir) {
    this.file = dataDir ? join(dataDir, "brevo-state.json") : null;
    this.lastDay = null;
    this.studioClients = {};
    if (this.file && existsSync(this.file)) {
      const data = JSON.parse(readFileSync(this.file, "utf8"));
      this.lastDay = data.lastDay || null;
    }
    if (!this.file) log("warn", "DATA_DIR non défini : la synchro relira tout l'historique à chaque passage");
  }

  clientsOf(studioId) {
    if (!this.studioClients[studioId]) this.studioClients[studioId] = {};
    return this.studioClients[studioId];
  }

  // --- Reprise du passage complet (brevo-backfill.json, à part car volumineux) ---
  get backfillFile() {
    return this.file ? join(this.file, "..", "brevo-backfill.json") : null;
  }

  loadBackfill() {
    if (!this.backfillFile || !existsSync(this.backfillFile)) return null;
    return JSON.parse(readFileSync(this.backfillFile, "utf8"));
  }

  saveBackfill(data) {
    if (!this.backfillFile) return;
    mkdirSync(join(this.backfillFile, ".."), { recursive: true });
    const tmp = `${this.backfillFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.backfillFile);
  }

  clearBackfill() {
    if (this.backfillFile && existsSync(this.backfillFile)) writeFileSync(this.backfillFile, "null");
  }

  save() {
    if (!this.file) return;
    mkdirSync(join(this.file, ".."), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ lastDay: this.lastDay }));
    renameSync(tmp, this.file); // écriture atomique : jamais de fichier à moitié écrit
  }
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
