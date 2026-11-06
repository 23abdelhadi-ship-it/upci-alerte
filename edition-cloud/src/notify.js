/**
 * Notifications — Telegram (API Bot, via fetch) et courriel.
 *
 * Telegram n'est qu'un CANAL d'alerte : les messages ne contiennent
 * aucune donnée patient (le système n'en collecte aucune). Toute
 * fonction réseau échoue en silence (journal console) pour ne jamais
 * bloquer l'enregistrement d'un signalement.
 *
 * COURRIEL — choix documenté : ni Workers ni Node standard ne parlent
 * SMTP sans dépendance. L'envoi passe donc par une API HTTPS générique
 * optionnelle (cfg.mail_api_url + cfg.mail_api_key, corps JSON
 * {from, to, subject, text}, en-tête Bearer — compatible p. ex.
 * Resend). Sans service configuré, l'envoi est ignoré proprement et
 * journalisé : Telegram reste le canal d'alerte principal, comme dans
 * les éditions Apps Script et PHP (où mail() dépendait du MTA local).
 */
import { h, texteBrut, jsonTableau, fmt } from './util.js';

/** Appel bas niveau à l'API Telegram avec un jeton explicite. */
export async function tgApiJeton(token, method, params) {
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) {
      console.error(`UPCI Telegram ${method} : échec ou réponse invalide`);
      return null;
    }
    return data;
  } catch (e) {
    console.error(`UPCI Telegram ${method} :`, e?.message || e);
    return null;
  }
}

/** Appel à l'API Telegram avec le jeton de la configuration effective. */
export function tgApi(ctx, method, params) {
  return tgApiJeton(ctx.cfg.telegram_token, method, params);
}

/** Texte (HTML Telegram) de l'alerte d'un signalement — reconstruit à l'identique pour l'édition après accusé. */
export function texteAlerte(sig) {
  const types = jsonTableau(sig.types);
  const mesures = jsonTableau(sig.mesures);
  const crit = !!sig.est_critique;
  const l = [];
  l.push(crit ? '🚨🚨 <b>SIGNALEMENT CRITIQUE</b> 🚨🚨' : '<b>Nouveau signalement PCI</b>');
  l.push(`N° : <b>${h(sig.numero)}</b>`);
  l.push(`Polyclinique : ${h(sig.polyclinique)}`);
  if (sig.service) l.push(`Service : ${h(sig.service)}`);
  if (sig.lieu) l.push(`Lieu : ${h(sig.lieu)}`);
  if (types.length) l.push(`Type : ${h(types.join(' ; '))}`);
  l.push(`Gravité : ${sig.gravite}/5`);
  if (sig.delai_demande) l.push(`Délai demandé : ${h(sig.delai_demande)}`);
  if (sig.action_immediate) l.push(`Action immédiate : ${h(sig.action_immediate)}`);
  if (mesures.length) l.push(`Mesures : ${h(mesures.join(' ; '))}`);
  if (sig.pris_en_charge_le) {
    l.push(`✅ Pris en charge par ${h(sig.accuse_par || '—')} le ${fmt(sig.pris_en_charge_le)}`);
  }
  return l.join('\n');
}

/** Corps texte brut (courriel) de l'alerte d'un signalement. */
export function corpsAlerte(sig) {
  return texteBrut(texteAlerte(sig));
}

/**
 * Envoie l'alerte Telegram d'un signalement, AVEC le bouton
 * « ✅ Pris en charge » (callback_data « ack:<numéro> »).
 * Retourne les références [{chat_id, message_id}] à conserver.
 */
export async function telegramAlerte(ctx, sig) {
  const cfg = ctx.cfg;
  const refs = [];
  if (!cfg.telegram_token || !(cfg.telegram_chat_ids || []).length) return refs;
  const params = { text: texteAlerte(sig), parse_mode: 'HTML' };
  if (cfg.accuse_telegram) {
    params.reply_markup = {
      inline_keyboard: [[{ text: '✅ Pris en charge', callback_data: `ack:${sig.numero}` }]],
    };
  }
  for (const chatId of cfg.telegram_chat_ids) {
    const res = await tgApi(ctx, 'sendMessage', { ...params, chat_id: chatId });
    if (res?.result?.message_id) {
      refs.push({ chat_id: String(chatId), message_id: res.result.message_id });
    }
  }
  return refs;
}

/** Met à jour toutes les copies du message d'alerte après accusé (bouton retiré, mention ajoutée). */
export async function telegramMajApresAccuse(ctx, sig) {
  for (const r of jsonTableau(sig.telegram_msgs)) {
    await tgApi(ctx, 'editMessageText', {
      chat_id: r.chat_id,
      message_id: r.message_id,
      text: texteAlerte(sig),
      parse_mode: 'HTML',
    });
  }
}

/** Message Telegram simple (sans bouton) vers tous les destinataires configurés d'une config donnée. */
export async function telegramSimple(cfg, texteHtml) {
  if (!cfg.telegram_token || !(cfg.telegram_chat_ids || []).length) return 0;
  let n = 0;
  for (const chatId of cfg.telegram_chat_ids) {
    const res = await tgApiJeton(cfg.telegram_token, 'sendMessage', {
      chat_id: chatId, text: texteHtml, parse_mode: 'HTML',
    });
    if (res) n++;
  }
  return n;
}

/**
 * Envoi d'un courriel via l'API HTTPS configurée. Retourne true/false,
 * n'échoue jamais bruyamment. Sans API configurée : retourne false
 * (l'appelant décide du message — le canal n'est simplement pas actif).
 */
export async function envoyerMail(ctx, to, sujet, corps) {
  const cfg = ctx.cfg;
  if (!to || !String(to).includes('@')) return false;
  if (!cfg.mail_api_url) {
    console.error(`UPCI mail : aucun service d'email configuré (UPCI_MAIL_API_URL) — envoi à ${to} ignoré`);
    return false;
  }
  try {
    const res = await fetch(cfg.mail_api_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.mail_api_key ? { Authorization: `Bearer ${cfg.mail_api_key}` } : {}),
      },
      body: JSON.stringify({ from: cfg.mail_from, to, subject: sujet, text: corps }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`UPCI mail : l'API a répondu ${res.status} pour ${to}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('UPCI mail :', e?.message || e);
    return false;
  }
}

/** Notification combinée (courriel aux destinataires d'alerte + Telegram) — relances, escalades, système. */
export async function notifier(ctx, sujet, corps) {
  for (const email of ctx.cfg.emails_alertes || []) {
    await envoyerMail(ctx, email, sujet, corps);
  }
  await telegramSimple(ctx.cfg, `<b>${h(sujet)}</b>\n\n${h(corps)}`);
}
