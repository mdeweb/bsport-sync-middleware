# Synchro Bsport → Brevo (TSG, Sanctuary Pass)

Module ajouté à côté du middleware existant. `index.js` n'a pas été modifié.

## Ce que fait la synchro

Une fois par jour à 16h (heure de Paris) :

1. lit tous les membres du Sanctuary Pass (studio 4781) dans l'API publique Bsport v2 ;
   puis, dans chaque studio des marques (`BSPORT_SOURCE_STUDIOS`), les abonnements, carnets,
   réservations honorées et factures, rattachés au membre par son email ;
2. écarte les fiches sans email valide et les emails de la liste d'exclusion ;
3. fusionne les fiches qui partagent le même email ;
4. envoie les contacts à Brevo par lots, dans une liste unique ;
5. bloque à l'envoi les membres sans accord marketing ;
6. met à jour l'adresse d'un contact quand le membre a changé d'email dans Bsport ;
7. supprime de Brevo les membres supprimés dans Bsport.

Elle ne réinscrit jamais un contact qui s'est désinscrit dans Brevo.

## Volume et modes

Le Sanctuary Pass compte environ 420 000 membres, et les 8 studios des marques autant de fiches.

- **Premier passage (mode complet)** : lit tout l'historique des réservations et factures. Plusieurs heures. Se lance une fois, à la main de préférence : `node scripts/brevo-sync-once.js --full`.
- **Passages suivants (mode quotidien)** : relit la base Sanctuary Pass (environ une heure, pour les consentements et suppressions), les abonnements et les carnets actifs, mais seulement les réservations et factures des jours écoulés depuis la dernière synchro. Ces nouveautés s'ajoutent aux totaux déjà dans Brevo.
- **État** : seul le dernier jour traité est gardé dans `DATA_DIR/brevo-state.json`. Sur un serveur neuf, `BREVO_LAST_DAY` (AAAA-MM-JJ) donne ce dernier jour pour démarrer directement en mode quotidien. Sur Railway, `DATA_DIR` doit pointer vers un volume.
- **Rattachement par email** : réservations, factures et abonnements sont demandés avec `expand[]=client_id`, qui joint la fiche du membre (donc son email). Les fiches membres des studios ne sont plus relues.
- Tout est lu page par page : les millions de réservations ne sont jamais gardées en mémoire en même temps.
- **Réservations et factures sont lues mois par mois** (depuis `BSPORT_BACKFILL_FROM`, 2018 par défaut) et les carnets sur les 24 derniers mois : Bsport répond en 502/504 quand on lui demande des pages trop lointaines.
- **Reprise** : un passage complet interrompu reprend au dernier studio terminé (`DATA_DIR/brevo-backfill.json`). Un passage à blanc complet sert aussi au passage réel suivant.
- **Contacts seuls** : `node scripts/brevo-sync-once.js --contacts-only` importe la base Sanctuary Pass sans l'activité (environ une heure), pour que TSG puisse commencer pendant que l'historique se charge.

## Garde-fous

- `BREVO_SYNC_ENABLED=false` (valeur par défaut) : tout est calculé, rien n'est écrit dans Brevo.
- Si la lecture Bsport échoue ou renvoie 0 membre, la synchro s'arrête avant toute écriture.
- Plus de 20 suppressions (ou 2 % de la liste) d'un coup : les suppressions sont bloquées et une alerte part.
- Les contacts Brevo de l'import d'août 2025 inconnus de Bsport ne sont pas touchés. Ils sont comptés dans le rapport (`orphans`).

## Mise en route

1. Copier `.env.example` en `.env` et saisir les clés.
2. Vérifier l'accès Bsport et compter la base (lecture seule, aucune donnée personnelle affichée) :
   `node scripts/bsport-explore.js`
   Le fichier `bsport-structure.json` donne les volumes et les consentements de la base Sanctuary Pass.
