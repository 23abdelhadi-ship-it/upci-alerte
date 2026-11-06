<?php
/**
 * Bootstrap commun — pages web et scripts CLI.
 * Charge la configuration, applique les surcharges par variables
 * d'environnement, définit les petites fonctions utilitaires.
 */
define('UPCI', true);

function upci_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require dirname(__DIR__) . '/config.php';
        // Surcharges par environnement (Docker / hébergement) — prioritaires.
        $env = [
            'telegram_token'          => 'UPCI_TELEGRAM_TOKEN',
            'telegram_webhook_secret' => 'UPCI_TELEGRAM_SECRET',
            'closure_key'             => 'UPCI_CLOSURE_KEY',
            'admin_password_hash'     => 'UPCI_ADMIN_HASH',
        ];
        foreach ($env as $cle => $var) {
            $v = getenv($var);
            if ($v !== false && $v !== '') {
                $cfg[$cle] = $v;
            }
        }
        $chats = getenv('UPCI_TELEGRAM_CHATS');
        if ($chats !== false && $chats !== '') {
            $cfg['telegram_chat_ids'] = array_values(array_filter(array_map('trim', explode(',', $chats))));
        }
        date_default_timezone_set($cfg['timezone'] ?? 'Africa/Algiers');
    }
    return $cfg;
}

/** Échappement HTML systématique à l'affichage. */
function h(?string $s): string
{
    return htmlspecialchars($s ?? '', ENT_QUOTES, 'UTF-8');
}

/** Date/heure courante au format ISO stocké en base (Y-m-d H:i:s). */
function upci_now(): string
{
    return date('Y-m-d H:i:s');
}

/** Formate une date ISO stockée pour l'affichage (d/m/Y H:i). */
function upci_fmt(?string $iso): string
{
    if (!$iso) {
        return '—';
    }
    $t = strtotime($iso);
    return $t ? date('d/m/Y H:i', $t) : h($iso);
}

/** URL de base de l'application (config ou détection automatique). */
function upci_base_url(): string
{
    $cfg = upci_config();
    if (!empty($cfg['base_url'])) {
        return rtrim($cfg['base_url'], '/');
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') == '443');
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $dir  = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    // Les pages admin sont dans /admin : remonter d'un niveau.
    if (basename($dir) === 'admin') {
        $dir = rtrim(dirname($dir), '/');
    }
    return ($https ? 'https' : 'http') . '://' . $host . ($dir === '/' ? '' : $dir);
}

/** « Janvier 2026 » — noms de mois statiques (aucune dépendance de locale). */
function upci_mois_nom(int $annee, int $mois): string
{
    $noms = [1 => 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet',
             'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    return ($noms[$mois] ?? $mois) . ' ' . $annee;
}

/** Un signalement est-il considéré « ouvert » (non clôturé) ? */
function upci_est_ouvert(array $sig): bool
{
    return empty($sig['date_cloture']);
}

/** Statut d'affichage court. */
function upci_statut_court(array $sig): string
{
    return (string)($sig['statut'] ?? 'En attente');
}
