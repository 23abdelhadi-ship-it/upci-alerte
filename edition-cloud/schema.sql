-- =====================================================================
-- UPCI ALERT — édition JavaScript portable • SCHÉMA DE BASE (SQLite/D1)
-- =====================================================================
-- Ce fichier sert à initialiser la base Cloudflare D1 :
--   npx wrangler d1 execute upci --remote --file=schema.sql
-- Sous Node.js, le schéma est créé automatiquement au premier démarrage
-- (même DDL, dans src/db.js). Dialecte SQLite commun aux deux domiciles.
-- =====================================================================
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
-- Réglages de l'établissement (page /installation puis /admin/reglages) :
-- établissement, polycliniques, emails, Telegram, seuils, accès protégés.
CREATE TABLE IF NOT EXISTS reglages (
    cle    TEXT PRIMARY KEY,
    valeur TEXT NOT NULL DEFAULT ''
);
