<?php
/**
 * Tâches planifiées UPCI — à lancer toutes les 30 minutes :
 *   php cli/cron.php              (Linux : crontab ; Windows : Planificateur de tâches)
 *   php cli/cron.php --dry-run    (montre ce qui SERAIT fait, sans rien envoyer ni tamponner)
 *   php cli/cron.php --dry-run --demo
 *                                 (démo/formation : inclut les lignes DÉMO dans
 *                                  les contrôles — uniquement en --dry-run, pour
 *                                  ne jamais notifier de faux cas en production)
 *   php cli/cron.php --hebdo      (force en plus les tâches hebdomadaires)
 *
 * À chaque passage : relance 1 h et escalade 4 h des critiques ouverts,
 * rappel « non pris en charge », rappel de vérification d'efficacité,
 * règle de regroupement (cluster). De façon hebdomadaire (auto-détecté) :
 * moniteur de silence des sites, battement de cœur (santé), sauvegarde.
 * En début de mois (auto-détecté) : envoi du bilan CLIN et du bulletin
 * du mois écoulé.
 */
if (PHP_SAPI !== 'cli') { exit("CLI uniquement.\n"); }
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/db.php';
require dirname(__DIR__) . '/lib/notify.php';
require dirname(__DIR__) . '/lib/metier.php';
require dirname(__DIR__) . '/lib/rapports.php';

$cfg = upci_config();
$pdo = upci_db();
$DRY = in_array('--dry-run', $argv, true);
$FORCE_HEBDO = in_array('--hebdo', $argv, true);
$DEMO = in_array('--demo', $argv, true);
if ($DEMO && !$DRY) {
    echo "Refusé : --demo exige --dry-run (aucune notification de faux cas en production).\n";
    exit(1);
}
// En production, les lignes DÉMO sont exclues de tous les contrôles.
$condDemo = $DEMO ? 'est_demo IN (0, 1)' : 'est_demo = 0';

$dire = function (string $txt): void {
    echo '[' . date('H:i:s') . '] ' . $txt . "\n";
};
/** Notification réelle ou simulée (dry-run), + journalisation optionnelle. */
$notifier = function (string $sujet, string $corps, string $numero = '', string $action = '', string $detail = '') use ($DRY, $pdo, $dire) {
    if ($DRY) {
        $dire('DRY-RUN — enverrait : « ' . $sujet . ' »');
        return;
    }
    upci_notifier($sujet, $corps);
    if ($action !== '') {
        upci_journal($pdo, $numero, 'Système', $action, $detail);
    }
};
/** Tamponne une colonne d'horodatage (sauf en dry-run). */
$tampon = function (string $colonne, int $id) use ($DRY, $pdo) {
    if ($DRY) return;
    $pdo->prepare("UPDATE signalements SET $colonne = ? WHERE id = ?")->execute([upci_now(), $id]);
};

$dire('Cron UPCI' . ($DRY ? ' (DRY-RUN)' : '') . ' — début');
$maintenant = time();

// ------------------------------------------------------------------
// 1) Critiques ouverts : relance 1 h, escalade 4 h, rappel sans accusé
// ------------------------------------------------------------------
$ouverts = $pdo->query("SELECT * FROM signalements WHERE $condDemo AND est_critique = 1 AND date_cloture IS NULL ORDER BY date_creation")
    ->fetchAll();
foreach ($ouverts as $s) {
    $ageH = ($maintenant - strtotime($s['date_creation'])) / 3600;
    $resume = $s['numero'] . ' — ' . $s['polyclinique'] . ' — ' . $s['service']
        . ' — gravité ' . $s['gravite'] . ' — ouvert depuis ' . round($ageH, 1) . ' h.';
    if ($ageH >= (float)$cfg['sla_relance_h'] && empty($s['relance_1h_le'])) {
        $notifier('⏰ RELANCE — Critique ouvert depuis plus de ' . $cfg['sla_relance_h'] . ' h : ' . $s['numero'],
            $resume . "\nIntervenez et clôturez via la page de clôture.", $s['numero'], 'relance', 'Relance ' . $cfg['sla_relance_h'] . ' h (critique ouvert)');
        $tampon('relance_1h_le', (int)$s['id']);
        $dire('Relance 1h : ' . $s['numero']);
    }
    if ($ageH >= (float)$cfg['sla_escalade_h'] && empty($s['escalade_4h_le'])) {
        $notifier('⛔ ESCALADE — Critique ouvert depuis plus de ' . $cfg['sla_escalade_h'] . ' h : ' . $s['numero'],
            $resume . "\nEscalade transmise à la supervision. Intervention immédiate requise.", $s['numero'], 'escalade', 'Escalade ' . $cfg['sla_escalade_h'] . ' h (critique ouvert)');
        $tampon('escalade_4h_le', (int)$s['id']);
        $dire('Escalade 4h : ' . $s['numero']);
    }
    if ($ageH >= (float)$cfg['sla_accuse_h'] && empty($s['pris_en_charge_le']) && empty($s['relance_accuse_le'])) {
        $notifier('👀 NON PRIS EN CHARGE — ' . $s['numero'],
            $resume . "\nOuvrez l’alerte Telegram et appuyez sur « ✅ Pris en charge », ou intervenez et clôturez.", $s['numero'], 'relance', 'Rappel : critique sans accusé de réception');
        $tampon('relance_accuse_le', (int)$s['id']);
        $dire('Rappel sans accusé : ' . $s['numero']);
    }
}

