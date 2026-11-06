/**
 * Point d'entrée NODE.JS ≥ 20 — serveur d'établissement (réseau local).
 * Ne contient QUE l'adaptation plateforme : HTTP natif (node:http)
 * adapté en Request/Response Web-standard, base SQLite fichier
 * (node:sqlite, zéro dépendance), minuterie interne de 30 minutes
 * pour les contrôles périodiques, sauvegarde hebdomadaire du fichier.
 * Toute la logique est dans src/ — partagée avec Cloudflare Workers.
 *
 * Lancement : node server.mjs   (voir INSTALL.md : service systemd /
 * NSSM sous Windows, fichier .env à la racine du projet).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chargerDotEnv } from './src/dotenv.js';
import { construireConfig } from './src/config.js';
import { adaptateurSqlite, garantirSchema } from './src/db.js';
import { creerContexte } from './src/context.js';
import { chargerReglages } from './src/settings.js';
import { creerGestionnaire } from './src/app.js';
import { runPeriodicChecks } from './src/cron.js';

const RACINE = path.dirname(fileURLToPath(import.meta.url));

chargerDotEnv(path.join(RACINE, '.env'));

const cfg = construireConfig(process.env);
const cheminBase = path.isAbsolute(cfg.db_path) ? cfg.db_path : path.join(RACINE, cfg.db_path);
fs.mkdirSync(path.dirname(cheminBase), { recursive: true });
const baseSync = new DatabaseSync(cheminBase);
baseSync.exec('PRAGMA journal_mode = WAL');
baseSync.exec('PRAGMA busy_timeout = 5000');
baseSync.exec('PRAGMA foreign_keys = ON');
const db = adaptateurSqlite(baseSync);
await garantirSchema(db);

// --- Sauvegarde : la base tient en UN fichier (copie propre VACUUM INTO).
const dirSauvegardes = path.join(path.dirname(cheminBase), 'sauvegardes');
async function doBackup() {
  fs.mkdirSync(dirSauvegardes, { recursive: true });
  const horodate = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  let cible = path.join(dirSauvegardes, `upci-${horodate}.sqlite`);
  if (fs.existsSync(cible)) cible = path.join(dirSauvegardes, `upci-${horodate}-${Date.now() % 10000}.sqlite`);
  await db.exec(`VACUUM INTO '${cible.replaceAll("'", "''")}'`);
  return cible;
}
async function backupAgeJours() {
  try {
    const fichiers = fs.readdirSync(dirSauvegardes).filter((f) => /^upci-.*\.sqlite$/.test(f));
    if (!fichiers.length) return null;
    const plusRecent = Math.max(...fichiers.map((f) => fs.statSync(path.join(dirSauvegardes, f)).mtimeMs));
    return (Date.now() - plusRecent) / 86400000;
  } catch {
    return null;
  }
}

const ctx = creerContexte({ db, cfg, plateforme: 'node', doBackup, backupAgeJours });
await chargerReglages(ctx);
const gestionnaire = creerGestionnaire(ctx);

const serveur = http.createServer(async (req, res) => {
  try {
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    const corps = Buffer.concat(morceaux);
    const url = `http://${req.headers.host || 'localhost'}${req.url}`;
    const entetes = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) entetes.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    const request = new Request(url, {
      method: req.method,
      headers: entetes,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : corps,
    });
    // Les réglages en base sont relus à chaque requête : une modification
    // dans /admin/reglages est active immédiatement, sans redémarrage.
    ctx.reglagesCharges = false;
    await chargerReglages(ctx);
    const response = await gestionnaire(request);
    const tampon = Buffer.from(await response.arrayBuffer());
    const sortie = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') sortie[k] = v; });
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie() : [];
    if (cookies.length) sortie['set-cookie'] = cookies;
    res.writeHead(response.status, sortie);
    res.end(tampon);
  } catch (e) {
    console.error('UPCI serveur :', e);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Erreur interne du système UPCI.');
  }
});

const port = Number(process.env.PORT || 8080);
const hote = process.env.HOST || '0.0.0.0';
serveur.listen(port, hote, () => {
  console.log(`UPCI Alert (édition portable, Node) — écoute sur http://${hote}:${port}`);
  console.log(`Base SQLite : ${cheminBase}`);
});

// Minuterie interne : contrôles périodiques toutes les 30 minutes
// (désactivable : UPCI_SANS_MINUTERIE=1 si un planificateur externe s'en charge).
if (process.env.UPCI_SANS_MINUTERIE !== '1') {
  const minuterie = setInterval(async () => {
    try {
      ctx.reglagesCharges = false;
      await chargerReglages(ctx);
      await runPeriodicChecks(ctx, {});
    } catch (e) {
      console.error('UPCI minuterie :', e);
    }
  }, 30 * 60 * 1000);
  minuterie.unref();
}
