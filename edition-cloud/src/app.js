/**
 * Application — routeur unique écrit contre les standards Web
 * (Request/Response). Les deux points d'entrée (worker.js pour
 * Cloudflare, server.mjs pour Node) ne font qu'adapter la plateforme
 * puis déléguer ici : la logique servie est strictement la même.
 *
 * Routes :
 *   GET/POST  /                 formulaire public de signalement (+ reçu ?recu=)
 *   GET       /statut           suivi public (numéro + polyclinique)
 *   GET/POST  /cloture          page interne de clôture (clé d'accès)
 *   POST      /webhook          webhook Telegram (accusé + commandes)
 *   GET       /affiche          affiches A4 par site (QR à coller)
 *   GET/POST  /installation     première configuration (verrouillée ensuite)
 *   GET/POST  /admin/login      connexion administration
 *   GET       /admin/logout
 *   GET       /admin            tableau de bord (+ mode démo)
 *   GET       /admin/registre   registre filtrable + export CSV
 *   GET       /admin/rapport    bilan mensuel CLIN imprimable
 *   GET/POST  /admin/bulletin   bulletin « Vous avez signalé → … »
 *   GET       /admin/journal    journal d'audit
 *   GET/POST  /admin/reglages   réglages de l'établissement
 *   POST      /admin/demo/seed|purge
 *   GET       /cron?key=…       déclencheur externe des contrôles (Node, si UPCI_CRON_KEY)
 *   GET       /assets/style.css feuille de style embarquée
 *
 * Garde d'installation : tant que le système n'est pas configuré,
 * toute route (hors /installation et le style) redirige vers
 * /installation — la page s'affiche donc automatiquement au premier
 * lancement, dans les deux domiciles.
 */
import { h, fmt, emailValide } from './util.js';
import { pageDebut, pageFin, reponseHtml, reponseTexte, redirection, baseUrl, STYLE_CSS } from './vue.js';
import { creerSignalement, accuser, cloturer } from './metier.js';
import { tgApi } from './notify.js';
import { sessionRole, ouvrirSession, fermerSession } from './session.js';
import { estConfigure } from './settings.js';
import { pageInstallation, pageReglagesAdmin } from './reglages_page.js';
import { runPeriodicChecks } from './cron.js';
import * as admin from './admin.js';

