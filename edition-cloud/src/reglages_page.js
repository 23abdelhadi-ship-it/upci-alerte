/**
 * Interface de réglages — UN seul formulaire, deux domiciles :
 *   - /installation  : premier lancement, tant que le système n'est
 *     pas configuré (table « reglages » sans marqueur « installe »).
 *     Une fois l'installation terminée, cette route se VERROUILLE
 *     définitivement et redirige vers la connexion admin.
 *   - /admin/reglages : le même formulaire, ensuite, derrière le mot
 *     de passe administrateur.
 *
 * Les valeurs vivent dans la base (table reglages) et sont relues à
 * chaque exécution (settings.js) — aucun fichier à éditer après
 * l'installation, dans les DEUX domiciles (Workers/D1 et Node/SQLite).
 *
 * SÉCURITÉ : le jeton Telegram et la clé de clôture ne sont JAMAIS
 * réaffichés après enregistrement (champ vide + mention « défini ») ;
 * un champ secret laissé vide à l'enregistrement conserve la valeur
 * existante. Le mot de passe admin n'est stocké que sous forme
 * d'empreinte PBKDF2.
 */
import { h, emailValide, hacherMotDePasse } from './util.js';
import { pageDebut, pageFin, reponseHtml, redirection } from './vue.js';
import { enregistrerReglages, estConfigure, chargerReglages } from './settings.js';
import { telegramSimple, envoyerMail, tgApiJeton } from './notify.js';

const MASQUE = '••••••••';

/** Valeurs affichées dans le formulaire (depuis la config effective). */
function valeursAffichage(ctx) {
  const cfg = ctx.cfg;
  return {
    etablissement: cfg.etablissement ?? '',
    sites: (cfg.sites ?? []).join('\n'),
    emails_alertes: (cfg.emails_alertes ?? []).join(', '),
    emails_bulletin: (cfg.emails_bulletin ?? []).join(', '),
    telegram_chat_ids: (cfg.telegram_chat_ids ?? []).join(', '),
    seuil_critique: cfg.seuil_critique ?? 4,
    sla_relance_h: cfg.sla_relance_h ?? 1,
    sla_escalade_h: cfg.sla_escalade_h ?? 4,
    token_defini: !!cfg.telegram_token,
    cle_definie: !!cfg.closure_key && cfg.closure_key !== 'CHANGEZ-CETTE-CLE',
  };
}

