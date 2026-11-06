/**
 * Zone d'administration — connexion (mot de passe unique, empreinte
 * PBKDF2 en base/env), tableau de bord, registre filtrable + export
 * CSV (modèle 23 colonnes), bilan CLIN imprimable, bulletin, journal
 * d'audit, réglages (reglages_page.js) et mode démo (boutons protégés,
 * voie d'administration du seed/purge sous Workers).
 * Miroir des pages admin/*.php de l'édition PHP.
 */
import { h, fmt, jsonTableau, verifierMotDePasse, moisNom, epochVersLocal } from './util.js';
import { pageDebut, pageFin, reponseHtml, redirection } from './vue.js';
import { sessionRole, ouvrirSession, fermerSession } from './session.js';
import { bilan, bilanHtml, bilanTexte, bulletin, bulletinHtml, bulletinTexte } from './rapports.js';
import { envoyerMail } from './notify.js';
import { pageReglagesAdmin } from './reglages_page.js';
import { semerDemo, purgerDemo } from './seed.js';

export const estAdmin = (ctx, request) => sessionRole(ctx, request, 'admin');

function adminDebut(ctx, titre) {
  return pageDebut(ctx.cfg, titre, '../')
    + '<nav class="admin-nav">'
    + '<a href="/admin">Tableau de bord</a>'
    + '<a href="/admin/registre">Registre</a>'
    + '<a href="/admin/rapport">Bilan CLIN</a>'
    + '<a href="/admin/bulletin">Bulletin</a>'
    + '<a href="/admin/journal">Journal</a>'
    + '<a href="/admin/reglages">Réglages</a>'
    + '<a href="/cloture" target="_blank">Page de clôture</a>'
    + '<a href="/admin/logout">Déconnexion</a>'
    + '</nav>';
}

/** GET/POST /admin/login */
export async function pageLogin(ctx, request) {
  if (await estAdmin(ctx, request)) return redirection('/admin');
  const cfg = ctx.cfg;
  let erreur = '';
  if (request.method === 'POST') {
    const fd = await request.formData();
    const hash = String(cfg.admin_password_hash ?? '');
    if (hash !== '' && await verifierMotDePasse(String(fd.get('motdepasse') ?? ''), hash)) {
      const cookie = await ouvrirSession(ctx, request, 'admin');
      return redirection('/admin', { 'Set-Cookie': cookie });
    }
    await new Promise((r) => setTimeout(r, 1000)); // ralentit la force brute
    erreur = 'Mot de passe incorrect.';
  }
  let s = pageDebut(cfg, 'Administration — connexion', '../');
  s += '<h1>🔒 Administration UPCI</h1>';
  if (!cfg.admin_password_hash) {
    s += '<div class="alerte"><strong>Zone admin non activée :</strong> aucun mot de passe '
      + 'administrateur n’est défini. Passez par la page <a href="/installation">/installation</a> '
      + 'si le système n’est pas encore configuré, ou générez une empreinte PBKDF2 '
      + '(<code>node cli/hash.mjs</code> sous Node) pour la variable <code>UPCI_ADMIN_HASH</code>.</div>';
  } else {
    if (erreur) s += `<div class="alerte">${h(erreur)}</div>`;
    s += '<form method="post" class="form"><label>Mot de passe administrateur</label>'
      + '<input type="password" name="motdepasse" required autocomplete="current-password">'
      + '<button class="btn" type="submit">Entrer</button></form>';
  }
  s += pageFin();
  return reponseHtml(s);
}

/** GET /admin/logout */
export async function pageLogout(ctx, request) {
  return redirection('/admin/login', { 'Set-Cookie': fermerSession(ctx, request, 'admin') });
}

