<?php
/**
 * Formulaire PUBLIC de signalement — mêmes questions fermées que
 * l'édition Apps Script. Aucune donnée patient, aucun champ libre
 * (hors email facultatif du déclarant). Objectif : moins de 60 secondes.
 */
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/notify.php';
require __DIR__ . '/lib/metier.php';
require __DIR__ . '/lib/vue.php';

$cfg = upci_config();
$pdo = upci_db();

// --- Reçu après envoi (patron PRG : pas de double envoi au rafraîchissement)
if (isset($_GET['recu'])) {
    $sig = upci_par_numero($pdo, (string)$_GET['recu']);
    upci_page_debut('Signalement enregistré');
    if ($sig && empty($sig['est_demo'])) {
        echo '<div class="recu"><h1>✅ Signalement enregistré</h1>'
            . '<p>Votre numéro de signalement :</p>'
            . '<div class="numero">' . h($sig['numero']) . '</div>'
            . '<p>Polyclinique : ' . h($sig['polyclinique']) . '<br>'
            . 'Conservez ce numéro : il vous permet de suivre l’état du traitement.</p>'
            . '<p><a class="btn" href="statut.php?numero=' . urlencode($sig['numero']) . '">Suivre mon signalement</a></p>'
            . '<p class="note">L’unité UPCI a été alertée immédiatement'
            . ($sig['email_declarant'] ? ' ; un accusé de réception vient de vous être envoyé par email.' : '.')
            . '</p></div>';
    } else {
        echo '<div class="alerte">Numéro introuvable.</div>';
    }
    upci_page_fin();
    exit;
}

// --- Traitement du formulaire
$erreurs = [];
$val = [
    'polyclinique' => (string)($_GET['site'] ?? ''),
    'service' => '', 'lieu' => '', 'periode' => '',
    'types' => [], 'gravite' => '', 'action_immediate' => '',
    'mesures' => [], 'delai_demande' => '', 'email_declarant' => '',
];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    foreach (['polyclinique', 'service', 'lieu', 'periode', 'gravite', 'action_immediate', 'delai_demande', 'email_declarant'] as $k) {
        $val[$k] = trim((string)($_POST[$k] ?? ''));
    }
    $val['types']   = array_values(array_intersect((array)($_POST['types'] ?? []), $cfg['types_urgence']));
    $val['mesures'] = array_values(array_intersect((array)($_POST['mesures'] ?? []), $cfg['mesures']));

    if (!in_array($val['polyclinique'], $cfg['sites'], true))        $erreurs[] = 'Choisissez la polyclinique.';
    if (!in_array($val['service'], $cfg['services'], true))          $erreurs[] = 'Choisissez le service.';
    if ($val['lieu'] !== '' && !in_array($val['lieu'], $cfg['lieux'], true)) $erreurs[] = 'Lieu précis invalide.';
    if (!in_array($val['periode'], $cfg['periodes'], true))          $erreurs[] = 'Choisissez la période.';
    if (!$val['types'])                                              $erreurs[] = 'Choisissez au moins un type d’incident.';
    $g = (int)$val['gravite'];
    if ($g < 1 || $g > 5)                                            $erreurs[] = 'Indiquez la gravité (1 à 5).';
    if (!in_array($val['action_immediate'], $cfg['actions_immediates'], true)) $erreurs[] = 'Avez-vous agi immédiatement ?';
    if (!in_array($val['delai_demande'], $cfg['delais_souhaites'], true))      $erreurs[] = 'Choisissez le délai souhaité.';
    if ($val['email_declarant'] !== '' && !filter_var($val['email_declarant'], FILTER_VALIDATE_EMAIL)) {
        $erreurs[] = 'Email du déclarant invalide (il est facultatif).';
    }

    if (!$erreurs) {
        $sig = upci_creer_signalement($pdo, $val);
        header('Location: index.php?recu=' . urlencode($sig['numero']));
        exit;
    }
}

