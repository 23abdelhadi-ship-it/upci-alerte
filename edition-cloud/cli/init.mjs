/**
 * Initialisation / vérification d'installation (Node).
 *   node cli/init.mjs              → crée la base et vérifie la configuration
 *   node cli/init.mjs --webhook    → enregistre le webhook Telegram (base_url requis)
 * Sous Cloudflare, l'équivalent est : wrangler d1 execute --file=schema.sql
 * puis ouvrir /installation dans le navigateur (voir INSTALL.md).
 */
import { contexteCli } from './env.mjs';
import { estConfigure } from '../src/settings.js';
import { tgApiJeton } from '../src/notify.js';

const ctx = await contexteCli();
const cfg = ctx.cfg;
let ok = true;
const ligne = (bon, txt) => { console.log(`  ${bon ? '✅' : '❌'} ${txt}`); if (!bon) ok = false; };
const warn = (txt) => console.log(`  ⚠️  ${txt}`);

console.log('UPCI Alert — édition portable (Node) : initialisation');
ligne(Number(process.versions.node.split('.')[0]) >= 20, `Node.js >= 20 (actuel : ${process.versions.node})`);
try {
  const test = await ctx.db.first("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'signalements'");
  ligne(!!test, 'Module node:sqlite opérationnel');
} catch (e) {
  ligne(false, `node:sqlite indisponible : ${e.message} (Node 22.5+ requis, 24 recommandé)`);
}
ligne(true, `Base SQLite créée/vérifiée : ${ctx.cheminBase}`);
const nb = Number((await ctx.db.first('SELECT COUNT(*) AS n FROM signalements')).n);
console.log(`     Signalements actuellement au registre : ${nb}`);

if (await estConfigure(ctx)) {
  ligne(true, 'Système configuré via l’interface de réglages (table reglages)');
} else {
  warn('Système PAS encore configuré : démarrez le serveur (node server.mjs) et ouvrez /installation.');
}
if (!cfg.closure_key || cfg.closure_key === 'CHANGEZ-CETTE-CLE') {
  warn('Clé de clôture non définie : la page de clôture restera verrouillée (réglages ou UPCI_CLOSURE_KEY).');
}
if (!cfg.admin_password_hash) {
  warn('Mot de passe admin non défini : zone admin verrouillée. Définissez-le via /installation ou générez une empreinte : node cli/hash.mjs');
}
if (!cfg.telegram_token || !(cfg.telegram_chat_ids || []).length) {
  warn('Telegram non configuré (jeton et/ou chat ids) : pas d’alertes Telegram tant que les réglages ne sont pas remplis.');
}
if (!cfg.mail_api_url) {
  warn('Aucun service d’email configuré (UPCI_MAIL_API_URL) : les courriels seront ignorés proprement ; Telegram reste le canal d’alerte.');
}

if (process.argv.includes('--webhook')) {
  if (!cfg.base_url) {
    warn('--webhook ignoré : UPCI_BASE_URL est vide (adresse publique HTTPS requise).');
  } else if (!cfg.telegram_token) {
    warn('--webhook ignoré : aucun jeton Telegram.');
  } else {
    const params = { url: `${cfg.base_url.replace(/\/+$/, '')}/webhook` };
    if (cfg.telegram_webhook_secret) params.secret_token = cfg.telegram_webhook_secret;
    const res = await tgApiJeton(cfg.telegram_token, 'setWebhook', params);
    ligne(!!res, `Webhook Telegram enregistré → ${params.url}`);
  }
}
ctx.fermer();
process.exit(ok ? 0 : 1);