/** GET /admin — tableau de bord. */
export async function pageTableauBord(ctx, request) {
  const cfg = ctx.cfg;
  const db = ctx.db;
  const compte = async (sql, params = []) => Number((await db.first(sql, params)).n);
  const total = await compte('SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0');
  const ouverts = await compte('SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND date_cloture IS NULL');
  const critOuv = await compte('SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL');
  const moisDebut = `${ctx.now().slice(0, 7)}-01 00:00:00`;
  const moisTotal = await compte('SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND date_creation >= ?', [moisDebut]);
  const moisClos = await compte('SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND date_cloture >= ?', [moisDebut]);

  let s = adminDebut(ctx, 'Tableau de bord');
  s += '<h1>Tableau de bord</h1><div class="cartes">'
    + `<div class="carte"><span>${total}</span>Signalements (total)</div>`
    + `<div class="carte"><span>${ouverts}</span>Ouverts</div>`
    + `<div class="carte rouge"><span>${critOuv}</span>Critiques ouverts</div>`
    + `<div class="carte"><span>${moisTotal}</span>Ce mois-ci</div>`
    + `<div class="carte vert"><span>${moisClos}</span>Clôtures ce mois-ci</div>`
    + '</div>';

  const repartition = (titre, tab) => {
    let r = `<div class="bloc"><h2>${h(titre)}</h2><table class="ind">`;
    for (const [k, n] of Object.entries(tab)) r += `<tr><td>${h(k)}</td><td>${n}</td></tr>`;
    return r + '</table></div>';
  };
  const parSite = {};
  for (const r of await db.all('SELECT polyclinique, COUNT(*) AS n FROM signalements WHERE est_demo = 0 GROUP BY polyclinique ORDER BY n DESC')) {
    parSite[r.polyclinique] = Number(r.n);
  }
  const parGrav = {};
  for (const r of await db.all('SELECT gravite, COUNT(*) AS n FROM signalements WHERE est_demo = 0 GROUP BY gravite ORDER BY gravite')) {
    parGrav[`Gravité ${r.gravite}`] = Number(r.n);
  }
  const parType = {};
  for (const r of await db.all('SELECT types FROM signalements WHERE est_demo = 0')) {
    for (const t of jsonTableau(r.types)) parType[t] = (parType[t] ?? 0) + 1;
  }
  const parTypeTrie = Object.fromEntries(Object.entries(parType).sort((a, z) => z[1] - a[1]));

  s += '<div class="grille">'
    + repartition('Par polyclinique', parSite)
    + repartition('Par type d’incident', parTypeTrie)
    + repartition('Par gravité', parGrav)
    + '</div>';

  // Dossiers en retard : critiques ouverts + tout ouvert depuis plus de 24 h.
  const limite24Str = epochVersLocal(Date.now() - 24 * 3600000, cfg.timezone);
  const retard = await db.all(
    `SELECT * FROM signalements WHERE est_demo = 0 AND date_cloture IS NULL
     AND (est_critique = 1 OR date_creation < ?) ORDER BY est_critique DESC, date_creation`,
    [limite24Str]);
  s += '<div class="bloc"><h2>⏰ Dossiers en retard (critiques ouverts et ouverts &gt; 24 h)</h2>';
  if (!retard.length) {
    s += '<p>✅ Aucun dossier en retard.</p>';
  } else {
    s += '<table class="reg"><tr><th>Numéro</th><th>Depuis</th><th>Polyclinique</th><th>Service</th><th>Grav.</th><th>Statut</th><th>Accusé</th><th></th></tr>';
    for (const r of retard) {
      const age = Math.round(ctx.ageHeures(r.date_creation) * 10) / 10;
      s += `<tr${r.est_critique ? ' class="crit"' : ''}>`
        + `<td>${h(r.numero)}</td><td>${age} h</td>`
        + `<td>${h(r.polyclinique)}</td><td>${h(r.service)}</td>`
        + `<td>${r.gravite}</td><td>${h(r.statut)}</td>`
        + `<td>${r.pris_en_charge_le ? '✅' : '—'}</td>`
        + `<td><a href="/cloture?numero=${encodeURIComponent(r.numero)}" target="_blank">Clôturer</a></td></tr>`;
    }
    s += '</table>';
  }
  s += '</div>';

  // Mode démo — génération/retrait protégés (voie Workers ; sous Node, les CLI équivalent).
  const url = new URL(request.url);
  const msg = url.searchParams.get('msg');
  if (msg) s += `<div class="ok">${h(msg)}</div>`;
  s += '<div class="bloc"><h2>🎭 Mode démo</h2>'
    + '<p>Génère 8 signalements « DÉMO » (formation, démonstration aux responsables) — '
    + 'aucune notification réelle, exclus des indicateurs. Retrait propre en un clic.</p>'
    + '<form method="post" action="/admin/demo/seed" style="display:inline">'
    + '<button class="btn secondaire" type="submit">Générer la démo</button></form> '
    + '<form method="post" action="/admin/demo/purge" style="display:inline">'
    + '<button class="btn secondaire" type="submit">Retirer la démo</button></form></div>';

  s += pageFin();
  return reponseHtml(s);
}