// ---------------------------------------------------------------------
// Formulaire public de signalement (+ reçu PRG)
// ---------------------------------------------------------------------
async function pageFormulaire(ctx, request) {
  const cfg = ctx.cfg;
  const url = new URL(request.url);

  if (url.searchParams.has('recu')) {
    const sig = await ctx.parNumero(url.searchParams.get('recu'));
    let s = pageDebut(cfg, 'Signalement enregistré');
    if (sig && !sig.est_demo) {
      s += '<div class="recu"><h1>✅ Signalement enregistré</h1>'
        + '<p>Votre numéro de signalement :</p>'
        + `<div class="numero">${h(sig.numero)}</div>`
        + `<p>Polyclinique : ${h(sig.polyclinique)}<br>`
        + 'Conservez ce numéro : il vous permet de suivre l’état du traitement.</p>'
        + `<p><a class="btn" href="/statut?numero=${encodeURIComponent(sig.numero)}">Suivre mon signalement</a></p>`
        + '<p class="note">L’unité UPCI a été alertée immédiatement'
        + (sig.email_declarant ? ' ; un accusé de réception vient de vous être envoyé par email.' : '.')
        + '</p></div>';
    } else {
      s += '<div class="alerte">Numéro introuvable.</div>';
    }
    return reponseHtml(s + pageFin());
  }

  const erreurs = [];
  const val = {
    polyclinique: url.searchParams.get('site') ?? '',
    service: '', lieu: '', periode: '',
    types: [], gravite: '', action_immediate: '',
    mesures: [], delai_demande: '', email_declarant: '',
  };
  if (request.method === 'POST') {
    const fd = await request.formData();
    for (const k of ['polyclinique', 'service', 'lieu', 'periode', 'gravite', 'action_immediate', 'delai_demande', 'email_declarant']) {
      val[k] = String(fd.get(k) ?? '').trim();
    }
    val.types = fd.getAll('types').map(String).filter((t) => cfg.types_urgence.includes(t));
    val.mesures = fd.getAll('mesures').map(String).filter((m) => cfg.mesures.includes(m));

    if (!cfg.sites.includes(val.polyclinique)) erreurs.push('Choisissez la polyclinique.');
    if (!cfg.services.includes(val.service)) erreurs.push('Choisissez le service.');
    if (val.lieu !== '' && !cfg.lieux.includes(val.lieu)) erreurs.push('Lieu précis invalide.');
    if (!cfg.periodes.includes(val.periode)) erreurs.push('Choisissez la période.');
    if (!val.types.length) erreurs.push('Choisissez au moins un type d’incident.');
    const g = parseInt(val.gravite, 10);
    if (!(g >= 1 && g <= 5)) erreurs.push('Indiquez la gravité (1 à 5).');
    if (!cfg.actions_immediates.includes(val.action_immediate)) erreurs.push('Avez-vous agi immédiatement ?');
    if (!cfg.delais_souhaites.includes(val.delai_demande)) erreurs.push('Choisissez le délai souhaité.');
    if (val.email_declarant !== '' && !emailValide(val.email_declarant)) {
      erreurs.push('Email du déclarant invalide (il est facultatif).');
    }
    if (!erreurs.length) {
      const sig = await creerSignalement(ctx, val);
      return redirection(`/?recu=${encodeURIComponent(sig.numero)}`);
    }
  }

  const sel = (a, b) => (a === b ? ' selected' : '');
  const chk = (arr, v) => (arr.includes(v) ? ' checked' : '');
  let s = pageDebut(cfg, 'Signaler un incident');
  s += '<h1>Signaler un incident — الوقاية من العدوى</h1>'
    + '<p class="intro">Questions fermées uniquement, moins d’une minute. '
    + '<strong>N’indiquez jamais de nom ni de donnée de patient.</strong></p>';
  if (erreurs.length) {
    s += '<div class="alerte"><strong>À corriger :</strong><ul>';
    for (const e of erreurs) s += `<li>${h(e)}</li>`;
    s += '</ul></div>';
  }
  s += '<form method="post" class="form">';
  s += '<label>1. Polyclinique *</label><select name="polyclinique" required><option value="">— Choisir —</option>';
  for (const site of cfg.sites) s += `<option${sel(val.polyclinique, site)}>${h(site)}</option>`;
  s += '</select>';
  s += '<label>2. Service *</label><select name="service" required><option value="">— Choisir —</option>';
  for (const x of cfg.services) s += `<option${sel(val.service, x)}>${h(x)}</option>`;
  s += '</select>';
  s += '<label>3. Lieu précis</label><select name="lieu"><option value="">— Choisir (facultatif) —</option>';
  for (const x of cfg.lieux) s += `<option${sel(val.lieu, x)}>${h(x)}</option>`;
  s += '</select>';
  s += '<label>4. Période *</label><div class="choix">';
  for (const p of cfg.periodes) s += `<label class="opt"><input type="radio" name="periode" value="${h(p)}"${chk([val.periode], p)}> ${h(p)}</label>`;
  s += '</div>';
  s += '<label>5. Type d’incident * (plusieurs choix possibles)</label><div class="choix">';
  for (const t of cfg.types_urgence) s += `<label class="opt"><input type="checkbox" name="types" value="${h(t)}"${chk(val.types, t)}> ${h(t)}</label>`;
  s += '</div>';
  s += '<label>6. Gravité * (4 et 5 = critique, escalade automatique)</label><div class="choix gravite">';
  for (let i = 1; i <= 5; i++) s += `<label class="opt"><input type="radio" name="gravite" value="${i}"${chk([val.gravite], String(i))}> ${i}</label>`;
  s += '</div>';
  s += '<label>7. Avez-vous agi immédiatement ? *</label><div class="choix">';
  for (const a of cfg.actions_immediates) s += `<label class="opt"><input type="radio" name="action_immediate" value="${h(a)}"${chk([val.action_immediate], a)}> ${h(a)}</label>`;
  s += '</div>';
  s += '<label>8. Mesures prises</label><div class="choix">';
  for (const m of cfg.mesures) s += `<label class="opt"><input type="checkbox" name="mesures" value="${h(m)}"${chk(val.mesures, m)}> ${h(m)}</label>`;
  s += '</div>';
  s += '<label>9. Délai d’intervention souhaité *</label><div class="choix">';
  for (const d of cfg.delais_souhaites) s += `<label class="opt"><input type="radio" name="delai_demande" value="${h(d)}"${chk([val.delai_demande], d)}> ${h(d)}</label>`;
  s += '</div>';
  s += '<label>Votre email (facultatif) — pour recevoir l’accusé et l’avis de clôture</label>'
    + `<input type="email" name="email_declarant" value="${h(val.email_declarant)}" autocomplete="email">`;
  s += '<button class="btn gros" type="submit">📨 Envoyer le signalement</button></form>';
  s += pageFin();
  return reponseHtml(s);
}

