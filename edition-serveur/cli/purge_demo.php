<?php
/**
 * Retire EXACTEMENT les signalements du mode démo (est_demo = 1).
 *   php cli/purge_demo.php
 * Le journal d'audit conserve la trace de la génération et du retrait.
 */
if (PHP_SAPI !== 'cli') { exit("CLI uniquement.\n"); }
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/db.php';

$pdo = upci_db();
$n = $pdo->exec('DELETE FROM signalements WHERE est_demo = 1');
upci_journal($pdo, '', 'CLI (démo)', 'démo', 'Retrait du mode démo : ' . $n . ' signalement(s) supprimé(s)');
echo 'Mode démo retiré : ' . $n . " signalement(s) DÉMO supprimé(s).\n";