/** POST /admin/demo/seed et /admin/demo/purge */
export async function actionDemo(ctx, request, quoi) {
  if (quoi === 'seed') {
    const numeros = await semerDemo(ctx);
    await ctx.journal('', 'Admin (démo)', 'démo', `Génération via la zone admin : ${numeros.length} signalements`);
    return redirection(`/admin?msg=${encodeURIComponent(`Démo générée : ${numeros.join(', ')}`)}`);
  }
  const n = await purgerDemo(ctx);
  return redirection(`/admin?msg=${encodeURIComponent(`Mode démo retiré : ${n} signalement(s) supprimé(s).`)}`);
}

const CSV_ENTETES = ['Date', 'Numéro', 'Type', 'Polyclinique', 'Service', 'Gravité', 'Délai demandé',
  'Mesures', 'Statut', 'Intervention', 'Délai réel', 'Date clôture', 'Durée (h)', 'Relance 1h',
  'Escalade 4h', 'Email déclarant', 'Action corrective', 'Vérification d’efficacité',
  'Pris en charge le', 'Accusé par', 'Relance accusé', 'Msg Telegram', 'Relance vérification'];

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** GET /admin/registre (+ ?export=csv) */
export async function pageRegistre(ctx, request) {
  const cfg = ctx.cfg;
  const db = ctx.db;
  const url = new URL(request.url);
  const fSite = url.searchParams.get('site') ?? '';
  const fStatut = url.searchParams.get('statut') ?? '';
  const fGrav = parseInt(url.searchParams.get('gravite_min') ?? '0', 10) || 0;
  const fRech = (url.searchParams.get('q') ?? '').trim();

  const where = [];
  const args = [];
  if (fSite !== '') { where.push('polyclinique = ?'); args.push(fSite); }
  if (fStatut === 'ouvert') where.push('date_cloture IS NULL');
  if (fStatut === 'cloture') where.push('date_cloture IS NOT NULL');
  if (fStatut === 'critique') where.push('est_critique = 1');
  if (fStatut === 'demo') where.push('est_demo = 1');
  if (fStatut === 'reel') where.push('est_demo = 0');
  if (fGrav > 0) { where.push('gravite >= ?'); args.push(fGrav); }
  if (fRech !== '') { where.push('numero LIKE ?'); args.push(`%${fRech}%`); }
  const sqlWhere = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  if (url.searchParams.has('export')) {
    const lignes = await db.all(`SELECT * FROM signalements${sqlWhere} ORDER BY date_creation`, args);
    const sortie = [CSV_ENTETES.join(';')];
    for (const r of lignes) {
      sortie.push([
        r.date_creation, r.numero, jsonTableau(r.types).join(' ; '),
        r.polyclinique, r.service, r.gravite, r.delai_demande,
        jsonTableau(r.mesures).join(' ; '), r.statut, r.intervention, r.delai_reel,
        r.date_cloture ?? '', r.duree_h ?? '', r.relance_1h_le ?? '', r.escalade_4h_le ?? '',
        r.email_declarant, r.action_corrective, r.verif_efficacite,
        r.pris_en_charge_le ?? '', r.accuse_par, r.relance_accuse_le ?? '',
        r.telegram_msgs, r.relance_verif_le ?? '',
      ].map(csvCell).join(';'));
    }
    const nom = `registre-upci-${ctx.now().slice(0, 10).replaceAll('-', '')}.csv`;
    return new Response('﻿' + sortie.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=UTF-8',
        'Content-Disposition': `attachment; filename="${nom}"`,
      },
    });
  }

  const lignes = await db.all(
    `SELECT * FROM signalements${sqlWhere} ORDER BY date_creation DESC LIMIT 500`, args);
  let s = adminDebut(ctx, 'Registre');
  s += '<h1>Registre des signalements</h1>'
    + '<form method="get" class="filtres">'
    + '<select name="site"><option value="">Tous les sites</option>';
  for (const site of cfg.sites) s += `<option${fSite === site ? ' selected' : ''}>${h(site)}</option>`;
  s += '</select><select name="statut">'
    + `<option value=""${fStatut === '' ? ' selected' : ''}>Tous les statuts</option>`
    + `<option value="ouvert"${fStatut === 'ouvert' ? ' selected' : ''}>Ouverts</option>`
    + `<option value="cloture"${fStatut === 'cloture' ? ' selected' : ''}>Clôturés</option>`
    + `<option value="critique"${fStatut === 'critique' ? ' selected' : ''}>Critiques</option>`
    + `<option value="reel"${fStatut === 'reel' ? ' selected' : ''}>Réels (hors démo)</option>`
    + `<option value="demo"${fStatut === 'demo' ? ' selected' : ''}>Démo uniquement</option>`
    + '</select>'
    + `<input type="text" name="q" value="${h(fRech)}" placeholder="N° (ex. UPCI-2026-…)">`
    + '<button class="btn" type="submit">Filtrer</button> '
    + `<a class="btn secondaire" href="/admin/registre?${h(new URLSearchParams({ ...Object.fromEntries(url.searchParams), export: 'csv' }).toString())}">⬇ Export CSV</a>`
    + '</form>'
    + '<table class="reg"><tr><th>Date</th><th>Numéro</th><th>Polyclinique</th><th>Service</th><th>Grav.</th><th>Statut</th><th>Accusé</th><th>Clôture</th></tr>';
  for (const r of lignes) {
    s += `<tr${r.est_critique ? ' class="crit"' : ''}>`
      + `<td>${fmt(r.date_creation)}</td><td>${h(r.numero)}</td>`
      + `<td>${h(r.polyclinique)}</td><td>${h(r.service)}</td><td>${r.gravite}</td>`
      + `<td>${h(r.statut)}</td><td>${r.pris_en_charge_le ? '✅' : '—'}</td>`
      + `<td>${r.date_cloture ? fmt(r.date_cloture) : '—'}</td></tr>`;
  }
  s += `</table><p>${lignes.length} ligne(s) (max 500, les plus récentes d’abord).</p>`;
  s += pageFin();
  return reponseHtml(s);
}

