<?php
/**
 * Webhook Telegram — point d'entrée du bouton « ✅ Pris en charge »
 * (callback_query) et des commandes simples /stats, /critiques, /aide.
 * À enregistrer auprès de Telegram via setWebhook (voir INSTALL.md).
 * Si telegram_webhook_secret est défini, l'en-tête
 * X-Telegram-Bot-Api-Secret-Token est exigé.
 */
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/notify.php';
require __DIR__ . '/lib/metier.php';

$cfg = upci_config();
header('Content-Type: application/json');

$secret = (string)($cfg['telegram_webhook_secret'] ?? '');
if ($secret !== '') {
    $recu = (string)($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '');
    if (!hash_equals($secret, $recu)) {
        http_response_code(403);
        echo json_encode(['ok' => false]);
        exit;
    }
}

$brut = file_get_contents('php://input');
$upd = json_decode($brut ?: '', true);
if (!is_array($upd)) {
    echo json_encode(['ok' => true]);
    exit;
}

$pdo = upci_db();

// --- Bouton « ✅ Pris en charge »
if (isset($upd['callback_query'])) {
    $cq = $upd['callback_query'];
    $data = (string)($cq['data'] ?? '');
    if (strpos($data, 'ack:') === 0) {
        $numero = substr($data, 4);
        $chatId = (string)($cq['message']['chat']['id'] ?? '');
        $texte = upci_accuser($pdo, $numero, $cq['from'] ?? [], $chatId);
        upci_tg_api('answerCallbackQuery', [
            'callback_query_id' => $cq['id'],
            'text' => $texte,
        ]);
    }
    echo json_encode(['ok' => true]);
    exit;
}

// --- Commandes simples (conversations autorisées uniquement)
if (isset($upd['message']['text'])) {
    $chatId = (string)($upd['message']['chat']['id'] ?? '');
    $texteIn = trim((string)$upd['message']['text']);
    if (in_array($chatId, array_map('strval', $cfg['telegram_chat_ids'] ?? []), true)) {
        $reponse = null;
        if ($texteIn === '/aide' || $texteIn === '/start') {
            $reponse = "Commandes UPCI :\n/stats — synthèse du registre\n/critiques — critiques encore ouverts\nLe bouton « ✅ Pris en charge » sous chaque alerte enregistre l'accusé.";
        } elseif ($texteIn === '/stats') {
            $total = (int)$pdo->query('SELECT COUNT(*) FROM signalements WHERE est_demo = 0')->fetchColumn();
            $ouverts = (int)$pdo->query('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND date_cloture IS NULL')->fetchColumn();
            $crit = (int)$pdo->query('SELECT COUNT(*) FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL')->fetchColumn();
            $reponse = "📊 Registre UPCI\nSignalements : $total\nOuverts : $ouverts\nCritiques ouverts : $crit";
        } elseif ($texteIn === '/critiques') {
            $rows = $pdo->query('SELECT numero, polyclinique, gravite, date_creation FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL ORDER BY date_creation LIMIT 15')->fetchAll();
            if (!$rows) {
                $reponse = '✅ Aucun critique ouvert.';
            } else {
                $l = ['🚨 Critiques ouverts :'];
                foreach ($rows as $r) {
                    $l[] = $r['numero'] . ' — ' . $r['polyclinique'] . ' — gravité ' . $r['gravite'] . ' — depuis le ' . upci_fmt($r['date_creation']);
                }
                $reponse = implode("\n", $l);
            }
        }
        if ($reponse !== null) {
            upci_tg_api('sendMessage', ['chat_id' => $chatId, 'text' => $reponse]);
        }
    }
    echo json_encode(['ok' => true]);
    exit;
}

echo json_encode(['ok' => true]);
