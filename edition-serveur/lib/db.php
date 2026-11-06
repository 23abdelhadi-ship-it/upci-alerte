<?php
/**
 * Couche base de données — SQLite via PDO, zéro dépendance.
 * Le registre, le journal d'audit et les compteurs vivent dans UN fichier :
 * data/upci.sqlite (sauvegarde = copie de ce fichier).
 */
defined('UPCI') or exit;

function upci_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $cfg  = upci_config();
    $path = $cfg['db_path'];
    $dir  = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA foreign_keys = ON');
    upci_schema($pdo);
    return $pdo;
}

function upci_schema(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
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
    types             TEXT NOT NULL DEFAULT '[]',   -- JSON : types d'incident (choix multiple)
    gravite           INTEGER NOT NULL DEFAULT 0,
    action_immediate  TEXT NOT NULL DEFAULT '',
    mesures           TEXT NOT NULL DEFAULT '[]',   -- JSON : mesures prises
    delai_demande     TEXT NOT NULL DEFAULT '',
    email_declarant   TEXT NOT NULL DEFAULT '',     -- interne : notification de clôture
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
    telegram_msgs     TEXT NOT NULL DEFAULT '[]',   -- JSON [{chat_id, message_id}]
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
SQL);
}

/** Journal d'audit — ajout seul (append-only), jamais modifié ni effacé. */
function upci_journal(PDO $pdo, string $numero, string $acteur, string $action, string $detail = ''): void
{
    $st = $pdo->prepare('INSERT INTO journal (horodatage, numero, acteur, action, detail) VALUES (?, ?, ?, ?, ?)');
    $st->execute([upci_now(), $numero, $acteur, $action, $detail]);
}

function upci_meta_get(PDO $pdo, string $cle): ?string
{
    $st = $pdo->prepare('SELECT valeur FROM meta WHERE cle = ?');
    $st->execute([$cle]);
    $v = $st->fetchColumn();
    return $v === false ? null : (string)$v;
}

function upci_meta_set(PDO $pdo, string $cle, string $valeur): void
{
    $st = $pdo->prepare('INSERT INTO meta (cle, valeur) VALUES (?, ?)
                         ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur');
    $st->execute([$cle, $valeur]);
}

/** Récupère un signalement par son numéro (ou null). */
function upci_par_numero(PDO $pdo, string $numero): ?array
{
    $st = $pdo->prepare('SELECT * FROM signalements WHERE numero = ?');
    $st->execute([$numero]);
    $r = $st->fetch();
    return $r ?: null;
}