/** Mois/année choisis (défaut : mois écoulé), bornés comme l'édition PHP. */
function moisChoisi(ctx, url) {
  const { annee, mois } = ctx.partiesNow();
  const defMois = mois === 1 ? 12 : mois - 1;
  const defAnnee = mois === 1 ? annee - 1 : annee;
  let m = parseInt(url.searchParams.get('mois') ?? '', 10);
  let a = parseInt(url.searchParams.get('annee') ?? '', 10);
  if (!m || m < 1 || m > 12) m = defMois;
  if (!a || a < 2024 || a > 2100) a = defAnnee;
  return { annee: a, mois: m };
}

function selecteurMois(annee, mois, bouton) {
  let s = '<form method="get" class="filtres"><label>Mois</label><select name="mois">';
  for (let m = 1; m <= 12; m++) s += `<option value="${m}"${m === mois ? ' selected' : ''}>${m}</option>`;
  s += `</select><label>Année</label><input type="number" name="annee" value="${annee}" style="width:90px">`
    + `<button class="btn" type="submit">${bouton}</button></form>`;
  return s;
}

/** GET /admin/rapport — bilan CLIN imprimable + version texte. */
export async function pageRapport(ctx, request) {
  const url = new URL(request.url);
  const { annee, mois } = moisChoisi(ctx, url);
  const b = await bilan(ctx, annee, mois);
  let s = adminDebut(ctx, 'Bilan mensuel CLIN');
  s += '<h1>Bilan mensuel CLIN</h1>'
    + selecteurMois(annee, mois, 'Afficher').replace('</form>',
      ' <button class="btn secondaire" type="button" onclick="window.print()">🖨 Imprimer</button></form>')
    + `<div class="document">${bilanHtml(b, ctx.cfg)}</div>`
    + '<h3>Version texte (pour email / copier-coller)</h3>'
    + `<pre class="texte">${h(bilanTexte(b, ctx.cfg))}</pre>`;
  s += pageFin();
  return reponseHtml(s);
}