// ---------------------------------------------------------------------
// Suivi public — numéro + polyclinique → statut et dates seulement
// ---------------------------------------------------------------------
async function pageStatut(ctx, request) {
  const cfg = ctx.cfg;
  const url = new URL(request.url);
  const numero = (url.searchParams.get('numero') ?? '').trim();
  const poly = url.searchParams.get('polyclinique') ?? '';
  let resultat = null;
  let introuvable = false;
  if (numero !== '' && poly !== '') {
    resultat = await ctx.db.first(
      'SELECT * FROM signalements WHERE numero = ? AND polyclinique = ? AND est_demo = 0',
      [numero, poly]);
    introuvable = resultat === null;
  }
  let s = pageDebut(cfg, 'Suivi d’un signalement');
  s += '<h1>Suivi de mon signalement</h1>'
    + '<p class="intro">Saisissez le numéro reçu à l’envoi <strong>et</strong> la polyclinique concernée.</p>'
    + '<form method="get" class="form">'
    + '<label>Numéro de signalement</label>'
    + `<input name="numero" value="${h(numero)}" placeholder="UPCI-2026-0001" required>`
    + '<label>Polyclinique</label><select name="polyclinique" required><option value="">— Choisir —</option>';
  for (const site of cfg.sites) s += `<option${poly === site ? ' selected' : ''}>${h(site)}</option>`;
  s += '</select><button class="btn" type="submit">Vérifier</button></form>';
  if (introuvable) {
    s += '<div class="alerte">Aucun signalement ne correspond à ce numéro et cette polyclinique. Vérifiez la saisie.</div>';
  }
  if (resultat) {
    s += `<div class="recu"><h2>État du signalement ${h(resultat.numero)}</h2><table class="ind">`
      + `<tr><th>Statut</th><td><strong>${h(resultat.statut)}</strong></td></tr>`
      + `<tr><th>Enregistré le</th><td>${fmt(resultat.date_creation)}</td></tr>`
      + `<tr><th>Pris en charge</th><td>${resultat.pris_en_charge_le ? `Oui — ${fmt(resultat.pris_en_charge_le)}` : 'Pas encore'}</td></tr>`
      + `<tr><th>Clôturé le</th><td>${resultat.date_cloture ? fmt(resultat.date_cloture) : '—'}</td></tr>`
      + '</table></div>';
  }
  s += pageFin();
  return reponseHtml(s);
}

