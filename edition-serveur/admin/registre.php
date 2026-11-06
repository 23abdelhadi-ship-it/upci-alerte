<?php
/**
 * Registre admin — tableau filtrable + export CSV au format du modèle
 * de registre de l'édition publiée (23 colonnes).
 * Amélioration assumée vs feuille Google : la colonne « Type » porte ici
 * les types d'incident (la feuille ne les stockait pas).
 */
require __DIR__ . '/_garde.php';

$cfg = upci_config();
$pdo = upci_db();

$fSite   = (string)($_GET['site'] ?? '');
$fStatut = (string)($_GET['statut'] ?? '');   // '', ouvert, cloture, critique, demo, reel
$fGrav   = (int)($_GET['gravite_min'] ?? 0);
$fRech   = trim((string)($_GET['q'] ?? ''));

$where = [];
$args = [];
if ($fSite !== '') { $where[] = 'polyclinique = ?'; $args[] = $fSite; }
if ($fStatut === 'ouvert')   $where[] = 'date_cloture IS NULL';
if ($fStatut === 'cloture')  $where[] = 'date_cloture IS NOT NULL';
if ($fStatut === 'critique') $where[] = 'est_critique = 1';
if ($fStatut === 'demo')     $where[] = 'est_demo = 1';
if ($fStatut === 'reel')     $where[] = 'est_demo = 0';
if ($fGrav > 0) { $where[] = 'gravite >= ?'; $args[] = $fGrav; }
if ($fRech !== '') { $where[] = 'numero LIKE ?'; $args[] = '%' . $fRech . '%'; }
$sqlWhere = $where ? ' WHERE ' . implode(' AND ', $where) : '';

if (isset($_GET['export'])) {
    $st = $pdo->prepare('SELECT * FROM signalements' . $sqlWhere . ' ORDER BY date_creation');
    $st->execute($args);
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="registre-upci-' . date('Ymd') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // BOM : accents corrects dans Excel
    fputcsv($out, ['Date', 'Numéro', 'Type', 'Polyclinique', 'Service', 'Gravité', 'Délai demandé',
        'Mesures', 'Statut', 'Intervention', 'Délai réel', 'Date clôture', 'Durée (h)', 'Relance 1h',
        'Escalade 4h', 'Email déclarant', 'Action corrective', 'Vérification d’efficacité',
        'Pris en charge le', 'Accusé par', 'Relance accusé', 'Msg Telegram', 'Relance vérification'], ';');
    foreach ($st as $r) {
        fputcsv($out, [
            $r['date_creation'], $r['numero'],
            implode(' ; ', json_decode($r['types'] ?: '[]', true) ?: []),
            $r['polyclinique'], $r['service'], $r['gravite'], $r['delai_demande'],
            implode(' ; ', json_decode($r['mesures'] ?: '[]', true) ?: []),
            $r['statut'], $r['intervention'], $r['delai_reel'], $r['date_cloture'] ?? '',
            $r['duree_h'] ?? '', $r['relance_1h_le'] ?? '', $r['escalade_4h_le'] ?? '',
            $r['email_declarant'], $r['action_corrective'], $r['verif_efficacite'],
            $r['pris_en_charge_le'] ?? '', $r['accuse_par'], $r['relance_accuse_le'] ?? '',
            $r['telegram_msgs'], $r['relance_verif_le'] ?? '',
        ], ';');
    }
    fclose($out);
    exit;
}

$st = $pdo->prepare('SELECT * FROM signalements' . $sqlWhere . ' ORDER BY date_creation DESC LIMIT 500');
$st->execute($args);
$lignes = $st->fetchAll();

admin_debut('Registre');
echo '<h1>Registre des signalements</h1>'
    . '<form method="get" class="filtres">'
    . '<select name="site"><option value="">Tous les sites</option>';
foreach ($cfg['sites'] as $s) echo '<option' . ($fSite === $s ? ' selected' : '') . '>' . h($s) . '</option>';
echo '</select>'
    . '<select name="statut">'
    . '<option value="">Tous statuts</option>'
    . '<option value="reel"' . ($fStatut === 'reel' ? ' selected' : '') . '>Réels (hors démo)</option>'
    . '<option value="ouvert"' . ($fStatut === 'ouvert' ? ' selected' : '') . '>Ouverts</option>'
    . '<option value="cloture"' . ($fStatut === 'cloture' ? ' selected' : '') . '>Clôturés</option>'
    . '<option value="critique"' . ($fStatut === 'critique' ? ' selected' : '') . '>Critiques</option>'
    . '<option value="demo"' . ($fStatut === 'demo' ? ' selected' : '') . '>DÉMO</option>'
    . '</select>'
    . '<select name="gravite_min"><option value="0">Gravité ≥ 1</option>';
for ($i = 2; $i <= 5; $i++) echo '<option value="' . $i . '"' . ($fGrav === $i ? ' selected' : '') . '>Gravité ≥ ' . $i . '</option>';
echo '</select>'
    . '<input name="q" value="' . h($fRech) . '" placeholder="N° (recherche)">'
    . '<button class="btn" type="submit">Filtrer</button> '
    . '<a class="btn secondaire" href="registre.php?' . h(http_build_query(array_merge($_GET, ['export' => 'csv']))) . '">⬇ Export CSV</a>'
    . '</form>'
    . '<p>' . count($lignes) . ' ligne(s) affichée(s) (max 500).</p>'
    . '<table class="reg"><tr><th>Date</th><th>Numéro</th><th>Polyclinique</th><th>Service</th><th>Types</th><th>Grav.</th><th>Statut</th><th>Accusé</th><th>Clôture</th><th>Durée</th><th></th></tr>';
foreach ($lignes as $r) {
    echo '<tr' . ($r['est_critique'] && !$r['date_cloture'] ? ' class="crit"' : '') . '>'
        . '<td>' . upci_fmt($r['date_creation']) . '</td>'
        . '<td>' . h($r['numero']) . '</td>'
        . '<td>' . h($r['polyclinique']) . '</td>'
        . '<td>' . h($r['service']) . '</td>'
        . '<td>' . h(implode(' ; ', json_decode($r['types'] ?: '[]', true) ?: [])) . '</td>'
        . '<td>' . (int)$r['gravite'] . '</td>'
        . '<td>' . h($r['statut']) . '</td>'
        . '<td>' . ($r['pris_en_charge_le'] ? '✅ ' . upci_fmt($r['pris_en_charge_le']) : '—') . '</td>'
        . '<td>' . ($r['date_cloture'] ? upci_fmt($r['date_cloture']) : '—') . '</td>'
        . '<td>' . ($r['duree_h'] !== null ? $r['duree_h'] . ' h' : '—') . '</td>'
        . '<td>' . ($r['date_cloture'] ? '' : '<a href="../cloture.php?numero=' . urlencode($r['numero']) . '" target="_blank">Clôturer</a>') . '</td>'
        . '</tr>';
}
echo '</table>';
admin_fin();
