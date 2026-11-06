<?php
/** Journal d'audit — ajout seul : créations, accusés, relances, escalades, clôtures… */
require __DIR__ . '/_garde.php';

$pdo = upci_db();
$action = (string)($_GET['action'] ?? '');
$where = $action !== '' ? ' WHERE action = ?' : '';
$st = $pdo->prepare('SELECT * FROM journal' . $where . ' ORDER BY id DESC LIMIT 300');
$st->execute($action !== '' ? [$action] : []);
$lignes = $st->fetchAll();
$actions = $pdo->query('SELECT DISTINCT action FROM journal ORDER BY action')->fetchAll(PDO::FETCH_COLUMN);

admin_debut('Journal d’audit');
echo '<h1>Journal d’audit</h1>'
    . '<p class="intro">Historique en ajout seul (rien ne s’y modifie ni ne s’y efface) : création, accusé, relance, escalade, clôture, vérification, réouverture, regroupement, silence, santé, bulletin, démo.</p>'
    . '<form method="get" class="filtres"><select name="action"><option value="">Toutes les actions</option>';
foreach ($actions as $a) echo '<option' . ($action === $a ? ' selected' : '') . '>' . h($a) . '</option>';
echo '</select><button class="btn" type="submit">Filtrer</button></form>'
    . '<table class="reg"><tr><th>Horodatage</th><th>Numéro</th><th>Acteur</th><th>Action</th><th>Détail</th></tr>';
foreach ($lignes as $r) {
    echo '<tr><td>' . upci_fmt($r['horodatage']) . '</td><td>' . h($r['numero']) . '</td>'
        . '<td>' . h($r['acteur']) . '</td><td>' . h($r['action']) . '</td><td>' . h($r['detail']) . '</td></tr>';
}
echo '</table><p>' . count($lignes) . ' ligne(s) (max 300, les plus récentes d’abord).</p>';
admin_fin();