/** GET/POST /admin/bulletin — génération + envoi courriel. */
export async function pageBulletin(ctx, request) {
  const url = new URL(request.url);
  let message = '';
  let anneeMois;
  if (request.method === 'POST') {
    const fd = await request.formData();
    const a = parseInt(fd.get('annee') ?? '', 10);
    const m = parseInt(fd.get('mois') ?? '', 10);
    anneeMois = { annee: a >= 2024 && a <= 2100 ? a : ctx.partiesNow().annee, mois: m >= 1 && m <= 12 ? m : 1 };
    const bul = await bulletin(ctx, anneeMois.annee, anneeMois.mois);
    const dest = ctx.cfg.emails_bulletin?.length ? ctx.cfg.emails_bulletin : ctx.cfg.emails_alertes;
    if (bul.nb_fermes === 0 && !bul.changements.length) {
      message = 'Bulletin vide (aucune clôture ce mois-là) — envoi annulé.';
      await ctx.journal('', 'Admin (bulletin)', 'bulletin', `Envoi ignoré : mois vide ${anneeMois.mois}/${anneeMois.annee}`);
    } else {
      let n = 0;
      for (const email of dest) {
        if (await envoyerMail(ctx, email,
          `Bulletin UPCI — Vous avez signalé → nous avons changé (${moisNom(anneeMois.annee, anneeMois.mois)})`,
          bulletinTexte(bul, ctx.cfg))) n++;
      }
      await ctx.journal('', 'Admin (bulletin)', 'bulletin',
        `Envoyé à ${n} destinataire(s) pour ${moisNom(anneeMois.annee, anneeMois.mois)}`);
      message = `Bulletin envoyé à ${n} destinataire(s) (${dest.join(', ')}).`
        + (n === 0 ? ' ⚠️ Aucun envoi n’a abouti : vérifiez le service d’email configuré (UPCI_MAIL_API_URL).' : '');
    }
  } else {
    anneeMois = moisChoisi(ctx, url);
  }
  const bul = await bulletin(ctx, anneeMois.annee, anneeMois.mois);
  let s = adminDebut(ctx, 'Bulletin mensuel');
  s += '<h1>Bulletin « Vous avez signalé → nous avons changé »</h1>'
    + '<p class="intro">Construit automatiquement des clôtures du mois choisi. Objectif : prouver aux déclarants que signaler fait changer les choses.</p>'
    + selecteurMois(anneeMois.annee, anneeMois.mois, 'Générer');
  if (message) s += `<div class="ok">${h(message)}</div>`;
  s += `<div class="document">${bulletinHtml(bul, ctx.cfg)}</div>`
    + `<form method="post"><input type="hidden" name="mois" value="${anneeMois.mois}">`
    + `<input type="hidden" name="annee" value="${anneeMois.annee}">`
    + '<button class="btn" type="submit" name="envoyer" value="1">✉️ Envoyer le bulletin par email</button></form>';
  s += pageFin();
  return reponseHtml(s);
}

/** GET /admin/journal — journal d'audit filtrable. */
export async function pageJournal(ctx, request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') ?? '';
  const lignes = action
    ? await ctx.db.all('SELECT * FROM journal WHERE action = ? ORDER BY id DESC LIMIT 300', [action])
    : await ctx.db.all('SELECT * FROM journal ORDER BY id DESC LIMIT 300');
  const actions = await ctx.db.all('SELECT DISTINCT action FROM journal ORDER BY action');
  let s = adminDebut(ctx, 'Journal d’audit');
  s += '<h1>Journal d’audit</h1>'
    + '<p class="intro">Historique en ajout seul (rien ne s’y modifie ni ne s’y efface) : création, accusé, relance, escalade, clôture, vérification, réouverture, regroupement, silence, santé, bulletin, démo, réglages.</p>'
    + '<form method="get" class="filtres"><select name="action"><option value="">Toutes les actions</option>';
  for (const a of actions) s += `<option${action === a.action ? ' selected' : ''}>${h(a.action)}</option>`;
  s += '</select><button class="btn" type="submit">Filtrer</button></form>'
    + '<table class="reg"><tr><th>Horodatage</th><th>Numéro</th><th>Acteur</th><th>Action</th><th>Détail</th></tr>';
  for (const r of lignes) {
    s += `<tr><td>${fmt(r.horodatage)}</td><td>${h(r.numero)}</td>`
      + `<td>${h(r.acteur)}</td><td>${h(r.action)}</td><td>${h(r.detail)}</td></tr>`;
  }
  s += `</table><p>${lignes.length} ligne(s) (max 300, les plus récentes d’abord).</p>`;
  s += pageFin();
  return reponseHtml(s);
}

/** GET/POST /admin/reglages (session vérifiée par l'appelant). */
export { pageReglagesAdmin };
