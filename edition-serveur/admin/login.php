<?php
/** Connexion à la zone admin — mot de passe unique (empreinte dans config.php). */
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/vue.php';

$cfg = upci_config();
session_start();
if (!empty($_SESSION['upci_admin'])) {
    header('Location: index.php');
    exit;
}

$erreur = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $hash = (string)($cfg['admin_password_hash'] ?? '');
    if ($hash !== '' && password_verify((string)($_POST['motdepasse'] ?? ''), $hash)) {
        session_regenerate_id(true);
        $_SESSION['upci_admin'] = true;
        header('Location: index.php');
        exit;
    }
    sleep(1); // ralentit les tentatives par force brute
    $erreur = 'Mot de passe incorrect.';
}

upci_page_debut('Administration — connexion', '../');
echo '<h1>🔒 Administration UPCI</h1>';
if (($cfg['admin_password_hash'] ?? '') === '') {
    echo '<div class="alerte"><strong>Zone admin non activée :</strong> aucune empreinte de mot de passe '
        . 'n’est définie. Générez-la sur le serveur avec :<br>'
        . '<code>php -r "echo password_hash(\'VotreMotDePasse\', PASSWORD_DEFAULT), PHP_EOL;"</code><br>'
        . 'puis collez le résultat dans <code>admin_password_hash</code> (config.php) '
        . 'ou dans la variable d’environnement <code>UPCI_ADMIN_HASH</code>.</div>';
} else {
    if ($erreur) echo '<div class="alerte">' . h($erreur) . '</div>';
    echo '<form method="post" class="form"><label>Mot de passe administrateur</label>'
        . '<input type="password" name="motdepasse" required autocomplete="current-password">'
        . '<button class="btn" type="submit">Entrer</button></form>';
}
upci_page_fin();
