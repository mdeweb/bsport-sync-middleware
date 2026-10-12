import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Liste d'exclusion (droit à l'oubli) : les emails y sont stockés hachés, jamais en clair.
 * Un email présent ici n'est plus jamais envoyé à Brevo, même s'il reste dans Bsport.
 * Nécessite un dossier persistant (DATA_DIR, volume Railway). Sans DATA_DIR, la liste est vide.
 */
export function hashEmail(email) {
  return createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
}

export class ExclusionList {
  constructor(dataDir) {
    this.file = dataDir ? join(dataDir, "brevo-exclusions.json") : null;
    this.hashes = new Set();
    if (this.file && existsSync(this.file)) {
      this.hashes = new Set(JSON.parse(readFileSync(this.file, "utf8")));
    }
  }

  has(email) {
    return this.hashes.has(hashEmail(email));
  }

  add(email) {
    if (!this.file) throw new Error("DATA_DIR n'est pas défini : impossible d'enregistrer une exclusion.");
    this.hashes.add(hashEmail(email));
    mkdirSync(join(this.file, ".."), { recursive: true });
    writeFileSync(this.file, JSON.stringify([...this.hashes], null, 2));
  }

  get size() {
    return this.hashes.size;
  }
}
