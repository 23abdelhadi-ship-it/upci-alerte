<?php
/**
 * Logique métier — création, accusé Telegram, clôture, réouverture.
 * Miroir fidèle de l'édition Apps Script (Code.gs V5) :
 * numérotation séquentielle UPCI-AAAA-NNNN, critique = gravité >= seuil
 * ou délai « Immédiat », clôture sur la même ligne, journal d'audit.
 */
defined('UPCI') or exit;

/** Prochain numéro séquentiel — transaction immédiate, anti-collision. */
function upci_nouveau_numero(PDO $pdo): string
{
    $annee = (int)date('Y');
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $st = $pdo->prepare('INSERT INTO compteurs (annee, dernier) VALUES (?, 1)
                             ON CONFLICT(annee) DO UPDATE SET dernier = dernier + 1');
        $st->execute([$annee]);
        $st = $pdo->prepare('SELECT dernier FROM compteurs WHERE annee = ?');
        $st->execute([$annee]);
        $n = (int)$st->fetchColumn();
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
    return 'UPCI-' . $annee . '-' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
}

/**
 * Crée un signalement. $opts : demo (bool), date (ISO forcée, seed),
 * notifier (bool, défaut true — false pour le mode démo).
 * Retourne la ligne créée.
 */
function upci_creer_signalement(PDO $pdo, array $in, array $opts = []): array
{
    $cfg  = upci_config();
    $demo = !empty($opts['demo']);
    if ($demo) {
        // Numérotation DÉMO séparée — ne consomme pas la numérotation officielle.
        $annee = (int)date('Y');
        $st = $pdo->prepare("SELECT COUNT(*) FROM signalements WHERE est_demo = 1 AND numero LIKE ?");
        $st->execute(['DÉMO-' . $annee . '-%']);
        $numero = 'DÉMO-' . $annee . '-' . str_pad((string)((int)$st->fetchColumn() + 1), 3, '0', STR_PAD_LEFT);
    } else {
        $numero = upci_nouveau_numero($pdo);
    }
    $gravite = max(0, min(5, (int)($in['gravite'] ?? 0)));
    $delai   = (string)($in['delai_demande'] ?? '');
    $critique = ($gravite >= (int)$cfg['seuil_critique'])
        || (mb_stripos($delai, 'immédiat') !== false)
        || (stripos($delai, 'immediat') !== false);
    $date = $opts['date'] ?? upci_now();
    $statut = $critique ? 'CRITIQUE — En attente' : 'En attente';

    $st = $pdo->prepare('INSERT INTO signalements
        (numero, date_creation, polyclinique, service, lieu, periode, types, gravite,
         action_immediate, mesures, delai_demande, email_declarant, statut, est_critique, est_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $st->execute([
        $numero, $date,
        (string)($in['polyclinique'] ?? ''),
        (string)($in['service'] ?? ''),
        (string)($in['lieu'] ?? ''),
        (string)($in['periode'] ?? ''),
        json_encode(array_values($in['types'] ?? []), JSON_UNESCAPED_UNICODE),
        $gravite,
        (string)($in['action_immediate'] ?? ''),
        json_encode(array_values($in['mesures'] ?? []), JSON_UNESCAPED_UNICODE),
        $delai,
        (string)($in['email_declarant'] ?? ''),
        $statut,
        $critique ? 1 : 0,
        $demo ? 1 : 0,
    ]);
    $sig = upci_par_numero($pdo, $numero);
    upci_journal($pdo, $numero, $sig['email_declarant'] ?: 'Déclarant (formulaire)', 'création',
        $sig['polyclinique'] . ' — ' . $sig['service'] . ' — gravité ' . $gravite . ($demo ? ' [DÉMO]' : ''));

    if (!$demo && ($opts['notifier'] ?? true)) {
        // 1) Emails d'alerte
        $sujet = ($critique ? '🚨🚨 URGENCE CRITIQUE — ' : 'Nouveau signalement — ') . $numero;
        foreach ($cfg['emails_alertes'] ?? [] as $email) {
            upci_mail($email, $sujet, upci_corps_alerte($sig));
        }
        // 2) Telegram avec bouton d'accusé ; références conservées pour l'édition ultérieure
        $refs = upci_telegram_alerte($sig);
        if ($refs) {
            $pdo->prepare('UPDATE signalements SET telegram_msgs = ? WHERE numero = ?')
                ->execute([json_encode($refs), $numero]);
            $sig['telegram_msgs'] = json_encode($refs);
        }
        // 3) Accusé de réception au déclarant (s'il a laissé un email)
        if ($sig['email_declarant']) {
            $urlSuivi = upci_base_url() . '/statut.php';
            upci_mail($sig['email_declarant'], 'Accusé de réception — ' . $numero, implode("\n", [
                'Votre signalement a été enregistré.',
                'N° : ' . $numero,
                'Polyclinique : ' . $sig['polyclinique'],
                'Suivi de l’état : ' . $urlSuivi . ' — saisissez votre numéro ET la polyclinique.',
                'Vous recevrez un nouvel email lorsque le signalement sera traité et clôturé.',
            ]));
        }
    }
    return $sig;
}

/**
 * Accusé Telegram (bouton « ✅ Pris en charge ») — idempotent.
 * $from : tableau Telegram de l'utilisateur (first_name, username…).
 * Retourne le texte de confirmation à afficher à l'utilisateur du bouton.
 */
function upci_accuser(PDO $pdo, string $numero, array $from, string $chatId): string
{
    $cfg = upci_config();
    if (!in_array($chatId, array_map('strval', $cfg['telegram_chat_ids'] ?? []), true)) {
        return '⛔ Accusé non autorisé pour cette conversation.';
    }
    $sig = upci_par_numero($pdo, $numero);
    if (!$sig || !empty($sig['est_demo'])) {
        return 'Signalement introuvable.';
    }
    if (!empty($sig['pris_en_charge_le'])) {
        return 'Déjà pris en charge par ' . ($sig['accuse_par'] ?: '—') . ' le ' . upci_fmt($sig['pris_en_charge_le']);
    }
    if (!upci_est_ouvert($sig)) {
        return 'Ce signalement est déjà clôturé.';
    }
    $nom = trim(($from['first_name'] ?? '') . ' ' . ($from['last_name'] ?? ''));
    if (!empty($from['username'])) {
        $nom = trim($nom . ' (@' . $from['username'] . ')');
    }
    if ($nom === '') {
        $nom = 'Utilisateur Telegram';
    }
    $maintenant = upci_now();
    $statut = str_replace('En attente', 'Pris en charge', $sig['statut']);
    $pdo->prepare('UPDATE signalements SET pris_en_charge_le = ?, accuse_par = ?, statut = ? WHERE numero = ?')
        ->execute([$maintenant, $nom, $statut, $numero]);
    upci_journal($pdo, $numero, $nom, 'accusé', 'Telegram — bouton « Pris en charge »');
    $sig = upci_par_numero($pdo, $numero);
    upci_telegram_maj_apres_accuse($sig);
    return '✅ ' . $numero . ' pris en charge par ' . $nom;
}

/**
 * Clôture (page interne protégée par clé). Mêmes sémantiques que l'édition
 * Apps Script : la clôture met à jour la ligne du signalement ; une
 * ré-soumission avec SEULE la vérification d'efficacité ne touche ni la
 * date de clôture, ni la durée, ni l'intervention, et ne re-notifie pas.
 * Retourne un message de résultat (ou lève InvalidArgumentException).
 */
function upci_cloturer(PDO $pdo, string $numero, array $in, string $acteur): string
{
    $cfg = upci_config();
    $sig = upci_par_numero($pdo, trim($numero));
    if (!$sig) {
        throw new InvalidArgumentException('Numéro introuvable : ' . $numero);
    }
    $intervention = trim((string)($in['intervention'] ?? ''));
    $statutForm   = (string)($in['statut'] ?? '');
    $delaiReel    = (string)($in['delai_reel'] ?? '');
    $actionCorr   = trim((string)($in['action_corrective'] ?? ''));
    $verif        = trim((string)($in['verif_efficacite'] ?? ''));
    $dejaFerme    = !empty($sig['date_cloture']);

    // Cas V5 : vérification d'efficacité seule sur un dossier déjà clôturé.
    if ($dejaFerme && $verif !== '' && $intervention === '' && $actionCorr === '') {
        $pdo->prepare('UPDATE signalements SET verif_efficacite = ? WHERE numero = ?')
            ->execute([$verif, $sig['numero']]);
        upci_journal($pdo, $sig['numero'], $acteur, 'vérification', $verif);
        return 'Vérification d’efficacité enregistrée pour ' . $sig['numero'] . ' (clôture inchangée).';
    }

    $sets = [];
    $vals = [];
    if ($intervention !== '') { $sets[] = 'intervention = ?'; $vals[] = $intervention; }
    if ($delaiReel !== '')    { $sets[] = 'delai_reel = ?';    $vals[] = $delaiReel; }
    if ($actionCorr !== '')   { $sets[] = 'action_corrective = ?'; $vals[] = $actionCorr; }
    if ($verif !== '')        { $sets[] = 'verif_efficacite = ?';  $vals[] = $verif; }

    $nouveauStatut = null;
    $fermeMaintenant = false;
    switch ($statutForm) {
        case 'Clôturé':
            $nouveauStatut = 'Clôturé';
            if (!$dejaFerme) {
                $fermeMaintenant = true;
                $duree = (strtotime(upci_now()) - strtotime($sig['date_creation'])) / 3600;
                $sets[] = 'date_cloture = ?'; $vals[] = upci_now();
                $sets[] = 'duree_h = ?';      $vals[] = round(max($duree, 0), 2);
            }
            break;
        case 'Partiellement résolu':
            $nouveauStatut = $dejaFerme ? 'Clôturé' : 'Partiel — en cours';
            break;
        case 'En cours de traitement':
            $nouveauStatut = $dejaFerme ? 'Clôturé' : 'En cours';
            break;
        case 'Non résolu — à escalader':
            $nouveauStatut = $dejaFerme ? 'Clôturé' : 'Non résolu — ESCALADE';
            break;
    }
    if ($nouveauStatut !== null) {
        $sets[] = 'statut = ?';
        $vals[] = $nouveauStatut;
    }
    if ($sets) {
        $vals[] = $sig['numero'];
        $pdo->prepare('UPDATE signalements SET ' . implode(', ', $sets) . ' WHERE numero = ?')
            ->execute($vals);
    }
    if ($actionCorr !== '') {
        upci_journal($pdo, $sig['numero'], $acteur, 'action corrective', $actionCorr);
    }
    if ($verif !== '') {
        upci_journal($pdo, $sig['numero'], $acteur, 'vérification', $verif);
    }

    if ($fermeMaintenant) {
        upci_journal($pdo, $sig['numero'], $acteur, 'clôture',
            ($intervention ?: '—') . ' | Durée : ' . round((strtotime(upci_now()) - strtotime($sig['date_creation'])) / 3600, 2) . ' h');
        // Notification du déclarant (édition publiée : « traité et clôturé »).
        if (empty($sig['est_demo']) && $sig['email_declarant']) {
            upci_mail($sig['email_declarant'], 'Signalement traité et clôturé — ' . $sig['numero'], implode("\n", [
                'Votre signalement ' . $sig['numero'] . ' (' . $sig['polyclinique'] . ') a été traité et clôturé.',
                'Intervention réalisée : ' . ($intervention ?: '—'),
                'Merci de votre vigilance — chaque signalement fait changer les choses.',
            ]));
        }
        return 'Signalement ' . $sig['numero'] . ' CLÔTURÉ.';
    }
    if ($statutForm === 'Non résolu — à escalader' && !$dejaFerme) {
        upci_journal($pdo, $sig['numero'], $acteur, 'escalade', 'Clôture « Non résolu » — escalade manuelle');
        upci_notifier('⛔ ESCALADE — ' . $sig['numero'] . ' déclaré NON RÉSOLU',
            $sig['numero'] . ' — ' . $sig['polyclinique'] . ' — ' . $sig['service'] . "\nIntervention tentée : " . ($intervention ?: '—'));
        return 'Signalement ' . $sig['numero'] . ' marqué NON RÉSOLU — escalade envoyée.';
    }
    return 'Signalement ' . $sig['numero'] . ' mis à jour (' . ($nouveauStatut ?? $sig['statut']) . ').';
}

/** Réouverture manuelle par l'administrateur (depuis l'éditeur ou la page admin). */
function upci_rouvrir(PDO $pdo, string $numero, string $acteur): string
{
    $sig = upci_par_numero($pdo, $numero);
    if (!$sig) {
        throw new InvalidArgumentException('Numéro introuvable : ' . $numero);
    }
    $statut = !empty($sig['est_critique']) ? 'CRITIQUE — En attente' : 'En attente';
    $pdo->prepare('UPDATE signalements SET date_cloture = NULL, duree_h = NULL, statut = ? WHERE numero = ?')
        ->execute([$statut, $numero]);
    upci_journal($pdo, $numero, $acteur, 'réouverture', 'Réouverture manuelle');
    return 'Signalement ' . $numero . ' rouvert.';
}
