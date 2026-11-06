/**
 * Amorçage CLI partagé (Node) — charge .env, ouvre la base SQLite,
 * applique schéma + réglages en base, retourne le contexte métier.
 * Utilisé par init / seed_demo / purge_demo / cron / hash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { construireConfig } from '../src/config.js';
import { adaptateurSqlite, garantirSchema } from '../src/db.js';
import { creerContexte } from '../src/context.js';
import { chargerReglages } from '../src/settings.js';
import { chargerDotEnv } from '../src/dotenv.js';

export const RACINE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function contexteCli() {
  chargerDotEnv(path.join(RACINE, '.env'));
  const cfg = construireConfig(process.env);
  const cheminBase = path.isAbsolute(cfg.db_path) ? cfg.db_path : path.join(RACINE, cfg.db_path);
  fs.mkdirSync(path.dirname(cheminBase), { recursive: true });
  const baseSync = new DatabaseSync(cheminBase);
  baseSync.exec('PRAGMA journal_mode = WAL');
  baseSync.exec('PRAGMA busy_timeout = 5000');
  const db = adaptateurSqlite(baseSync);
  await garantirSchema(db);
  const ctx = creerContexte({ db, cfg, plateforme: 'node' });
  await chargerReglages(ctx);
  ctx.cheminBase = cheminBase;
  ctx.fermer = () => baseSync.close();
  return ctx;
}