// ---------------------------------------------------------------------
// Page INTERNE de clôture — clé d'accès (réglages), session ensuite.
// NE JAMAIS diffuser son adresse ni sa clé (pas d'affiche, pas de QR).
// ---------------------------------------------------------------------
async function pageCloture(ctx, request) {
  const cfg = ctx.cfg;
  const url = new URL(request.url);
  if (url.searchParams.has('sortir')) {
    return redirection('/cloture', { 'Set-Cookie': fermerSession(ctx, request, 'cloture') });
  }
  let sessionOuverte = !!(await sessionRole(ctx, request, 'cloture'));
  let nouvelEntete = null;
  const fd = request.method === 'POST' ? await request.formData() : null;
  const cleFournie = url.searchParams.get('cle') ?? (fd ? String(fd.get('cle') ?? '') : '');
  if (cleFournie && cfg.closure_key && cleFournie === cfg.closure_key) {
    nouvelEntete = { 'Set-Cookie': await ouvrirSession(ctx, request, 'cloture') };
    sessionOuverte = true;
  }
  const entetes = nouvelEntete ?? {};

  let s = pageDebut(cfg, 'Clôture — interne UPCI');
  if (!cfg.closure_key || cfg.closure_key === 'CHANGEZ-CETTE-CLE') {
    s += '<div class="alerte"><strong>Configuration incomplète :</strong> la clé d’accès de clôture '
      + 'n’est pas définie. Définissez-la dans <strong>Administration → Réglages</strong> '
      + '(ou via la page d’installation) pour activer cette page.</div>';
    return reponseHtml(s + pageFin(), { entetes });
  }
  if (!sessionOuverte) {
    s += '<h1>🔒 Page interne — clôture des signalements</h1>'
      + '<p class="intro">Réservée au/à la chef d’unité UPCI. Saisissez la clé d’accès interne.</p>'
      + '<form method="post" class="form"><label>Clé d’accès</label>'
      + '<input type="password" name="cle" required autocomplete="current-password">'
      + '<button class="btn" type="submit">Entrer</button></form>';
    return reponseHtml(s + pageFin(), { entetes });
  }

  let message = '';
  let erreur = '';
  let numeroPrefill = url.searchParams.get('numero') ?? '';
  if (fd && fd.has('numero')) {
    const champs = {};
    for (const k of ['numero', 'intervention', 'statut', 'delai_reel', 'action_corrective', 'verif_efficacite']) {
      champs[k] = String(fd.get(k) ?? '');
    }
    try {
      message = await cloturer(ctx, champs.numero, champs, 'Chef UPCI (page de clôture)');
      numeroPrefill = '';
    } catch (e) {
      erreur = e.message;
    }
  }
  s += '<h1>Clôture d’un signalement</h1>'
    + '<p class="intro">La clôture met à jour la ligne du signalement dans le registre. '
    + 'Pour un cas <strong>critique</strong>, renseignez l’action corrective ; la vérification '
    + 'd’efficacité peut être consignée plus tard en réutilisant ce même formulaire avec le même numéro. '
    + '<a href="/cloture?sortir=1">Verrouiller</a></p>';
  if (message) s += `<div class="ok">${h(message)}</div>`;
  if (erreur) s += `<div class="alerte">${h(erreur)}</div>`;
  s += '<form method="post" class="form">'
    + '<label>1. Numéro du signalement *</label>'
    + `<input name="numero" value="${h(numeroPrefill)}" placeholder="UPCI-2026-0001" required>`
    + '<label>2. Intervention réalisée *</label>'
    + '<textarea name="intervention" rows="3" placeholder="En une phrase factuelle : ce qui a réellement été fait."></textarea>'
    + '<label>3. Statut de clôture *</label><select name="statut" required>';
  for (const st of cfg.statuts_cloture) s += `<option>${h(st)}</option>`;
  s += '</select>'
    + '<label>4. Délai réel d’intervention</label><select name="delai_reel"><option value="">—</option>';
  for (const d of cfg.delais_reels) s += `<option>${h(d)}</option>`;
  s += '</select>'
    + '<label>5. Action corrective (cas critiques) — qu’est-ce qui a changé pour que cela ne se reproduise pas ?</label>'
    + '<textarea name="action_corrective" rows="2"></textarea>'
    + '<label>6. Vérification d’efficacité (cas critiques, peut être rempli plus tard avec le même numéro)</label>'
    + '<textarea name="verif_efficacite" rows="2" placeholder="Ex. : contrôle sur place le … — problème disparu."></textarea>'
    + '<button class="btn gros" type="submit">✔ Enregistrer la clôture</button></form>';
  s += pageFin();
  return reponseHtml(s, { entetes });
}

