<?php
/**
 * Rapports — bilan mensuel CLIN et bulletin « Vous avez signalé → nous
 * avons changé ». Indicateurs alignés sur docs/06 de l'édition publiée.
 * Les lignes DÉMO sont exclues de tous les chiffres officiels.
 */
defined('UPCI') or exit;

/** Toutes les lignes réelles (hors démo) créées dans un mois donné. */
function upci_lignes_mois(PDO $pdo, int $annee, int $mois): array
{
    $debut = sprintf('%04d-%02d-01 00:00:00', $annee, $mois);
    $fin   = date('Y-m-d H:i:s', strtotime($debut . ' +1 month'));
    $st = $pdo->prepare('SELECT * FROM signalements WHERE est_demo = 0 AND date_creation >= ? AND date_creation < ? ORDER BY date_creation');
    $st->execute([$debut, $fin]);
    return $st->fetchAll();
}

/** Calcule les indicateurs CLIN du mois (cohorte = signalements créés ce mois-là). */
function upci_bilan(PDO $pdo, array $cfg, int $annee, int $mois): array
{
    $lignes = upci_lignes_mois($pdo, $annee, $mois);
    $seuil = (int)$cfg['seuil_critique'];
    $b = [
        'annee' => $annee, 'mois' => $mois, 'lignes' => $lignes,
        'total' => count($lignes), 'critiques' => 0, 'clotures' => 0,
        'pct_critiques' => 0.0, 'pct_cloture' => 0.0,
        'duree_moy_h' => null, 'par_site' => [], 'par_type' => [], 'par_gravite' => [],
        'accuses' => 0, 'taux_accuse' => null, 'delai_accuse_moy_h' => null,
        'critiques_ouverts' => 0,
        'boucle_total' => 0, 'boucle_complets' => 0, 'boucle_pct' => null,
        'verif_dus' => 0, 'verif_faits' => 0, 'verif_pct' => null,
        'regroupements' => 0, 'sites_silencieux' => [],
    ];
    $sommeDurees = 0.0; $nbDurees = 0;
    $sommeAccuse = 0.0; $nbAccuse = 0;
    foreach ($lignes as $l) {
        if ((int)$l['gravite'] >= $seuil) $b['critiques']++;
        if (!empty($l['date_cloture'])) {
            $b['clotures']++;
            if ($l['duree_h'] !== null) { $sommeDurees += (float)$l['duree_h']; $nbDurees++; }
        }
        $b['par_site'][$l['polyclinique']] = ($b['par_site'][$l['polyclinique']] ?? 0) + 1;
        foreach (json_decode($l['types'] ?: '[]', true) ?: [] as $t) {
            $b['par_type'][$t] = ($b['par_type'][$t] ?? 0) + 1;
        }
        $g = (int)$l['gravite'];
        $b['par_gravite'][$g] = ($b['par_gravite'][$g] ?? 0) + 1;
        if (!empty($l['pris_en_charge_le'])) {
            $b['accuses']++;
            $sommeAccuse += (strtotime($l['pris_en_charge_le']) - strtotime($l['date_creation'])) / 3600;
            $nbAccuse++;
        }
        if ((int)$l['gravite'] >= $seuil && !empty($l['date_cloture'])) {
            $b['boucle_total']++;
            if ($l['action_corrective'] !== '' && $l['verif_efficacite'] !== '') $b['boucle_complets']++;
            if (strtotime($l['date_cloture']) <= time() - (int)$cfg['verif_efficacite_jours'] * 86400) {
                $b['verif_dus']++;
                if ($l['verif_efficacite'] !== '') $b['verif_faits']++;
            }
        }
    }
    if ($b['total'] > 0) {
        $b['pct_critiques'] = round(100 * $b['critiques'] / $b['total'], 1);
        $b['pct_cloture']   = round(100 * $b['clotures'] / $b['total'], 1);
        $b['taux_accuse']   = round(100 * $b['accuses'] / $b['total'], 1);
    }
    if ($nbDurees) $b['duree_moy_h'] = round($sommeDurees / $nbDurees, 2);
    if ($nbAccuse) $b['delai_accuse_moy_h'] = round($sommeAccuse / $nbAccuse, 2);
    if ($b['boucle_total']) $b['boucle_pct'] = round(100 * $b['boucle_complets'] / $b['boucle_total'], 1);
    if ($b['verif_dus'])    $b['verif_pct']  = round(100 * $b['verif_faits'] / $b['verif_dus'], 1);
    arsort($b['par_site']); arsort($b['par_type']); ksort($b['par_gravite']);

    // Critiques encore ouverts (toutes cohortes) au moment du bilan.
    $b['critiques_ouverts'] = (int)$pdo->query('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL')->fetchColumn();
    // Regroupements détectés pendant le mois (depuis le journal).
    $debut = sprintf('%04d-%02d-01 00:00:00', $annee, $mois);
    $fin   = date('Y-m-d H:i:s', strtotime($debut . ' +1 month'));
    $st = $pdo->prepare("SELECT COUNT(*) FROM journal WHERE action = 'regroupement' AND horodatage >= ? AND horodatage < ?");
    $st->execute([$debut, $fin]);
    $b['regroupements'] = (int)$st->fetchColumn();
    $b['sites_silencieux'] = upci_sites_silencieux($pdo, $cfg);
    return $b;
}

