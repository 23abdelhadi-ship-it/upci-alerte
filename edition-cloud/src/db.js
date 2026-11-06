/**
 * Couche base de données — ADAPTATEUR UNIQUE au-dessus de deux moteurs
 * au même dialecte SQL (SQLite) :
 *   - Cloudflare D1            (liaison env.DB)
 *   - node:sqlite (Node ≥ 22.5, fichier local) — zéro dépendance.
 *
 * Interface asynchrone commune consommée par TOUTE la logique métier :
 *   db.all(sql, params)   → tableau de lignes (objets)
 *   db.first(sql, params) → ligne ou null
 *   db.run(sql, params)   → résultat d'écriture
 *   db.exec(sql)          → SQL brut (DDL)
 * Le registre, le journal d'audit, les compteurs, les méta et les
 * RÉGLAGES vivent dans la même base : la sauvegarde = la copie du
 * fichier SQLite (Node) ou l'export D1 (Workers).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS compteurs (
    annee   INTEGER PRIMARY KEY,
    dernier INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS signalements (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    numero            TEXT UNIQUE NOT NULL,
    date_creation     TEXT NOT NULL,
    polyclinique      TEXT NOT NULL,
    service           TEXT NOT NULL DEFAULT '',
    lieu              TEXT NOT NULL DEFAULT '',
    periode           TEXT NOT NULL DEFAULT '',
    types             TEXT NOT NULL DEFAULT '[]',
    gravite           INTEGER NOT NULL DEFAULT 0,
    action_immediate  TEXT NOT NULL DEFAULT '',
    mesures           TEXT NOT NULL DEFAULT '[]',
    delai_demande     TEXT NOT NULL DEFAULT '',
    email_declarant   TEXT NOT NULL DEFAULT '',
    statut            TEXT NOT NULL DEFAULT 'En attente',
    est_critique      INTEGER NOT NULL DEFAULT 0,
    intervention      TEXT NOT NULL DEFAULT '',
    delai_reel        TEXT NOT NULL DEFAULT '',
    date_cloture      TEXT,
    duree_h           REAL,
    action_corrective TEXT NOT NULL DEFAULT '',
    verif_efficacite  TEXT NOT NULL DEFAULT '',
    pris_en_charge_le TEXT,
    accuse_par        TEXT NOT NULL DEFAULT '',
    relance_1h_le     TEXT,
    escalade_4h_le    TEXT,
    relance_accuse_le TEXT,
    relance_verif_le  TEXT,
    telegram_msgs     TEXT NOT NULL DEFAULT '[]',
    est_demo          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sig_date ON signalements(date_creation);
CREATE INDEX IF NOT EXISTS idx_sig_poly ON signalements(polyclinique);
CREATE TABLE IF NOT EXISTS journal (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    horodatage TEXT NOT NULL,
    numero     TEXT NOT NULL DEFAULT '',
    acteur     TEXT NOT NULL DEFAULT '',
    action     TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS meta (
    cle    TEXT PRIMARY KEY,
    valeur TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS reglages (
    cle    TEXT PRIMARY KEY,
    valeur TEXT NOT NULL DEFAULT ''
);
`;

/** Crée les tables si besoin (idempotent, sûr à chaque démarrage). */
export async function garantirSchema(db) {
  for (const stmt of SCHEMA_SQL.split(';')) {
    const sql = stmt.trim();
    if (sql) await db.run(sql);
  }
}

/** Adaptateur Cloudflare D1. */
export function adaptateurD1(d1) {
  return {
    type: 'd1',
    async all(sql, params = []) {
      const r = await d1.prepare(sql).bind(...params).all();
      return r.results ?? [];
    },
    async first(sql, params = []) {
      const r = await d1.prepare(sql).bind(...params).first();
      return r ?? null;
    },
    async run(sql, params = []) {
      return d1.prepare(sql).bind(...params).run();
    },
    async exec(sql) {
      await d1.exec(sql);
    },
  };
}

/** Adaptateur node:sqlite (DatabaseSync synchrone, enveloppé en async). */
export function adaptateurSqlite(baseSync) {
  return {
    type: 'sqlite',
    async all(sql, params = []) {
      return baseSync.prepare(sql).all(...params);
    },
    async first(sql, params = []) {
      return baseSync.prepare(sql).get(...params) ?? null;
    },
    async run(sql, params = []) {
      return baseSync.prepare(sql).run(...params);
    },
    async exec(sql) {
      baseSync.exec(sql);
    },
  };
}
