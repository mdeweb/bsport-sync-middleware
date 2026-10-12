// Charge le fichier .env local s'il existe (Node 20.12+). Sur Railway, les variables sont déjà là.
import { existsSync } from "node:fs";
if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
