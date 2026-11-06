<?php
/**
 * Sauvegarde du registre — la base tient en UN fichier SQLite.
 *   php cli/backup.php
 * Produit data/sauvegardes/upci-AAAAMMJJ-HHMMSS.sqlite (instantané propre
 * via VACUUM INTO) et purge les sauvegardes de plus de 90 jours.
 * Une copie MANUELLE du fichier data/upci.sqlite reste toujours valable.
 */
if (PHP_SAPI !== 'cli') { exit("CLI uniquement.\n"); }
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/db.php';

$cfg = upci_config();
$pdo = upci_db();
$dir = dirname($cfg['db_path']) . '/sauvegardes';
if (!is_dir($dir)) {
    mkdir($dir, 0775, true);
}
$cible = $dir . '/upci-' . date('Ymd-His') . '.sqlite';
if (file_exists($cible)) { // deux sauvegardes dans la même seconde
    $cible = $dir . '/upci-' . date('Ymd-His') . '-' . substr(uniqid(), -4) . '.sqlite';
}
$pdo->exec("VACUUM INTO '" . str_replace("'", "''", $cible) . "'");
echo 'Sauvegarde créée : ' . $cible . ' (' . filesize($cible) . " octets)\n";

$limite = time() - 90 * 86400;
foreach (glob($dir . '/upci-*.sqlite') ?: [] as $f) {
    if (filemtime($f) < $limite) {
        unlink($f);
        echo 'Ancienne sauvegarde purgée : ' . basename($f) . "\n";
    }
}
