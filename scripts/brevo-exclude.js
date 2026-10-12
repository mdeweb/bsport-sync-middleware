/**
 * Droit à l'oubli : ajoute un email à la liste d'exclusion (stocké haché).
 * Le contact sera supprimé de Brevo à la prochaine synchro et ne sera plus jamais renvoyé.
 *   node scripts/brevo-exclude.js personne@exemple.fr
 */
import "./_env.js";
import { loadConfig } from "../brevo/config.js";
import { ExclusionList } from "../brevo/exclusions.js";

const email = process.argv[2];
if (!email || !email.includes("@")) throw new Error("Usage : node scripts/brevo-exclude.js email@exemple.fr");
const list = new ExclusionList(loadConfig().dataDir);
list.add(email);
console.log(`Email ajouté à la liste d'exclusion (${list.size} entrée(s)).`);