// ------------------------------------------------------------------
// 2) Vérification d'efficacité en attente (critiques clôturés)
// ------------------------------------------------------------------
$st = $pdo->prepare("SELECT * FROM signalements WHERE $condDemo AND est_critique = 1
                     AND date_cloture IS NOT NULL AND verif_efficacite = '' AND relance_verif_le IS NULL");
$st->execute();
foreach ($st->fetchAll() as $s) {
    $ageJ = ($maintenant - strtotime($s['date_cloture'])) / 86400;
    if ($ageJ < (float)$cfg['verif_efficacite_jours']) continue;
    $notifier('🔍 Vérification d’efficacité en attente — ' . $s['numero'],
        $s['numero'] . ' — ' . $s['polyclinique'] . ' — clôturé depuis ' . floor($ageJ) . " j.\n"
        . 'Action corrective consignée : ' . ($s['action_corrective'] ?: '—') . "\n"
        . 'Vérifiez sur place si le problème a réellement disparu, puis consignez le résultat via la page de clôture (champ « Vérification d’efficacité »).',
        $s['numero'], 'relance', 'Vérification d’efficacité en attente depuis ' . floor($ageJ) . ' j');
    $tampon('relance_verif_le', (int)$s['id']);
    $dire('Rappel vérification : ' . $s['numero']);
}

// ------------------------------------------------------------------
// 3) Règle de regroupement : >= seuil, même type + même site, fenêtre glissante
// ------------------------------------------------------------------
$limite = date('Y-m-d H:i:s', $maintenant - (int)$cfg['fenetre_groupe_jours'] * 86400);
$st = $pdo->prepare("SELECT * FROM signalements WHERE $condDemo AND date_creation >= ? ORDER BY date_creation");
$st->execute([$limite]);
$groupes = [];
foreach ($st->fetchAll() as $s) {
    foreach (json_decode($s['types'] ?: '[]', true) ?: [] as $t) {
        $groupes[$t . ' | ' . $s['polyclinique']][] = $s['numero'];
    }
}
$semaine = date('o-\WW');
foreach ($groupes as $cle => $numeros) {
    if (count($numeros) < (int)$cfg['seuil_groupe']) continue;
    $cleMeta = 'groupe_' . md5($cle);
    if (!$DRY && upci_meta_get($pdo, $cleMeta) === $semaine) continue; // déjà alerté cette semaine
    $notifier('🧩 REGROUPEMENT SUSPECTÉ — ' . $cle,
        count($numeros) . ' signalements du même type à la même polyclinique en ' . $cfg['fenetre_groupe_jours']
        . ' jours : ' . implode(', ', $numeros) . ".\n"
        . 'Piste : cause commune ou début de cluster — examen en réunion CLIN et vigilance renforcée recommandés.',
        $numeros[0], 'regroupement', $cle . ' — ' . count($numeros) . ' signalements en ' . $cfg['fenetre_groupe_jours'] . ' j : ' . implode(', ', $numeros));
    if (!$DRY) upci_meta_set($pdo, $cleMeta, $semaine);
    $dire('Regroupement : ' . $cle . ' (' . count($numeros) . ')');
}

// ------------------------------------------------------------------
// 4) Hebdomadaire (auto) : silence des sites, santé du système, sauvegarde
// ------------------------------------------------------------------
$dernierHebdo = upci_meta_get($pdo, 'dernier_hebdo');
$hebdoDu = $FORCE_HEBDO || $dernierHebdo === null || (time() - strtotime($dernierHebdo)) >= 6 * 86400;
if ($hebdoDu) {
    // 4a) Moniteur de silence
    $silencieux = upci_sites_silencieux($pdo, $cfg);
    if ($silencieux) {
        $notifier('🔇 Sites silencieux — aucun signalement depuis ' . $cfg['silence_semaines'] . ' semaines',
            "Sites concernés :\n- " . implode("\n- ", $silencieux)
            . "\n\nLe silence est une donnée, pas un succès : vérifiez l’affiche QR, rappelez la démarche en douceur (soutien, pas de blâme).",
            '', 'silence', implode(', ', $silencieux));
        $dire('Silence : ' . count($silencieux) . ' site(s)');
    } else {
        $dire('Silence : aucun site silencieux');
    }
    // 4b) Battement de cœur — une ligne de santé
    $nbOuv = (int)$pdo->query('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND date_cloture IS NULL')->fetchColumn();
    $nbCrit = (int)$pdo->query('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL')->fetchColumn();
    $dernierSig = $pdo->query('SELECT MAX(date_creation) FROM signalements WHERE est_demo = 0')->fetchColumn();
    $dirSauv = dirname($cfg['db_path']) . '/sauvegardes';
    $sauvegardes = glob($dirSauv . '/upci-*.sqlite') ?: [];
    $ageSauv = $sauvegardes ? (time() - max(array_map('filemtime', $sauvegardes))) / 86400 : null;
    $problemes = [];
    if (!is_writable(dirname($cfg['db_path']))) $problemes[] = 'dossier data non inscriptible';
    if ($ageSauv === null) $problemes[] = 'aucune sauvegarde trouvée';
    elseif ($ageSauv > 8) $problemes[] = 'dernière sauvegarde âgée de ' . floor($ageSauv) . ' j';
    $ligneSante = ($problemes ? '⚠️ SANTÉ UPCI — ALERTE : ' . implode(' ; ', $problemes) : '💚 SANTÉ UPCI — OK')
        . ' | Ouverts : ' . $nbOuv . ' (critiques : ' . $nbCrit . ')'
        . ' | Dernier signalement : ' . ($dernierSig ? upci_fmt($dernierSig) : 'aucun')
        . ' | Sauvegarde : ' . ($ageSauv === null ? 'aucune' : 'il y a ' . floor($ageSauv) . ' j')
        . ' | Base : ' . basename($cfg['db_path']);
    $notifier($ligneSante, $ligneSante, '', 'santé', $ligneSante);
    $dire('Santé : ' . $ligneSante);
    // 4c) Sauvegarde hebdomadaire (instantané propre)
    if (!$DRY) {
        if (!is_dir($dirSauv)) mkdir($dirSauv, 0775, true);
        $cible = $dirSauv . '/upci-' . date('Ymd-His') . '.sqlite';
        if (file_exists($cible)) {
            $cible = $dirSauv . '/upci-' . date('Ymd-His') . '-' . substr(uniqid(), -4) . '.sqlite';
        }
        $pdo->exec("VACUUM INTO '" . str_replace("'", "''", $cible) . "'");
        $dire('Sauvegarde : ' . $cible);
        upci_meta_set($pdo, 'dernier_hebdo', upci_now());
    } else {
        $dire('DRY-RUN — sauvegarde hebdomadaire simulée');
    }
}

// ------------------------------------------------------------------
// 5) Mensuel (auto, première semaine du mois) : bilan CLIN + bulletin
// ------------------------------------------------------------------
$ref = strtotime('first day of last month');
$cleMois = date('Y-m', $ref);
if ((int)date('j') <= 7 && upci_meta_get($pdo, 'dernier_envoi_mensuel') !== $cleMois) {
    $a = (int)date('Y', $ref);
    $m = (int)date('n', $ref);
    $b = upci_bilan($pdo, $cfg, $a, $m);
    $notifier('Bilan mensuel CLIN — ' . upci_mois_nom($a, $m), upci_bilan_texte($b, $cfg), '', 'bilan', 'Bilan CLIN ' . $cleMois . ' envoyé');
    $dire('Bilan CLIN ' . $cleMois . ' : envoyé');
    $bul = upci_bulletin($pdo, $cfg, $a, $m);
    if ($bul['nb_fermes'] > 0 || $bul['changements']) {
        $dest = $cfg['emails_bulletin'] ?: $cfg['emails_alertes'];
        if ($DRY) {
            $dire('DRY-RUN — bulletin ' . $cleMois . ' enverrait à : ' . implode(', ', $dest));
        } else {
            foreach ($dest as $email) {
                upci_mail($email, 'Bulletin UPCI — Vous avez signalé → nous avons changé (' . upci_mois_nom($a, $m) . ')',
                    upci_bulletin_texte($bul, $cfg));
            }
            upci_journal($pdo, '', 'Système', 'bulletin', 'Bulletin ' . $cleMois . ' envoyé à ' . count($dest) . ' destinataire(s)');
        }
        $dire('Bulletin ' . $cleMois . ' : envoyé');
    } else {
        $dire('Bulletin ' . $cleMois . ' : vide, non envoyé');
        if (!$DRY) upci_journal($pdo, '', 'Système', 'bulletin', 'Bulletin ' . $cleMois . ' ignoré (vide)');
    }
    if (!$DRY) upci_meta_set($pdo, 'dernier_envoi_mensuel', $cleMois);
}

$dire('Cron UPCI — fin');