/** Formulaire HTML (partagé installation / admin). */
function formulaire(ctx, mode, v, { message = '', erreur = '', test = '' } = {}) {
  const installation = mode === 'installation';
  let s = pageDebut(ctx.cfg, installation ? 'Installation — première configuration' : 'Réglages');
  s += installation
    ? '<h1>🔧 Installation — première configuration</h1>'
      + '<p class="intro">Bienvenue. Renseignez les réglages de votre établissement : '
      + 'ils sont enregistrés dans la base du système et modifiables ensuite dans '
      + '<strong>Administration → Réglages</strong>. Aucun fichier à éditer.</p>'
    : '<h1>⚙️ Réglages de l’établissement</h1>'
      + '<p class="intro">Ces réglages vivent dans la base et prennent effet immédiatement. '
      + 'Les champs secrets laissés vides conservent leur valeur actuelle.</p>';
  if (message) s += `<div class="ok">${h(message)}</div>`;
  if (erreur) s += `<div class="alerte">${h(erreur)}</div>`;
  if (test) s += `<div class="${test.startsWith('✅') ? 'ok' : 'alerte'}">${h(test)}</div>`;

  s += '<form method="post" class="form">'
    + '<label>Nom de l’établissement *</label>'
    + `<input type="text" name="etablissement" value="${h(v.etablissement)}" required>`
    + '<label>Polycliniques / sites * — un par ligne</label>'
    + `<textarea name="sites" rows="6" required>${h(v.sites)}</textarea>`
    + '<label>Emails d’alerte (chef UPCI, administration) — séparés par des virgules</label>'
    + `<input type="text" name="emails_alertes" value="${h(v.emails_alertes)}" placeholder="chef-upci@exemple.dz, admin@exemple.dz">`
    + '<label>Emails du bulletin mensuel (facultatif — vide = emails d’alerte)</label>'
    + `<input type="text" name="emails_bulletin" value="${h(v.emails_bulletin)}">`
    + '<label>Jeton du bot Telegram (BotFather)'
    + (v.token_defini ? ` — <em>un jeton est enregistré (${MASQUE}) ; laissez vide pour le conserver</em>` : '')
    + '</label>'
    + '<input type="password" name="telegram_token" autocomplete="off" placeholder="123456:ABC-…">'
    + '<label>Identifiants de conversation Telegram (chat IDs) — séparés par des virgules</label>'
    + `<input type="text" name="telegram_chat_ids" value="${h(v.telegram_chat_ids)}" placeholder="123456789">`
    + '<label>Gravité critique à partir de (seuil)</label>'
    + `<input type="text" name="seuil_critique" value="${h(v.seuil_critique)}">`
    + '<label>Relance des critiques après (heures)</label>'
    + `<input type="text" name="sla_relance_h" value="${h(v.sla_relance_h)}">`
    + '<label>Escalade des critiques après (heures)</label>'
    + `<input type="text" name="sla_escalade_h" value="${h(v.sla_escalade_h)}">`
    + '<label>Mot de passe administrateur' + (installation ? ' *' : ' — laissez vide pour le conserver') + '</label>'
    + '<input type="password" name="admin_password" autocomplete="new-password">'
    + '<label>Clé d’accès de la page de clôture'
    + (v.cle_definie ? ` — <em>une clé est définie (${MASQUE}) ; laissez vide pour la conserver</em>` : (installation ? ' *' : ''))
    + '</label>'
    + '<input type="password" name="closure_key" autocomplete="off">'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<button class="btn gros" type="submit" name="action" value="enregistrer" style="flex:2">💾 Enregistrer les réglages</button>'
    + '<button class="btn secondaire" type="submit" name="action" value="test_telegram" formnovalidate>✈️ Envoyer un message Telegram test</button>'
    + '<button class="btn secondaire" type="submit" name="action" value="test_email" formnovalidate>✉️ Envoyer un courriel test</button>'
    + '</div>'
    + '<p class="note">Les boutons de test utilisent les valeurs saisies dans ce formulaire '
    + '(ou, à défaut, celles déjà enregistrées) — vous pouvez tester avant d’enregistrer.</p>'
    + '</form>';
  s += pageFin();
  return s;
}

/** Découpe une liste saisie (virgules ou retours à la ligne). */
const decouper = (brut) => String(brut ?? '')
  .split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

/** Lit le formulaire POST et construit les valeurs candidates + la config de test. */
async function lireFormulaire(ctx, request) {
  const fd = await request.formData();
  const champ = (n) => String(fd.get(n) ?? '');
  const tokenSaisi = champ('telegram_token').trim();
  const cleSaisie = champ('closure_key').trim();
  const cfgTest = {
    ...ctx.cfg,
    telegram_token: tokenSaisi || ctx.cfg.telegram_token,
    telegram_chat_ids: decouper(champ('telegram_chat_ids')).length
      ? decouper(champ('telegram_chat_ids')) : ctx.cfg.telegram_chat_ids,
    emails_alertes: decouper(champ('emails_alertes')).length
      ? decouper(champ('emails_alertes')) : ctx.cfg.emails_alertes,
  };
  return { fd, champ, tokenSaisi, cleSaisie, cfgTest };
}

/**
 * Enregistre le webhook Telegram sur l'adresse publique du système
 * (origine de la requête + /webhook). SANS cette étape — automatique
 * ici — Telegram envoie les alertes mais ne transmet jamais les appuis
 * sur le bouton « ✅ Pris en charge » ni les commandes /stats /critiques.
 */
async function activerWebhook(token, request) {
  if (!token) return '';
  const origine = new URL(request.url).origin;
  if (!origine.startsWith('https://')) {
    return ' ℹ️ Webhook Telegram non activé : adresse non publique (https requis) — le bouton « Pris en charge » s’activera sur l’adresse publique de production.';
  }
  const r = await tgApiJeton(token, 'setWebhook', {
    url: `${origine}/webhook`,
    allowed_updates: ['message', 'callback_query'],
  });
  return r
    ? ' 🔗 Webhook Telegram activé : le bouton « ✅ Pris en charge » et les commandes /stats et /critiques répondent désormais.'
    : ' ⚠️ Webhook Telegram : Telegram a refusé l’activation — vérifiez le jeton du bot.';
}

