<?php
/** Bilan mensuel CLIN — page imprimable + version texte (email). */
require __DIR__ . '/_garde.php';

$cfg = upci_config();
$pdo = upci_db();

$defaut = strtotime('first day of last month');
$annee = (int)($_GET['annee'] ?? date('Y', $defaut));
$mois  = (int)($_GET['mois'] ?? date('n', $defaut));
if ($mois < 1 || $mois > 12) $mois = (int)date('n', $defaut);
if ($annee < 2024 || $annee > 2100) $annee = (int)date('Y', $defaut);

$b = upci_bilan($pdo, $cfg, $annee, $mois);

admin_debut('Bilan mensuel CLIN');
echo '<h1>Bilan mensuel CLIN</h1>'
    . '<form method="get" class="filtres"><label>Mois</label>'
    . '<select name="mois">';
for ($m = 1; $m <= 12; $m++) {
    echo '<option value="' . $m . '"' . ($m === $mois ? ' selected' : '') . '>' . $m . '</option>';
}
echo '</select><label>Année</label>'
    . '<input type="number" name="annee" value="' . $annee . '" style="width:90px">'
    . '<button class="btn" type="submit">Afficher</button> '
    . '<button class="btn secondaire" type="button" onclick="window.print()">🖨 Imprimer</button></form>'
    . '<div class="document">' . upci_bilan_html($b, $cfg) . '</div>'
    . '<h3>Version texte (pour email / copier-coller)</h3>'
    . '<pre class="texte">' . h(upci_bilan_texte($b, $cfg)) . '</pre>';
admin_fin();
