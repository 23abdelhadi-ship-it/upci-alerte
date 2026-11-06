<?php
/**
 * Mode DÉMO — génère 8 signalements clairement marqués « DÉMO »
 * (préfixe DÉMO-AAAA-NNN, aucune notification réelle, exclus des
 * indicateurs officiels et des escalades du cron).
 *   php cli/seed_demo.php
 * Contenu pensé pour la démonstration : un critique ouvert ancien
 * (relance/escalade visibles via cron --dry-run --demo), un critique pris en
 * charge, un critique clôturé avec boucle d'apprentissage complète,
 * un critique clôturé en attente de vérification d'efficacité, et un
 * trio même type + même site formant un regroupement suspecté.
 * Retrait propre : php cli/purge_demo.php
 */
if (PHP_SAPI !== 'cli') { exit("CLI uniquement.\n"); }
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/db.php';
require dirname(__DIR__) . '/lib/notify.php';
require dirname(__DIR__) . '/lib/metier.php';

$cfg = upci_config();
$pdo = upci_db();
$site = fn(int $i) => $cfg['sites'][$i] ?? $cfg['sites'][0];
$il_y_a = fn(int $secondes) => date('Y-m-d H:i:s', time() - $secondes);
$H = 3600;
$J = 24 * $H;

$base = [
    'service' => 'Laboratoire', 'lieu' => 'Magasin / stockage', 'periode' => 'Matin',
    'types' => [$cfg['types_urgence'][0]], 'gravite' => 2,
    'action_immediate' => 'Oui, partiellement', 'mesures' => ['Responsable informé'],
    'delai_demande' => 'Sous 24 h', 'email_declarant' => '',
];
$creer = function (array $surcharge, int $ageSecondes) use ($pdo, $base, $il_y_a) {
    return upci_creer_signalement($pdo, array_merge($base, $surcharge),
        ['demo' => true, 'date' => $il_y_a($ageSecondes), 'notifier' => false]);
};
$maj = function (string $numero, array $sets) use ($pdo) {
    $cols = [];
    $vals = [];
    foreach ($sets as $k => $v) { $cols[] = "$k = ?"; $vals[] = $v; }
    $vals[] = $numero;
    $pdo->prepare('UPDATE signalements SET ' . implode(', ', $cols) . ' WHERE numero = ?')->execute($vals);
};

// 1) Ouvert simple, hier — rupture de stock de savon.
$s1 = $creer(['polyclinique' => $site(0)], 26 * $H);

// 2) Critique OUVERT depuis 5 h, sans accusé — relance/escalade/rappel visibles.
$s2 = $creer([
    'polyclinique' => $site(1), 'service' => 'Urgences', 'lieu' => 'Entrée du service',
    'periode' => 'Soir', 'types' => [$cfg['types_urgence'][3]], 'gravite' => 5,
    'action_immediate' => 'Oui, totalement', 'mesures' => ['Zone isolée ou signalée'],
    'delai_demande' => 'Immédiat',
], 5 * $H);

// 3) Critique ouvert depuis 3 h, PRIS EN CHARGE après 30 min.
$s3 = $creer([
    'polyclinique' => $site(2), 'service' => 'Stérilisation centrale', 'lieu' => 'Salle de soins',
    'types' => [$cfg['types_urgence'][5]], 'gravite' => 4, 'delai_demande' => 'Immédiat',
], 3 * $H);
$maj($s3['numero'], [
    'pris_en_charge_le' => $il_y_a(3 * $H - 1800), 'accuse_par' => 'DÉMO — Chef UPCI',
    'statut' => 'CRITIQUE — Pris en charge',
]);

// 4) Critique CLÔTURÉ il y a 2 jours — boucle d'apprentissage COMPLÈTE.
$s4 = $creer([
    'polyclinique' => $site(3), 'service' => 'Pharmacie',
    'types' => [$cfg['types_urgence'][2]], 'gravite' => 4, 'delai_demande' => 'Aujourd’hui même',
], 2 * $J);
$maj($s4['numero'], [
    'statut' => 'Clôturé', 'date_cloture' => $il_y_a(2 * $J - 3 * $H), 'duree_h' => 3.0,
    'delai_reel' => '1 à 4 heures',
    'intervention' => 'Autoclave de réserve mis en service, pièce commandée.',
    'action_corrective' => 'Maintenance préventive planifiée pour les deux autoclaves.',
    'verif_efficacite' => 'Contrôle sur place : équipement fonctionnel, problème disparu.',
    'pris_en_charge_le' => $il_y_a(2 * $J - 600), 'accuse_par' => 'DÉMO — Chef UPCI',
]);

// 5) Critique CLÔTURÉ il y a 10 jours — vérification d'efficacité EN ATTENTE.
$s5 = $creer([
    'polyclinique' => $site(4), 'lieu' => 'Local déchets', 'periode' => 'Nuit',
    'types' => [$cfg['types_urgence'][1]], 'gravite' => 5, 'delai_demande' => 'Immédiat',
    'email_declarant' => 'demo-declarant@exemple.dz',
], 10 * $J);
$maj($s5['numero'], [
    'statut' => 'Clôturé', 'date_cloture' => $il_y_a(10 * $J - 6 * $H), 'duree_h' => 6.0,
    'delai_reel' => '4 à 24 heures',
    'intervention' => 'Tri refait, conteneurs DASRI remplacés et étiquetés.',
    'action_corrective' => 'Affiche de tri plastifiée posée au local déchets + rappel en réunion de service.',
    'pris_en_charge_le' => $il_y_a(10 * $J - 900), 'accuse_par' => 'DÉMO — Chef UPCI',
]);

// 6-8) Trio « Tri incorrect des déchets » au même site en 5 jours → regroupement.
$trio = ['polyclinique' => $site(6), 'service' => 'Soins', 'lieu' => 'Local déchets',
         'types' => [$cfg['types_urgence'][1]]];
$s6 = $creer(array_merge($trio, ['gravite' => 3, 'delai_demande' => 'Sous 24 h']), 1 * $J);
$s7 = $creer(array_merge($trio, ['gravite' => 2, 'periode' => 'Soir']), 3 * $J);
$maj($s7['numero'], [
    'statut' => 'Clôturé', 'date_cloture' => $il_y_a(3 * $J - 5 * $H), 'duree_h' => 5.0,
    'delai_reel' => '4 à 24 heures', 'intervention' => 'Conteneurs triés et remplacés.',
]);
$s8 = $creer(array_merge($trio, ['gravite' => 3, 'lieu' => 'Entrée du service']), 5 * $J);
$maj($s8['numero'], [
    'statut' => 'Clôturé', 'date_cloture' => $il_y_a(5 * $J - 2 * $H), 'duree_h' => 2.0,
    'delai_reel' => '1 à 4 heures', 'intervention' => 'Local déchets réorganisé, étiquetage refait.',
]);

upci_journal($pdo, '', 'CLI (démo)', 'démo', 'Jeu de démonstration généré : 8 signalements DÉMO');
echo "DÉMO générée : 8 signalements (" . $s1['numero'] . ' … ' . $s8['numero'] . ")\n";
echo "Essayez : php cli/cron.php --dry-run --demo   (relances, escalade, regroupement visibles)\n";
echo "Retrait  : php cli/purge_demo.php\n";