/** Exécute un des deux tests et retourne le message de résultat affiché à l'écran. */
async function executerTest(ctx, action, cfgTest, request) {
  if (action === 'test_telegram') {
    if (!cfgTest.telegram_token) return '❌ Test Telegram impossible : aucun jeton de bot (ni saisi, ni enregistré).';
    if (!(cfgTest.telegram_chat_ids || []).length) return '❌ Test Telegram impossible : aucun identifiant de conversation (chat ID).';
    const n = await telegramSimple(cfgTest,
      '✅ <b>Message test UPCI</b>\nSi vous lisez ceci, le canal d’alerte Telegram de votre établissement fonctionne.');
    if (n <= 0) return '❌ Échec de l’envoi Telegram : vérifiez le jeton du bot et les chat IDs (le bot doit avoir reçu un premier message de chaque destinataire).';
    const note = await activerWebhook(cfgTest.telegram_token, request);
    return `✅ Message Telegram test envoyé (${n} conversation(s)) — vérifiez votre Telegram.${note}`;
  }
  if (action === 'test_email') {
    const dest = (cfgTest.emails_alertes || [])[0];
    if (!dest) return '❌ Test courriel impossible : aucun email d’alerte saisi ou enregistré.';
    if (!cfgTest.mail_api_url) {
      return '❌ Courriel non envoyé : aucun service d’email n’est configuré sur la plateforme '
        + '(variable UPCI_MAIL_API_URL — voir INSTALL.md). Le canal d’alerte principal reste Telegram.';
    }
    const ok = await envoyerMail({ cfg: cfgTest }, dest, 'Test UPCI — canal courriel',
      'Ceci est un courriel de test du système d’alerte UPCI de votre établissement.\nSi vous le recevez, le canal courriel fonctionne.');
    return ok
      ? `✅ Courriel test envoyé à ${dest} — vérifiez la boîte de réception.`
      : `❌ Échec de l’envoi du courriel à ${dest} : le service d’email configuré a refusé ou est injoignable.`;
  }
  return '';
}

