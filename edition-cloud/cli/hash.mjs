/**
 * Génère l'empreinte PBKDF2 d'un mot de passe administrateur.
 *   node cli/hash.mjs 'VotreMotDePasse'
 * Collez le résultat dans la variable UPCI_ADMIN_HASH (.env / secret
 * Workers) — ou, plus simple, définissez le mot de passe directement
 * dans la page /installation ou /admin/reglages (stocké en base).
 */
import { hacherMotDePasse } from '../src/util.js';

const mdp = process.argv[2];
if (!mdp) {
  console.error("Usage : node cli/hash.mjs 'VotreMotDePasse'");
  process.exit(1);
}
console.log(await hacherMotDePasse(mdp));