3. Voir ce qui manque dans Brevo : `node scripts/brevo-setup.js`, puis `node scripts/brevo-setup.js --apply` pour créer les attributs.
4. Créer la liste dans Brevo et reporter son numéro dans `BREVO_LIST_ID`.
5. Synchro à blanc : `node scripts/brevo-sync-once.js --dry`. Lire les compteurs.
6. Brancher sur le middleware, dans `index.js` :
   ```js
   import { registerBrevoSync } from "./brevo/register.js";
   registerBrevoSync(app); // juste avant app.listen
   ```
7. Sur Railway : ajouter les variables, déployer, puis passer `BREVO_SYNC_ENABLED=true` après la recette.

## Déploiement sur Railway (projet « brave-delight », service « bsport-sync-middleware »)

1. **Code** : copier les dossiers `brevo/` et `scripts/` à côté de `index.js`, puis dans `index.js`, juste avant `app.listen` :
   ```js
   import { registerBrevoSync } from "./brevo/register.js"; // en haut du fichier
   registerBrevoSync(app);
   ```
   Aucune dépendance à ajouter : la synchro n'utilise que Node.js 18+ et express, déjà présents.
2. **Volume** : clic droit sur le service › *Attach volume*, point de montage `/data`.
3. **Variables** (onglet *Variables*, les variables Bsport existantes sont réutilisées) :
   - `DATA_DIR=/data`
   - `BSPORT_SOURCE_STUDIOS` et `BREVO_BRANDS` : copier les valeurs du `.env` local
   - `BREVO_API_KEY`, `BREVO_LIST_ID` (et `BREVO_STAFF_LIST_ID` si une liste staff est créée)
   - `BREVO_SYNC_SECRET` : une longue chaîne aléatoire, pour le lancement manuel
   - `BREVO_LAST_DAY=2026-10-09` : dernier jour importé par le chargement complet du 11/10/2026
   - `BREVO_SYNC_ENABLED=true`
4. **Déployer**, puis vérifier dans les logs la ligne « Synchro Brevo planifiée ».
5. **Ne plus lancer la synchro depuis un poste** une fois Railway en route : en mode quotidien les compteurs s'additionnent, deux passages sur les mêmes jours les compteraient deux fois.
6. **Suivi** : `GET /sync/brevo/status` avec l'en-tête `X-Sync-Secret` donne le dernier rapport.

## Commandes

| Commande | Effet |
|---|---|
| `node --test test/sync.test.js` | Lance les 37 tests |
| `node scripts/bsport-explore.js [chemins…]` | Structure des réponses Bsport |
| `node scripts/brevo-setup.js [--apply]` | Attributs et listes Brevo |
| `node scripts/brevo-sync-once.js [--dry] [--ecrire] [--full]` | Synchro immédiate (`--full` : tout l'historique) |
| `node scripts/brevo-check.js` | Après un import : lots traités par Brevo et nombre de contacts |
| `node scripts/bsport-count.js` | Compte rapide des membres (quelques secondes) |
| `node scripts/brevo-exclude.js email` | Droit à l'oubli |

Lancement manuel en production : `POST /sync/brevo` avec l'en-tête `X-Sync-Secret`.
Dernier rapport : `GET /sync/brevo/status` (compteurs uniquement).

## Ce qui reste à confirmer

- **Source** : API publique Bsport v2 (`public.production.bsport.io`), documentation sur api-docs.production.bsport.io.
- **Accord marketing** : le middleware crée les membres dans le Sanctuary Pass avec l'accord à `true`, à la demande de TSG. Sans information, le membre est considéré comme ayant accepté (décision TSG du 5 octobre 2026).
- **Non disponible dans l'API** : date du consentement, source d'acquisition. Les disciplines demandent une lecture des cours, prévue dans un second temps.
- **Notes clients** : jamais lues, elles peuvent contenir des informations médicales.
- **Désinscrits Brevo** : vérifier en recette qu'un import ne réinscrit pas un contact désinscrit.
- **Marques** : liste des marques et studios à saisir dans `BREVO_BRANDS`.