/** Sites sans aucun signalement réel depuis N semaines (hors exemptés). */
function upci_sites_silencieux(PDO $pdo, array $cfg): array
{
    $limite = date('Y-m-d H:i:s', time() - (int)$cfg['silence_semaines'] * 7 * 86400);
    $exempts = $cfg['sites_exempts'] ?? [];
    $silencieux = [];
    foreach ($cfg['sites'] ?? [] as $site) {
        if (in_array($site, $exempts, true)) continue;
        $st = $pdo->prepare('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND polyclinique = ? AND date_creation >= ?');
        $st->execute([$site, $limite]);
        if ((int)$st->fetchColumn() === 0) $silencieux[] = $site;
    }
    return $silencieux;
}

/** Rendu texte du bilan (email / console). */
function upci_bilan_texte(array $b, array $cfg): string
{
    $moisNom = upci_mois_nom($b['annee'], $b['mois']);
    $l = [];
    $l[] = 'BILAN MENSUEL CLIN — ' . $moisNom;
    $l[] = $cfg['etablissement'] . ' (' . $cfg['wilaya'] . ')';
    $l[] = str_repeat('-', 55);
    $l[] = 'Signalements du mois : ' . $b['total'];
    $l[] = 'Critiques (gravité ≥ ' . (int)$cfg['seuil_critique'] . ') : ' . $b['critiques'] . ' (' . $b['pct_critiques'] . ' %)';
    $l[] = 'Clôturés : ' . $b['clotures'] . ' (' . $b['pct_cloture'] . ' %)';
    $l[] = 'Délai moyen de clôture : ' . ($b['duree_moy_h'] === null ? '—' : $b['duree_moy_h'] . ' h');
    $l[] = 'Critiques encore ouverts : ' . $b['critiques_ouverts'];
    $l[] = 'Taux d’accusé (bouton Telegram) : ' . ($b['taux_accuse'] === null ? '—' : $b['taux_accuse'] . ' %')
        . ' — délai moyen d’accusé : ' . ($b['delai_accuse_moy_h'] === null ? '—' : $b['delai_accuse_moy_h'] . ' h');
    $l[] = 'Boucle d’apprentissage (critiques clôturés complets) : ' . ($b['boucle_pct'] === null ? '—' : $b['boucle_pct'] . ' %');
    $l[] = 'Vérifications d’efficacité dues / faites : ' . $b['verif_dus'] . ' / ' . $b['verif_faits'];
    $l[] = 'Regroupements suspectés : ' . $b['regroupements'];
    if ($b['par_site']) {
        $l[] = '';
        $l[] = 'Par polyclinique :';
        foreach ($b['par_site'] as $s => $n) $l[] = '  - ' . $s . ' : ' . $n;
    }
    if ($b['par_type']) {
        $l[] = '';
        $l[] = 'Par type d’incident :';
        foreach ($b['par_type'] as $t => $n) $l[] = '  - ' . $t . ' : ' . $n;
    }
    if ($b['sites_silencieux']) {
        $l[] = '';
        $l[] = 'Sites silencieux (≥ ' . (int)$cfg['silence_semaines'] . ' semaines sans signalement) : '
            . implode(', ', $b['sites_silencieux']);
    }
    return implode("\n", $l);
}

/** Rendu HTML imprimable du bilan. */
function upci_bilan_html(array $b, array $cfg): string
{
    $moisNom = upci_mois_nom($b['annee'], $b['mois']);
    $rows = function (array $tab): string {
        $s = '';
        foreach ($tab as $k => $n) $s .= '<tr><td>' . h((string)$k) . '</td><td>' . (int)$n . '</td></tr>';
        return $s ?: '<tr><td colspan="2">—</td></tr>';
    };
    $fmt = fn($v, $u = '') => $v === null ? '—' : $v . $u;
    return '<h2>Bilan mensuel CLIN — ' . h($moisNom) . '</h2>'
        . '<p>' . h($cfg['etablissement']) . ' — ' . h($cfg['wilaya']) . '</p>'
        . '<table class="ind">'
        . '<tr><th>Signalements du mois</th><td>' . $b['total'] . '</td></tr>'
        . '<tr><th>Critiques (gravité ≥ ' . (int)$cfg['seuil_critique'] . ')</th><td>' . $b['critiques'] . ' (' . $b['pct_critiques'] . ' %)</td></tr>'
        . '<tr><th>Clôturés</th><td>' . $b['clotures'] . ' (' . $b['pct_cloture'] . ' %)</td></tr>'
        . '<tr><th>Délai moyen de clôture</th><td>' . $fmt($b['duree_moy_h'], ' h') . '</td></tr>'
        . '<tr><th>Critiques encore ouverts</th><td>' . $b['critiques_ouverts'] . '</td></tr>'
        . '<tr><th>Taux d’accusé Telegram</th><td>' . $fmt($b['taux_accuse'], ' %') . '</td></tr>'
        . '<tr><th>Délai moyen d’accusé</th><td>' . $fmt($b['delai_accuse_moy_h'], ' h') . '</td></tr>'
        . '<tr><th>Boucle d’apprentissage complète</th><td>' . $fmt($b['boucle_pct'], ' %') . '</td></tr>'
        . '<tr><th>Vérifications d’efficacité (faites / dues)</th><td>' . $b['verif_faits'] . ' / ' . $b['verif_dus'] . '</td></tr>'
        . '<tr><th>Regroupements suspectés</th><td>' . $b['regroupements'] . '</td></tr>'
        . '</table>'
        . '<h3>Par polyclinique</h3><table class="ind">' . $rows($b['par_site']) . '</table>'
        . '<h3>Par type d’incident</h3><table class="ind">' . $rows($b['par_type']) . '</table>'
        . ($b['sites_silencieux'] ? '<h3>Sites silencieux</h3><p>' . h(implode(', ', $b['sites_silencieux'])) . '</p>' : '');
}