// --- Affichage du formulaire
upci_page_debut('Signaler un incident');
echo '<h1>Signaler un incident — الوقاية من العدوى</h1>'
    . '<p class="intro">Questions fermées uniquement, moins d’une minute. '
    . '<strong>N’indiquez jamais de nom ni de donnée de patient.</strong></p>';
if ($erreurs) {
    echo '<div class="alerte"><strong>À corriger :</strong><ul>';
    foreach ($erreurs as $e) echo '<li>' . h($e) . '</li>';
    echo '</ul></div>';
}
$sel = fn($a, $b) => $a === $b ? ' selected' : '';
$chk = fn($arr, $v) => in_array($v, $arr, true) ? ' checked' : '';
echo '<form method="post" class="form">';
echo '<label>1. Polyclinique *</label><select name="polyclinique" required>';
echo '<option value="">— Choisir —</option>';
foreach ($cfg['sites'] as $s) echo '<option' . $sel($val['polyclinique'], $s) . '>' . h($s) . '</option>';
echo '</select>';
echo '<label>2. Service *</label><select name="service" required><option value="">— Choisir —</option>';
foreach ($cfg['services'] as $s) echo '<option' . $sel($val['service'], $s) . '>' . h($s) . '</option>';
echo '</select>';
echo '<label>3. Lieu précis</label><select name="lieu"><option value="">— Choisir (facultatif) —</option>';
foreach ($cfg['lieux'] as $s) echo '<option' . $sel($val['lieu'], $s) . '>' . h($s) . '</option>';
echo '</select>';
echo '<label>4. Période *</label><div class="choix">';
foreach ($cfg['periodes'] as $p) {
    echo '<label class="opt"><input type="radio" name="periode" value="' . h($p) . '"' . $chk([$val['periode']], $p) . '> ' . h($p) . '</label>';
}
echo '</div>';
echo '<label>5. Type d’incident * (plusieurs choix possibles)</label><div class="choix">';
foreach ($cfg['types_urgence'] as $t) {
    echo '<label class="opt"><input type="checkbox" name="types[]" value="' . h($t) . '"' . $chk($val['types'], $t) . '> ' . h($t) . '</label>';
}
echo '</div>';
echo '<label>6. Gravité * (4 et 5 = critique, escalade automatique)</label><div class="choix gravite">';
for ($i = 1; $i <= 5; $i++) {
    echo '<label class="opt"><input type="radio" name="gravite" value="' . $i . '"' . $chk([$val['gravite']], (string)$i) . '> ' . $i . '</label>';
}
echo '</div>';
echo '<label>7. Avez-vous agi immédiatement ? *</label><div class="choix">';
foreach ($cfg['actions_immediates'] as $a) {
    echo '<label class="opt"><input type="radio" name="action_immediate" value="' . h($a) . '"' . $chk([$val['action_immediate']], $a) . '> ' . h($a) . '</label>';
}
echo '</div>';
echo '<label>8. Mesures prises</label><div class="choix">';
foreach ($cfg['mesures'] as $m) {
    echo '<label class="opt"><input type="checkbox" name="mesures[]" value="' . h($m) . '"' . $chk($val['mesures'], $m) . '> ' . h($m) . '</label>';
}
echo '</div>';
echo '<label>9. Délai d’intervention souhaité *</label><div class="choix">';
foreach ($cfg['delais_souhaites'] as $d) {
    echo '<label class="opt"><input type="radio" name="delai_demande" value="' . h($d) . '"' . $chk([$val['delai_demande']], $d) . '> ' . h($d) . '</label>';
}
echo '</div>';
echo '<label>Votre email (facultatif) — pour recevoir l’accusé et l’avis de clôture</label>'
    . '<input type="email" name="email_declarant" value="' . h($val['email_declarant']) . '" autocomplete="email">';
echo '<button class="btn gros" type="submit">📨 Envoyer le signalement</button>';
echo '</form>';
upci_page_fin();