// ---------------------------------------------------------------------
// Webhook Telegram — bouton d'accusé + commandes /stats /critiques /aide
// ---------------------------------------------------------------------
async function pageWebhook(ctx, request) {
  const cfg = ctx.cfg;
  const ok = () => Response.json({ ok: true });
  const secret = String(cfg.telegram_webhook_secret ?? '');
  if (secret !== '') {
    const recu = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (recu !== secret) return Response.json({ ok: false }, { status: 403 });
  }
  const upd = await request.json().catch(() => null);
  if (!upd || typeof upd !== 'object') return ok();

  if (upd.callback_query) {
    const cq = upd.callback_query;
    const data = String(cq.data ?? '');
    if (data.startsWith('ack:')) {
      const numero = data.slice(4);
      const chatId = String(cq.message?.chat?.id ?? '');
      const texte = await accuser(ctx, numero, cq.from ?? {}, chatId);
      await tgApi(ctx, 'answerCallbackQuery', { callback_query_id: cq.id, text: texte });
    }
    return ok();
  }

  if (upd.message?.text) {
    const chatId = String(upd.message.chat.id ?? '');
    const texteIn = String(upd.message.text).trim();
    if ((cfg.telegram_chat_ids || []).map(String).includes(chatId)) {
      let reponse = null;
      if (texteIn === '/aide' || texteIn === '/start') {
        reponse = 'Commandes UPCI :\n/stats — synthèse du registre\n/critiques — critiques encore ouverts\nLe bouton « ✅ Pris en charge » sous chaque alerte enregistre l’accusé.';
      } else if (texteIn === '/stats') {
        const total = Number((await ctx.db.first('SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0')).n);
        const ouverts = Number((await ctx.db.first('SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND date_cloture IS NULL')).n);
        const crit = Number((await ctx.db.first('SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL')).n);
        reponse = `📊 Registre UPCI\nSignalements : ${total}\nOuverts : ${ouverts}\nCritiques ouverts : ${crit}`;
      } else if (texteIn === '/critiques') {
        const rows = await ctx.db.all(
          'SELECT numero, polyclinique, gravite, date_creation FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL ORDER BY date_creation LIMIT 15');
        reponse = rows.length
          ? ['🚨 Critiques ouverts :', ...rows.map((r) => `${r.numero} — ${r.polyclinique} — gravité ${r.gravite} — depuis le ${fmt(r.date_creation)}`)].join('\n')
          : '✅ Aucun critique ouvert.';
      }
      if (reponse !== null) await tgApi(ctx, 'sendMessage', { chat_id: chatId, text: reponse });
    }
    return ok();
  }
  return ok();
}

// ---------------------------------------------------------------------
// Affiches A4 par site — adresse pré-remplie en clair + cadre QR à coller
// ---------------------------------------------------------------------
function pageAffiche(ctx, request) {
  const cfg = ctx.cfg;
  const url = new URL(request.url);
  const base = baseUrl(ctx, request);
  const demande = url.searchParams.get('site') ?? '';
  const sites = demande !== '' && cfg.sites.includes(demande) ? [demande] : cfg.sites;
  let s = '<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">'
    + '<title>ملصقات الإبلاغ — UPCI</title>'
    + '<link rel="stylesheet" href="/assets/style.css">'
    + `<style>
  @page { size: A4; margin: 12mm; }
  .affiche { border: 4px solid #1d7a3a; border-radius: 18px; padding: 28px 20px;
             text-align: center; color: #10331c; page-break-after: always;
             font-family: "Traditional Arabic", "Amiri", serif; margin-bottom: 24px; }
  .affiche h1 { font-size: 32px; margin: 4px 0; color: #1d7a3a; }
  .affiche h2 { font-size: 20px; margin: 2px 0 6px; font-weight: normal; }
  .affiche .site { font-size: 26px; font-weight: bold; margin: 8px 0; }
  .qr { width: 280px; height: 280px; border: 2px dashed #999; margin: 14px auto;
        display: flex; align-items: center; justify-content: center; color: #888; font-size: 17px; padding: 10px; }
  .url { direction: ltr; unicode-bidi: embed; font-family: monospace; font-size: 14px;
         background: #f2f2f2; border-radius: 8px; padding: 8px; word-break: break-all; }
  .affiche ol { font-size: 21px; text-align: right; margin: 16px 40px; line-height: 1.9; }
  .promesse { background: #e7f4ea; border-radius: 12px; padding: 12px; font-size: 19px; margin-top: 10px; }
  .pied-a { margin-top: 14px; font-size: 15px; color: #555; }
  @media print { .no-print { display: none; } .affiche { margin: 0; } }
</style>\n</head>\n<body>\n`
    + '<p class="no-print" style="text-align:center">'
    + 'تعليمات: لكل عيادة، ولّدوا رمز QR للعنوان الظاهر تحت الإطار (بأي مولّد QR)، '
    + 'اطبعوه والصقوه داخل الإطار المقطّع، ثم اطبعوا الملصق وعلّقوه. '
    + '<button onclick="window.print()">🖨 طباعة الكل</button></p>';
  for (const site of sites) {
    const urlSite = `${base}/?site=${encodeURIComponent(site)}`;
    s += `<div class="affiche">
  <h1>لاحظتَ مشكلة تخصّ النظافة أو التعقيم أو السلامة؟</h1>
  <h2>بلّغ عنها في أقل من دقيقة — وحدة الوقاية من العدوى ومكافحتها (UPCI)</h2>
  <div class="site">${h(site)}</div>
  <div class="qr">ضع هنا رمز QR<br>الخاص بهذه العيادة</div>
  <div class="url">${h(urlSite)}</div>
  <ol>
    <li>امسح الرمز بكاميرا هاتفك.</li>
    <li>أجب عن الأسئلة القصيرة (دون اسم أي مريض).</li>
    <li>أرسل — يصل التنبيه فورًا إلى مسؤولة الوحدة.</li>
  </ol>
  <div class="promesse">
    سيصلك بريد برقم بلاغك إن تركت بريدك، وبريد آخر عندما يُعالج ويُغلق.<br>
    ولمتابعة الحالة في أي وقت: افتح «Suivi» من نفس العنوان برقم بلاغك واسم العيادة.
  </div>
  <p class="pied-a">نظام الإنذار الرقمي UPCI — ${h(cfg.etablissement)}<br>
  أمثلة: نفاد الصابون أو المعقّم، عطل معقّمة، وخز إبرة، خطأ في فرز النفايات، رزمة غير معقّمة…</p>
</div>`;
  }
  s += '</body>\n</html>';
  return reponseHtml(s);
}

