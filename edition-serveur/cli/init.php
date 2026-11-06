<?php
/**
 * Initialisation / vérification d'installation.
 *   php cli/init.php              → crée la base et vérifie la configuration
 *   php cli/init.php --webhook    → enregistre le webhook Telegram (base_url requis)
 */
if (PHP_SAPI !== 'cli') { exit("CLI uniquement.\n"); }
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/db.php';
require dirname(__DIR__) . '/lib/notify.php';

$cfg = upci_config();
$ok = true;
$ligne = function (bool $bon, string $txt) use (&$ok) {
    echo ($bon ? '  ✅ ' : '  ❌ ') . $txt . "\n";
    if (!$bon) $ok = false;
};
$warn = fn(string $txt) => print('  ⚠️  ' . $txt . "\n");

echo "UPCI Alert — édition serveur : initialisation\n";
$ligne(PHP_VERSION_ID >= 80000, 'PHP >= 8.0 (actuel : ' . PHP_VERSION . ')');
$ligne(extension_loaded('pdo_sqlite'), 'Extension pdo_sqlite chargée');
$ligne(is_writable(dirname($cfg['db_path'])), 'Dossier data/ accessible en écriture');

$pdo = upci_db();
$ligne(true, 'Base SQLite créée/vérifiée : ' . $cfg['db_path']);
$nb = (int)$pdo->query('SELECT COUNT(*) FROM signalements')->fetchColumn();
echo "     Signalements actuellement au registre : $nb\n";

if (($cfg['closure_key'] ?? '') === 'CHANGEZ-CETTE-CLE' || ($cfg['closure_key'] ?? '') === '') {
    $warn('closure_key est encore la valeur d’exemple : la page de clôture restera verrouillée. Changez-la dans config.php.');
}
if (($cfg['admin_password_hash'] ?? '') === '') {
    $warn('admin_password_hash vide : zone admin verrouillée. Générez une empreinte :');
    echo "       php -r \"echo password_hash('VotreMotDePasse', PASSWORD_DEFAULT), PHP_EOL;\"\n";
}
if (($cfg['telegram_token'] ?? '') === '' || empty($cfg['telegram_chat_ids'])) {
    $warn('Telegram non configuré (token et/ou chat ids) : alertes email uniquement.');
}
if (($cfg['base_url'] ?? '') === '') {
    $warn('base_url vide : les liens des emails/affiches seront détectés automatiquement (à éviter en production).');
}

if (in_array('--webhook', $argv, true)) {
    if (($cfg['base_url'] ?? '') === '') {
        $ligne(false, 'Webhook : base_url est requis dans config.php.');
    } elseif (($cfg['telegram_token'] ?? '') === '') {
        $ligne(false, 'Webhook : telegram_token manquant.');
    } else {
        $params = ['url' => rtrim($cfg['base_url'], '/') . '/webhook.php'];
        if (!empty($cfg['telegram_webhook_secret'])) {
            $params['secret_token'] = $cfg['telegram_webhook_secret'];
        }
        $res = upci_tg_api('setWebhook', $params);
        $ligne($res !== null, 'Webhook Telegram enregistré : ' . $params['url']);
    }
}

echo $ok ? "\nInstallation prête. Lancez ensuite : php cli/seed_demo.php (démonstration) ou servez le dossier via Apache/Nginx.\n"
         : "\nDes points bloquants subsistent — corrigez-les puis relancez.\n";
exit($ok ? 0 : 1);