/** Bulletin « Vous avez signalé → nous avons changé » construit des clôtures du mois. */
function upci_bulletin(PDO $pdo, array $cfg, int $annee, int $mois): array
{
    $debut = sprintf('%04d-%02d-01 00:00:00', $annee, $mois);
    $fin   = date('Y-m-d H:i:s', strtotime($debut . ' +1 month'));
    $st = $pdo->prepare('SELECT * FROM signalements WHERE est_demo = 0 AND date_cloture >= ? AND date_cloture < ? ORDER BY polyclinique, date_cloture');
    $st->execute([$debut, $fin]);
    $fermes = $st->fetchAll();
    $parSite = [];
    $changements = [];
    $somme = 0.0; $nb = 0;
    foreach ($fermes as $l) {
        $parSite[$l['polyclinique']] = ($parSite[$l['polyclinique']] ?? 0) + 1;
        if ($l['duree_h'] !== null) { $somme += (float)$l['duree_h']; $nb++; }
        if ($l['action_corrective'] !== '') {
            $changements[] = $l['polyclinique'] . ' — ' . $l['action_corrective'];
        }
    }
    arsort($parSite);
    return [
        'annee' => $annee, 'mois' => $mois, 'fermes' => $fermes,
        'nb_fermes' => count($fermes), 'par_site' => $parSite,
        'changements' => $changements,
        'duree_moy_h' => $nb ? round($somme / $nb, 2) : null,
    ];
}

function upci_bulletin_texte(array $bul, array $cfg): string
{
    $moisNom = upci_mois_nom($bul['annee'], $bul['mois']);
    $l = [];
    $l[] = 'VOUS AVEZ SIGNALÉ → NOUS AVONS CHANGÉ';
    $l[] = 'Bulletin UPCI — ' . $moisNom . ' — ' . $cfg['etablissement'];
    $l[] = str_repeat('-', 55);
    $l[] = 'Signalements traités et clôturés ce mois : ' . $bul['nb_fermes'];
    $l[] = 'Délai moyen de traitement : ' . ($bul['duree_moy_h'] === null ? '—' : $bul['duree_moy_h'] . ' h');
    if ($bul['par_site']) {
        $l[] = '';
        $l[] = 'Par polyclinique :';
        foreach ($bul['par_site'] as $s => $n) $l[] = '  - ' . $s . ' : ' . $n . ' dossier(s) réglé(s)';
    }
    if ($bul['changements']) {
        $l[] = '';
        $l[] = 'Ce qui a changé grâce à vos signalements :';
        foreach ($bul['changements'] as $c) $l[] = '  • ' . $c;
    }
    $l[] = '';
    $l[] = 'Merci à toutes celles et ceux qui signalent : chaque signalement compte.';
    return implode("\n", $l);
}

function upci_bulletin_html(array $bul, array $cfg): string
{
    $moisNom = upci_mois_nom($bul['annee'], $bul['mois']);
    $s = '<h2>Vous avez signalé → nous avons changé</h2>'
        . '<p>Bulletin UPCI — ' . h($moisNom) . ' — ' . h($cfg['etablissement']) . '</p>'
        . '<p><strong>' . $bul['nb_fermes'] . '</strong> signalement(s) traité(s) et clôturé(s) ce mois'
        . ' — délai moyen : ' . ($bul['duree_moy_h'] === null ? '—' : $bul['duree_moy_h'] . ' h') . '.</p>';
    if ($bul['par_site']) {
        $s .= '<h3>Par polyclinique</h3><ul>';
        foreach ($bul['par_site'] as $site => $n) $s .= '<li>' . h($site) . ' : ' . (int)$n . ' dossier(s) réglé(s)</li>';
        $s .= '</ul>';
    }
    if ($bul['changements']) {
        $s .= '<h3>Ce qui a changé grâce à vos signalements</h3><ul>';
        foreach ($bul['changements'] as $c) $s .= '<li>' . h($c) . '</li>';
        $s .= '</ul>';
    }
    $s .= '<p><em>Merci à toutes celles et ceux qui signalent : chaque signalement compte.</em></p>';
    return $s;
}
