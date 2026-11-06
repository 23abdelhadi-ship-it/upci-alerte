<?php
/**
 * Notifications — Telegram (API Bot) et email (mail()).
 * Telegram n'est qu'un CANAL d'alerte : les messages ne contiennent
 * aucune donnée patient (le système n'en collecte aucune) et aucun
 * détail sensible au-delà du résumé opérationnel du signalement.
 * Toute fonction réseau échoue en silence (journal système) pour ne
 * jamais bloquer l'enregistrement d'un signalement.
 */
defined('UPCI') or exit;

/** Appel générique à l'API Telegram. Retourne le tableau décodé ou null. */
function upci_tg_api(string $method, array $params): ?array
{
    $cfg = upci_config();
    $token = $cfg['telegram_token'] ?? '';
    if ($token === '') {
        return null; // Telegram non configuré : on ignore proprement.
    }
    $url = 'https://api.telegram.org/bot' . $token . '/' . $method;
    $data = null;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $params,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
        ]);
        $res = curl_exec($ch);
        if ($res !== false) {
            $data = json_decode((string)$res, true);
        }
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => [
            'method'  => 'POST',
            'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => http_build_query($params),
            'timeout' => 15,
        ]]);
        $res = @file_get_contents($url, false, $ctx);
        if ($res !== false) {
            $data = json_decode($res, true);
        }
    }
    if (!is_array($data) || empty($data['ok'])) {
        error_log('UPCI Telegram ' . $method . ' : échec ou réponse invalide');
        return null;
    }
    return $data;
}

/** Texte (HTML Telegram) de l'alerte d'un signalement — reconstruit à l'identique pour l'édition après accusé. */
function upci_texte_alerte(array $sig): string
{
    $types = json_decode($sig['types'] ?: '[]', true) ?: [];
    $mesures = json_decode($sig['mesures'] ?: '[]', true) ?: [];
    $crit = !empty($sig['est_critique']);
    $lignes = [];
    $lignes[] = $crit ? '🚨🚨 <b>SIGNALEMENT CRITIQUE</b> 🚨🚨' : '<b>Nouveau signalement PCI</b>';
    $lignes[] = 'N° : <b>' . h($sig['numero']) . '</b>';
    $lignes[] = 'Polyclinique : ' . h($sig['polyclinique']);
    if ($sig['service']) $lignes[] = 'Service : ' . h($sig['service']);
    if ($sig['lieu'])    $lignes[] = 'Lieu : ' . h($sig['lieu']);
    if ($types)          $lignes[] = 'Type : ' . h(implode(' ; ', $types));
    $lignes[] = 'Gravité : ' . (int)$sig['gravite'] . '/5';
    if ($sig['delai_demande']) $lignes[] = 'Délai demandé : ' . h($sig['delai_demande']);
    if ($sig['action_immediate']) $lignes[] = 'Action immédiate : ' . h($sig['action_immediate']);
    if ($mesures) $lignes[] = 'Mesures : ' . h(implode(' ; ', $mesures));
    if (!empty($sig['pris_en_charge_le'])) {
        $lignes[] = '✅ Pris en charge par ' . h($sig['accuse_par'] ?: '—')
            . ' le ' . upci_fmt($sig['pris_en_charge_le']);
    }
    return implode("\n", $lignes);
}

/** Corps texte brut (email) de l'alerte d'un signalement. */
function upci_corps_alerte(array $sig): string
{
    return html_entity_decode(strip_tags(str_replace('<br>', "\n", upci_texte_alerte($sig))), ENT_QUOTES, 'UTF-8');
}

/**
 * Envoie l'alerte Telegram d'un signalement, AVEC le bouton
 * « ✅ Pris en charge » (callback_data « ack:<numéro> »).
 * Retourne les références [{chat_id, message_id}] à conserver.
 */
function upci_telegram_alerte(array $sig): array
{
    $cfg = upci_config();
    $refs = [];
    if (empty($cfg['telegram_token']) || empty($cfg['telegram_chat_ids'])) {
        return $refs;
    }
    $params = [
        'text'       => upci_texte_alerte($sig),
        'parse_mode' => 'HTML',
    ];
    if (!empty($cfg['accuse_telegram'])) {
        $params['reply_markup'] = json_encode([
            'inline_keyboard' => [[
                ['text' => '✅ Pris en charge', 'callback_data' => 'ack:' . $sig['numero']],
            ]],
        ]);
    }
    foreach ($cfg['telegram_chat_ids'] as $chatId) {
        $params['chat_id'] = $chatId;
        $res = upci_tg_api('sendMessage', $params);
        if ($res && isset($res['result']['message_id'])) {
            $refs[] = ['chat_id' => (string)$chatId, 'message_id' => (int)$res['result']['message_id']];
        }
    }
    return $refs;
}

/** Met à jour toutes les copies du message d'alerte après accusé (bouton retiré, mention ajoutée). */
function upci_telegram_maj_apres_accuse(array $sig): void
{
    $refs = json_decode($sig['telegram_msgs'] ?: '[]', true) ?: [];
    foreach ($refs as $r) {
        upci_tg_api('editMessageText', [
            'chat_id'    => $r['chat_id'],
            'message_id' => $r['message_id'],
            'text'       => upci_texte_alerte($sig),
            'parse_mode' => 'HTML',
        ]);
    }
}

/** Message Telegram simple (sans bouton) vers tous les destinataires configurés. */
function upci_telegram_simple(string $texteHtml): void
{
    $cfg = upci_config();
    if (empty($cfg['telegram_token']) || empty($cfg['telegram_chat_ids'])) {
        return;
    }
    foreach ($cfg['telegram_chat_ids'] as $chatId) {
        upci_tg_api('sendMessage', [
            'chat_id'    => $chatId,
            'text'       => $texteHtml,
            'parse_mode' => 'HTML',
        ]);
    }
}

/** Envoi d'un email. Retourne true/false, n'échoue jamais bruyamment. */
function upci_mail(string $to, string $sujet, string $corps): bool
{
    $cfg = upci_config();
    if ($to === '' || strpos($to, '@') === false) {
        return false;
    }
    $headers = implode("\r\n", [
        'From: UPCI Alert <' . ($cfg['mail_from'] ?? 'upci@exemple.dz') . '>',
        'Content-Type: text/plain; charset=UTF-8',
        'X-Mailer: UPCI-Serveur',
    ]);
    $sujetEnc = '=?UTF-8?B?' . base64_encode($sujet) . '?=';
    $ok = @mail($to, $sujetEnc, $corps, $headers);
    if (!$ok) {
        error_log('UPCI mail : échec d’envoi vers ' . $to . ' (MTA non configuré ?)');
    }
    return (bool)$ok;
}

/** Notification combinée (email aux destinataires d'alerte + Telegram) — relances, escalades, système. */
function upci_notifier(string $sujet, string $corps): void
{
    $cfg = upci_config();
    foreach ($cfg['emails_alertes'] ?? [] as $email) {
        upci_mail($email, $sujet, $corps);
    }
    upci_telegram_simple('<b>' . h($sujet) . '</b>' . "\n\n" . h($corps));
}
