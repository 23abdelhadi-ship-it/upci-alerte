<?php
/**
 * Page PUBLIQUE de suivi — le déclarant saisit son numéro ET sa
 * polyclinique : seuls le statut et les dates sont affichés.
 * Aucune autre donnée du registre n'est exposée.
 */
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/vue.php';

$cfg = upci_config();
$pdo = upci_db();

$numero = trim((string)($_GET['numero'] ?? ''));
$poly   = (string)($_GET['polyclinique'] ?? '');
$resultat = null;
$introuvable = false;

if ($numero !== '' && $poly !== '') {
    $st = $pdo->prepare('SELECT * FROM signalements WHERE numero = ? AND polyclinique = ? AND est_demo = 0');
    $st->execute([$numero, $poly]);
    $resultat = $st->fetch() ?: null;
    $introuvable = $resultat === null;
}

upci_page_debut('Suivi d’un signalement');
echo '<h1>Suivi de mon signalement</h1>'
    . '<p class="intro">Saisissez le numéro reçu à l’envoi <strong>et</strong> la polyclinique concernée.</p>'
    . '<form method="get" class="form">'
    . '<label>Numéro de signalement</label>'
    . '<input name="numero" value="' . h($numero) . '" placeholder="UPCI-2026-0001" required>'
    . '<label>Polyclinique</label><select name="polyclinique" required><option value="">— Choisir —</option>';
foreach ($cfg['sites'] as $s) {
    echo '<option' . ($poly === $s ? ' selected' : '') . '>' . h($s) . '</option>';
}
echo '</select><button class="btn" type="submit">Vérifier</button></form>';

if ($introuvable) {
    echo '<div class="alerte">Aucun signalement ne correspond à ce numéro et cette polyclinique. Vérifiez la saisie.</div>';
}
if ($resultat) {
    echo '<div class="recu"><h2>État du signalement ' . h($resultat['numero']) . '</h2><table class="ind">'
        . '<tr><th>Statut</th><td><strong>' . h(upci_statut_court($resultat)) . '</strong></td></tr>'
        . '<tr><th>Enregistré le</th><td>' . upci_fmt($resultat['date_creation']) . '</td></tr>'
        . '<tr><th>Pris en charge</th><td>' . ($resultat['pris_en_charge_le'] ? 'Oui — ' . upci_fmt($resultat['pris_en_charge_le']) : 'Pas encore') . '</td></tr>'
        . '<tr><th>Clôturé le</th><td>' . ($resultat['date_cloture'] ? upci_fmt($resultat['date_cloture']) : '—') . '</td></tr>'
        . '</table></div>';
}
upci_page_fin();
