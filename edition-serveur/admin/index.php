<?php
/** Tableau de bord admin — compteurs, répartitions, dossiers en retard. */
require __DIR__ . '/_garde.php';

$cfg = upci_config();
$pdo = upci_db();
admin_debut('Tableau de bord');

$q = fn(string $sql) => (int)$pdo->query($sql)->fetchColumn();
$total     = $q('SELECT COUNT(*) FROM signalements WHERE est_demo = 0');
$ouverts   = $q('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND date_cloture IS NULL');
$critOuv   = $q('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL');
$moisDebut = date('Y-m-01 00:00:00');
$st = $pdo->prepare('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND date_creation >= ?');
$st->execute([$moisDebut]);
$moisTotal = (int)$st->fetchColumn();
$st = $pdo->prepare('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND date_cloture >= ?');
$st->execute([$moisDebut]);
$moisClos = (int)$st->fetchColumn();

echo '<h1>Tableau de bord</h1><div class="cartes">'
    . '<div class="carte"><span>' . $total . '</span>Signalements (total)</div>'
    . '<div class="carte"><span>' . $ouverts . '</span>Ouverts</div>'
    . '<div class="carte rouge"><span>' . $critOuv . '</span>Critiques ouverts</div>'
    . '<div class="carte"><span>' . $moisTotal . '</span>Ce mois-ci</div>'
    . '<div class="carte vert"><span>' . $moisClos . '</span>Clôtures ce mois-ci</div>'
    . '</div>';

$repartition = function (string $titre, array $tab): void {
    echo '<div class="bloc"><h2>' . h($titre) . '</h2><table class="ind">';
    foreach ($tab as $k => $n) echo '<tr><td>' . h((string)$k) . '</td><td>' . (int)$n . '</td></tr>';
    echo '</table></div>';
};

$parSite = [];
foreach ($pdo->query('SELECT polyclinique, COUNT(*) n FROM signalements WHERE est_demo = 0 GROUP BY polyclinique ORDER BY n DESC') as $r) {
    $parSite[$r['polyclinique']] = $r['n'];
}
$parGrav = [];
foreach ($pdo->query('SELECT gravite, COUNT(*) n FROM signalements WHERE est_demo = 0 GROUP BY gravite ORDER BY gravite') as $r) {
    $parGrav['Gravité ' . $r['gravite']] = $r['n'];
}
$parType = [];
foreach ($pdo->query("SELECT types FROM signalements WHERE est_demo = 0") as $r) {
    foreach (json_decode($r['types'] ?: '[]', true) ?: [] as $t) {
        $parType[$t] = ($parType[$t] ?? 0) + 1;
    }
}
arsort($parType);

echo '<div class="grille">';
$repartition('Par polyclinique', $parSite);
$repartition('Par type d’incident', $parType);
$repartition('Par gravité', $parGrav);
echo '</div>';

// Dossiers en retard : critiques ouverts + tout ouvert depuis plus de 24 h.
$limite24 = date('Y-m-d H:i:s', time() - 24 * 3600);
$st = $pdo->prepare('SELECT * FROM signalements WHERE est_demo = 0 AND date_cloture IS NULL
                     AND (est_critique = 1 OR date_creation < ?) ORDER BY est_critique DESC, date_creation');
$st->execute([$limite24]);
$retard = $st->fetchAll();
echo '<div class="bloc"><h2>⏰ Dossiers en retard (critiques ouverts et ouverts &gt; 24 h)</h2>';
if (!$retard) {
    echo '<p>✅ Aucun dossier en retard.</p>';
} else {
    echo '<table class="reg"><tr><th>Numéro</th><th>Depuis</th><th>Polyclinique</th><th>Service</th><th>Grav.</th><th>Statut</th><th>Accusé</th><th></th></tr>';
    foreach ($retard as $r) {
        $age = round((time() - strtotime($r['date_creation'])) / 3600, 1);
        echo '<tr' . ($r['est_critique'] ? ' class="crit"' : '') . '>'
            . '<td>' . h($r['numero']) . '</td><td>' . $age . ' h</td>'
            . '<td>' . h($r['polyclinique']) . '</td><td>' . h($r['service']) . '</td>'
            . '<td>' . (int)$r['gravite'] . '</td><td>' . h($r['statut']) . '</td>'
            . '<td>' . ($r['pris_en_charge_le'] ? '✅' : '—') . '</td>'
            . '<td><a href="../cloture.php?numero=' . urlencode($r['numero']) . '" target="_blank">Clôturer</a></td></tr>';
    }
    echo '</table>';
}
echo '</div>';
admin_fin();
