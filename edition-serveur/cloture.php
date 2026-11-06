<?php
/**
 * Page INTERNE de clôture — réservée au/à la chef d'unité UPCI.
 * Protégée par la clé d'accès de config.php (closure_key).
 * NE JAMAIS diffuser son adresse ni sa clé (pas d'affiche, pas de QR public).
 */
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/notify.php';
require __DIR__ . '/lib/metier.php';
require __DIR__ . '/lib/vue.php';

$cfg = upci_config();
$pdo = upci_db();

session_start();
if (isset($_GET['sortir'])) {
    unset($_SESSION['upci_cloture']);
    header('Location: cloture.php');
    exit;
}

// La clé peut être fournie une fois (?cle=… ou formulaire) puis vit en session.
if (isset($_REQUEST['cle'])) {
    if (hash_equals((string)$cfg['closure_key'], (string)$_REQUEST['cle'])) {
        $_SESSION['upci_cloture'] = true;
    }
}
$autorise = !empty($_SESSION['upci_cloture']);

upci_page_debut('Clôture — interne UPCI');

if (($cfg['closure_key'] ?? '') === '' || $cfg['closure_key'] === 'CHANGEZ-CETTE-CLE') {
    echo '<div class="alerte"><strong>Configuration incomplète :</strong> la clé d’accès de clôture '
        . '(<code>closure_key</code> dans config.php) est encore la valeur d’exemple. '
        . 'Définissez une clé propre à votre établissement pour activer cette page.</div>';
    upci_page_fin();
    exit;
}

if (!$autorise) {
    echo '<h1>🔒 Page interne — clôture des signalements</h1>'
        . '<p class="intro">Réservée au/à la chef d’unité UPCI. Saisissez la clé d’accès interne.</p>'
        . '<form method="post" class="form"><label>Clé d’accès</label>'
        . '<input type="password" name="cle" required autocomplete="current-password">'
        . '<button class="btn" type="submit">Entrer</button></form>';
    upci_page_fin();
    exit;
}

$message = '';
$erreur = '';
$numeroPrefill = (string)($_GET['numero'] ?? '');
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['numero'])) {
    try {
        $message = upci_cloturer($pdo, (string)$_POST['numero'], $_POST, 'Chef UPCI (page de clôture)');
        $numeroPrefill = '';
    } catch (InvalidArgumentException $e) {
        $erreur = $e->getMessage();
    }
}

echo '<h1>Clôture d’un signalement</h1>'
    . '<p class="intro">La clôture met à jour la ligne du signalement dans le registre. '
    . 'Pour un cas <strong>critique</strong>, renseignez l’action corrective ; la vérification '
    . 'd’efficacité peut être consignée plus tard en réutilisant ce même formulaire avec le même numéro. '
    . '<a href="cloture.php?sortir=1">Verrouiller</a></p>';
if ($message) echo '<div class="ok">' . h($message) . '</div>';
if ($erreur)  echo '<div class="alerte">' . h($erreur) . '</div>';

echo '<form method="post" class="form">'
    . '<label>1. Numéro du signalement *</label>'
    . '<input name="numero" value="' . h($numeroPrefill) . '" placeholder="UPCI-2026-0001" required>'
    . '<label>2. Intervention réalisée *</label>'
    . '<textarea name="intervention" rows="3" placeholder="En une phrase factuelle : ce qui a réellement été fait."></textarea>'
    . '<label>3. Statut de clôture *</label><select name="statut" required>';
foreach ($cfg['statuts_cloture'] as $s) echo '<option>' . h($s) . '</option>';
echo '</select>'
    . '<label>4. Délai réel d’intervention</label><select name="delai_reel"><option value="">—</option>';
foreach ($cfg['delais_reels'] as $d) echo '<option>' . h($d) . '</option>';
echo '</select>'
    . '<label>5. Action corrective (cas critiques) — qu’est-ce qui a changé pour que cela ne se reproduise pas ?</label>'
    . '<textarea name="action_corrective" rows="2"></textarea>'
    . '<label>6. Vérification d’efficacité (cas critiques, peut être rempli plus tard avec le même numéro)</label>'
    . '<textarea name="verif_efficacite" rows="2" placeholder="Ex. : contrôle sur place le … — problème disparu."></textarea>'
    . '<button class="btn gros" type="submit">✔ Enregistrer la clôture</button></form>';
upci_page_fin();