// ---------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------
export function creerGestionnaire(ctx) {
  return async function handle(request) {
    const url = new URL(request.url);
    const chemin = url.pathname.replace(/\/+$/, '') || '/';
    try {
      // Style embarqué : toujours accessible (page d'installation comprise).
      if (chemin === '/assets/style.css') {
        return new Response(STYLE_CSS, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
      }
      // Installation : accessible tant que non configurée, verrouillée ensuite.
      if (chemin === '/installation') return await pageInstallation(ctx, request);
      // Garde globale : système non configuré → tout mène à l'installation.
      if (!(await estConfigure(ctx))) return redirection('/installation');

      switch (chemin) {
        case '/': return await pageFormulaire(ctx, request);
        case '/statut': return await pageStatut(ctx, request);
        case '/cloture': return await pageCloture(ctx, request);
        case '/affiche': return pageAffiche(ctx, request);
        case '/webhook':
          if (request.method !== 'POST') return reponseTexte('Méthode non autorisée', { statut: 405 });
          return await pageWebhook(ctx, request);
        case '/cron': {
          if (!ctx.cfg.cron_key) return reponseTexte('Non activé', { statut: 404 });
          if (url.searchParams.get('key') !== ctx.cfg.cron_key) {
            return reponseTexte('Clé invalide', { statut: 403 });
          }
          const lignes = await runPeriodicChecks(ctx, {});
          return reponseTexte(lignes.join('\n'));
        }
        case '/admin/login': return await admin.pageLogin(ctx, request);
        case '/admin/logout': return await admin.pageLogout(ctx, request);
        case '/admin': case '/admin/registre': case '/admin/rapport':
        case '/admin/bulletin': case '/admin/journal': case '/admin/reglages': {
          if (!(await admin.estAdmin(ctx, request))) return redirection('/admin/login');
          if (chemin === '/admin') return await admin.pageTableauBord(ctx, request);
          if (chemin === '/admin/registre') return await admin.pageRegistre(ctx, request);
          if (chemin === '/admin/rapport') return await admin.pageRapport(ctx, request);
          if (chemin === '/admin/bulletin') return await admin.pageBulletin(ctx, request);
          if (chemin === '/admin/journal') return await admin.pageJournal(ctx, request);
          return await pageReglagesAdmin(ctx, request);
        }
        case '/admin/demo/seed': case '/admin/demo/purge': {
          if (request.method !== 'POST') return reponseTexte('Méthode non autorisée', { statut: 405 });
          if (!(await admin.estAdmin(ctx, request))) return redirection('/admin/login');
          return await admin.actionDemo(ctx, request, chemin.endsWith('seed') ? 'seed' : 'purge');
        }
        default:
          return reponseTexte('Page introuvable', { statut: 404 });
      }
    } catch (e) {
      console.error('UPCI erreur requête :', e);
      return reponseTexte('Erreur interne du système UPCI. L’incident est journalisé côté serveur.', { statut: 500 });
    }
  };
}