/** Traitement commun POST : tests ou enregistrement. Retourne une Response. */
async function traiterPost(ctx, request, mode) {
  const installation = mode === 'installation';
  const { champ, tokenSaisi, cleSaisie, cfgTest } = await lireFormulaire(ctx, request);
  const action = champ('action') || 'enregistrer';

  if (action === 'test_telegram' || action === 'test_email') {
    const test = await executerTest(ctx, action, cfgTest, request);
    const v = { ...valeursAffichage(ctx),
      etablissement: champ('etablissement'), sites: champ('sites'),
      emails_alertes: champ('emails_alertes'), emails_bulletin: champ('emails_bulletin'),
      telegram_chat_ids: champ('telegram_chat_ids'),
      seuil_critique: champ('seuil_critique'), sla_relance_h: champ('sla_relance_h'),
      sla_escalade_h: champ('sla_escalade_h') };
    return reponseHtml(formulaire(ctx, mode, v, { test }));
  }

  // --- Enregistrement -------------------------------------------------
  const erreurs = [];
  const etablissement = champ('etablissement').trim();
  const sites = decouper(champ('sites'));
  const emailsAlertes = decouper(champ('emails_alertes'));
  const emailsBulletin = decouper(champ('emails_bulletin'));
  const chats = decouper(champ('telegram_chat_ids'));
  const seuil = parseInt(champ('seuil_critique'), 10);
  const relance = Number(champ('sla_relance_h'));
  const escalade = Number(champ('sla_escalade_h'));
  const motDePasse = champ('admin_password');
  if (!etablissement) erreurs.push('Le nom de l’établissement est requis.');
  if (!sites.length) erreurs.push('Indiquez au moins une polyclinique (une par ligne).');
  for (const e of [...emailsAlertes, ...emailsBulletin]) {
    if (!emailValide(e)) erreurs.push(`Email invalide : ${e}`);
  }
  if (!Number.isFinite(seuil) || seuil < 1 || seuil > 5) erreurs.push('Le seuil critique doit être entre 1 et 5.');
  if (!Number.isFinite(relance) || relance <= 0) erreurs.push('Les heures de relance doivent être un nombre positif.');
  if (!Number.isFinite(escalade) || escalade <= 0) erreurs.push('Les heures d’escalade doivent être un nombre positif.');
  if (installation && motDePasse.length < 6) erreurs.push('Définissez un mot de passe administrateur (6 caractères minimum).');
  if (!installation && motDePasse !== '' && motDePasse.length < 6) erreurs.push('Le nouveau mot de passe doit faire 6 caractères minimum.');
  if (installation && !cleSaisie) erreurs.push('Définissez la clé d’accès de la page de clôture.');

  if (erreurs.length) {
    const v = { ...valeursAffichage(ctx),
      etablissement, sites: champ('sites'), emails_alertes: champ('emails_alertes'),
      emails_bulletin: champ('emails_bulletin'), telegram_chat_ids: champ('telegram_chat_ids'),
      seuil_critique: champ('seuil_critique'), sla_relance_h: champ('sla_relance_h'),
      sla_escalade_h: champ('sla_escalade_h') };
    return reponseHtml(formulaire(ctx, mode, v, { erreur: erreurs.join(' ') }));
  }

  const valeurs = {
    etablissement,
    sites: JSON.stringify(sites),
    emails_alertes: JSON.stringify(emailsAlertes),
    emails_bulletin: JSON.stringify(emailsBulletin),
    telegram_chat_ids: JSON.stringify(chats),
    seuil_critique: String(seuil),
    sla_relance_h: String(relance),
    sla_escalade_h: String(escalade),
  };
  if (tokenSaisi) valeurs.telegram_token = tokenSaisi;         // vide = conserver
  if (cleSaisie) valeurs.closure_key = cleSaisie;              // vide = conserver
  if (motDePasse !== '') valeurs.admin_password_hash = await hacherMotDePasse(motDePasse);
  if (installation) valeurs.installe = '1';
  await enregistrerReglages(ctx, valeurs);
  await ctx.journal('', installation ? 'Installation' : 'Admin (réglages)',
    'réglages', installation ? 'Première configuration enregistrée' : 'Réglages mis à jour');
  // Le bouton Telegram « Pris en charge » exige le webhook : on
  // l'enregistre automatiquement à chaque sauvegarde des réglages.
  const noteWebhook = await activerWebhook(tokenSaisi || ctx.cfg.telegram_token, request);

  if (installation) {
    let s = pageDebut(ctx.cfg, 'Installation terminée');
    s += '<div class="recu"><h1>✅ Installation terminée</h1>'
      + '<p>Les réglages sont enregistrés dans la base du système. '
      + 'Cette page d’installation est désormais <strong>verrouillée définitivement</strong>.</p>'
      + '<p>Pour modifier les réglages plus tard : Administration → Réglages '
      + '(avec le mot de passe que vous venez de définir).</p>'
      + (noteWebhook ? `<p>${h(noteWebhook.trim())}</p>` : '')
      + '<p><a class="btn" href="/admin/login">Aller à la connexion administration</a> '
      + '<a class="btn secondaire" href="/">Ouvrir le formulaire de signalement</a></p></div>';
    s += pageFin();
    return reponseHtml(s);
  }
  // Recharger la config effective avant de réafficher.
  ctx.reglagesCharges = false;
  await chargerReglages(ctx);
  return reponseHtml(formulaire(ctx, mode, valeursAffichage(ctx),
    { message: 'Réglages enregistrés — ils sont actifs immédiatement.' + noteWebhook }));
}

/** GET/POST /installation — verrouillée dès que le système est configuré. */
export async function pageInstallation(ctx, request) {
  if (await estConfigure(ctx)) {
    return redirection('/admin/login');
  }
  if (request.method === 'POST') return traiterPost(ctx, request, 'installation');
  return reponseHtml(formulaire(ctx, 'installation', valeursAffichage(ctx)));
}

/** GET/POST /admin/reglages — derrière la session admin (vérifiée par app.js). */
export async function pageReglagesAdmin(ctx, request) {
  if (request.method === 'POST') return traiterPost(ctx, request, 'admin');
  return reponseHtml(formulaire(ctx, 'admin', valeursAffichage(ctx)));
}
