/**
 * Mini-lecteur de fichier .env (KEY=VALUE, # commentaires) — aucune
 * dépendance. Module séparé : server.mjs et les CLI l'importent sans
 * effet de bord (importer server.mjs démarrerait le serveur).
 */
import fs from 'node:fs';

export function chargerDotEnv(chemin) {
  if (!fs.existsSync(chemin)) return;
  for (const ligneBrute of fs.readFileSync(chemin, 'utf8').split(/\r?\n/)) {
    const ligne = ligneBrute.trim();
    if (!ligne || ligne.startsWith('#')) continue;
    const i = ligne.indexOf('=');
    if (i < 1) continue;
    const cle = ligne.slice(0, i).trim();
    let v = ligne.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[cle] === undefined) process.env[cle] = v;
  }
}
