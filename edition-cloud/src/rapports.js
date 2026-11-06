/**
 * Rapports — bilan mensuel CLIN et bulletin « Vous avez signalé → nous
 * avons changé ». Indicateurs alignés sur docs/06 de l'édition publiée.
 * Les lignes DÉMO sont exclues de tous les chiffres officiels.
 * (Miroir de lib/rapports.php de l'édition PHP.)
 */
import { h, jsonTableau, moisNom, epochVersLocal } from './util.js';

const debutMois = (annee, mois) => `${annee}-${String(mois).padStart(2, '0')}-01 00:00:00`;
function finMois(annee, mois) {
  const d = new Date(Date.UTC(annee, mois, 1)); // mois = mois suivant (base 1 → +1 en base 0)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01 00:00:00`;
}

/** Toutes les lignes réelles (hors démo) créées dans un mois donné. */
export async function lignesMois(ctx, annee, mois) {
  return ctx.db.all(
    'SELECT * FROM signalements WHERE est_demo = 0 AND date_creation >= ? AND date_creation < ? ORDER BY date_creation',
    [debutMois(annee, mois), finMois(annee, mois)]);
}

/** Sites sans aucun signalement réel depuis N semaines (hors exemptés). */
export async function sitesSilencieux(ctx) {
  const cfg = ctx.cfg;
  const limite = epochVersLocal(
    Date.now() - Number(cfg.silence_semaines) * 7 * 86400000, cfg.timezone);
  const exempts = cfg.sites_exempts ?? [];
  const silencieux = [];
  for (const site of cfg.sites ?? []) {
    if (exempts.includes(site)) continue;
    const r = await ctx.db.first(
      'SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND polyclinique = ? AND date_creation >= ?',
      [site, limite]);
    if (Number(r.n) === 0) silencieux.push(site);
  }
  return silencieux;
}

/** Calcule les indicateurs CLIN du mois (cohorte = signalements créés ce mois-là). */
export async function bilan(ctx, annee, mois) {
  const cfg = ctx.cfg;
  const lignes = await lignesMois(ctx, annee, mois);
  const seuil = Number(cfg.seuil_critique);
  const b = {
    annee, mois, lignes,
    total: lignes.length, critiques: 0, clotures: 0,
    pct_critiques: 0, pct_cloture: 0,
    duree_moy_h: null, par_site: {}, par_type: {}, par_gravite: {},
    accuses: 0, taux_accuse: null, delai_accuse_moy_h: null,
    critiques_ouverts: 0,
    boucle_total: 0, boucle_complets: 0, boucle_pct: null,
    verif_dus: 0, verif_faits: 0, verif_pct: null,
    regroupements: 0, sites_silencieux: [],
  };
  let sommeDurees = 0, nbDurees = 0, sommeAccuse = 0, nbAccuse = 0;
  const maintenant = Date.now();
  for (const l of lignes) {
    if (Number(l.gravite) >= seuil) b.critiques++;
    if (l.date_cloture) {
      b.clotures++;
      if (l.duree_h !== null) { sommeDurees += Number(l.duree_h); nbDurees++; }
    }
    b.par_site[l.polyclinique] = (b.par_site[l.polyclinique] ?? 0) + 1;
    for (const t of jsonTableau(l.types)) b.par_type[t] = (b.par_type[t] ?? 0) + 1;
    const g = Number(l.gravite);
    b.par_gravite[g] = (b.par_gravite[g] ?? 0) + 1;
    if (l.pris_en_charge_le) {
      b.accuses++;
      sommeAccuse += (ctx.versEpoch(l.pris_en_charge_le) - ctx.versEpoch(l.date_creation)) / 3600000;
      nbAccuse++;
    }
    if (Number(l.gravite) >= seuil && l.date_cloture) {
      b.boucle_total++;
      if (l.action_corrective !== '' && l.verif_efficacite !== '') b.boucle_complets++;
      if (ctx.versEpoch(l.date_cloture) <= maintenant - Number(cfg.verif_efficacite_jours) * 86400000) {
        b.verif_dus++;
        if (l.verif_efficacite !== '') b.verif_faits++;
      }
    }
  }
  if (b.total > 0) {
    b.pct_critiques = Math.round(1000 * b.critiques / b.total) / 10;
    b.pct_cloture = Math.round(1000 * b.clotures / b.total) / 10;
    b.taux_accuse = Math.round(1000 * b.accuses / b.total) / 10;
  }
  if (nbDurees) b.duree_moy_h = Math.round(100 * sommeDurees / nbDurees) / 100;
  if (nbAccuse) b.delai_accuse_moy_h = Math.round(100 * sommeAccuse / nbAccuse) / 100;
  if (b.boucle_total) b.boucle_pct = Math.round(1000 * b.boucle_complets / b.boucle_total) / 10;
  if (b.verif_dus) b.verif_pct = Math.round(1000 * b.verif_faits / b.verif_dus) / 10;
  b.par_site = Object.fromEntries(Object.entries(b.par_site).sort((a, z) => z[1] - a[1]));
  b.par_type = Object.fromEntries(Object.entries(b.par_type).sort((a, z) => z[1] - a[1]));
  b.par_gravite = Object.fromEntries(Object.entries(b.par_gravite).sort((a, z) => Number(a[0]) - Number(z[0])));

  const r = await ctx.db.first(
    'SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL');
  b.critiques_ouverts = Number(r.n);
  const j = await ctx.db.first(
    "SELECT COUNT(*) AS n FROM journal WHERE action = 'regroupement' AND horodatage >= ? AND horodatage < ?",
    [debutMois(annee, mois), finMois(annee, mois)]);
  b.regroupements = Number(j.n);
  b.sites_silencieux = await sitesSilencieux(ctx);
  return b;
}

/** Rendu texte du bilan (courriel / console). */
export function bilanTexte(b, cfg) {
  const l = [];
  l.push(`BILAN MENSUEL CLIN — ${moisNom(b.annee, b.mois)}`);
  l.push(`${cfg.etablissement} (${cfg.wilaya})`);
  l.push('-'.repeat(55));
  l.push(`Signalements du mois : ${b.total}`);
  l.push(`Critiques (gravité ≥ ${cfg.seuil_critique}) : ${b.critiques} (${b.pct_critiques} %)`);
  l.push(`Clôturés : ${b.clotures} (${b.pct_cloture} %)`);
  l.push(`Délai moyen de clôture : ${b.duree_moy_h === null ? '—' : `${b.duree_moy_h} h`}`);
  l.push(`Critiques encore ouverts : ${b.critiques_ouverts}`);
  l.push(`Taux d’accusé (bouton Telegram) : ${b.taux_accuse === null ? '—' : `${b.taux_accuse} %`}`
    + ` — délai moyen d’accusé : ${b.delai_accuse_moy_h === null ? '—' : `${b.delai_accuse_moy_h} h`}`);
  l.push(`Boucle d’apprentissage (critiques clôturés complets) : ${b.boucle_pct === null ? '—' : `${b.boucle_pct} %`}`);
  l.push(`Vérifications d’efficacité dues / faites : ${b.verif_dus} / ${b.verif_faits}`);
  l.push(`Regroupements suspectés : ${b.regroupements}`);
  if (Object.keys(b.par_site).length) {
    l.push('', 'Par polyclinique :');
    for (const [s, n] of Object.entries(b.par_site)) l.push(`  - ${s} : ${n}`);
  }
  if (Object.keys(b.par_type).length) {
    l.push('', 'Par type d’incident :');
    for (const [t, n] of Object.entries(b.par_type)) l.push(`  - ${t} : ${n}`);
  }
  if (b.sites_silencieux.length) {
    l.push('', `Sites silencieux (≥ ${cfg.silence_semaines} semaines sans signalement) : ${b.sites_silencieux.join(', ')}`);
  }
  return l.join('\n');
}

/** Rendu HTML imprimable du bilan. */
export function bilanHtml(b, cfg) {
  const rows = (tab) => {
    const e = Object.entries(tab);
    return e.length
      ? e.map(([k, n]) => `<tr><td>${h(k)}</td><td>${n}</td></tr>`).join('')
      : '<tr><td colspan="2">—</td></tr>';
  };
  const f = (v, u = '') => (v === null ? '—' : `${v}${u}`);
  return `<h2>Bilan mensuel CLIN — ${h(moisNom(b.annee, b.mois))}</h2>`
    + `<p>${h(cfg.etablissement)} — ${h(cfg.wilaya)}</p>`
    + '<table class="ind">'
    + `<tr><th>Signalements du mois</th><td>${b.total}</td></tr>`
    + `<tr><th>Critiques (gravité ≥ ${cfg.seuil_critique})</th><td>${b.critiques} (${b.pct_critiques} %)</td></tr>`
    + `<tr><th>Clôturés</th><td>${b.clotures} (${b.pct_cloture} %)</td></tr>`
    + `<tr><th>Délai moyen de clôture</th><td>${f(b.duree_moy_h, ' h')}</td></tr>`
    + `<tr><th>Critiques encore ouverts</th><td>${b.critiques_ouverts}</td></tr>`
    + `<tr><th>Taux d’accusé Telegram</th><td>${f(b.taux_accuse, ' %')}</td></tr>`
    + `<tr><th>Délai moyen d’accusé</th><td>${f(b.delai_accuse_moy_h, ' h')}</td></tr>`
    + `<tr><th>Boucle d’apprentissage complète</th><td>${f(b.boucle_pct, ' %')}</td></tr>`
    + `<tr><th>Vérifications d’efficacité (faites / dues)</th><td>${b.verif_faits} / ${b.verif_dus}</td></tr>`
    + `<tr><th>Regroupements suspectés</th><td>${b.regroupements}</td></tr>`
    + '</table>'
    + `<h3>Par polyclinique</h3><table class="ind">${rows(b.par_site)}</table>`
    + `<h3>Par type d’incident</h3><table class="ind">${rows(b.par_type)}</table>`
    + (b.sites_silencieux.length ? `<h3>Sites silencieux</h3><p>${h(b.sites_silencieux.join(', '))}</p>` : '');
}

/** Bulletin « Vous avez signalé → nous avons changé » construit des clôtures du mois. */
export async function bulletin(ctx, annee, mois) {
  const fermes = await ctx.db.all(
    'SELECT * FROM signalements WHERE est_demo = 0 AND date_cloture >= ? AND date_cloture < ? ORDER BY polyclinique, date_cloture',
    [debutMois(annee, mois), finMois(annee, mois)]);
  const parSite = {};
  const changements = [];
  let somme = 0, nb = 0;
  for (const l of fermes) {
    parSite[l.polyclinique] = (parSite[l.polyclinique] ?? 0) + 1;
    if (l.duree_h !== null) { somme += Number(l.duree_h); nb++; }
    if (l.action_corrective !== '') changements.push(`${l.polyclinique} — ${l.action_corrective}`);
  }
  const parSiteTrie = Object.fromEntries(Object.entries(parSite).sort((a, z) => z[1] - a[1]));
  return {
    annee, mois, fermes,
    nb_fermes: fermes.length, par_site: parSiteTrie,
    changements,
    duree_moy_h: nb ? Math.round(100 * somme / nb) / 100 : null,
  };
}

export function bulletinTexte(bul, cfg) {
  const l = [];
  l.push('VOUS AVEZ SIGNALÉ → NOUS AVONS CHANGÉ');
  l.push(`Bulletin UPCI — ${moisNom(bul.annee, bul.mois)} — ${cfg.etablissement}`);
  l.push('-'.repeat(55));
  l.push(`Signalements traités et clôturés ce mois : ${bul.nb_fermes}`);
  l.push(`Délai moyen de traitement : ${bul.duree_moy_h === null ? '—' : `${bul.duree_moy_h} h`}`);
  if (Object.keys(bul.par_site).length) {
    l.push('', 'Par polyclinique :');
    for (const [s, n] of Object.entries(bul.par_site)) l.push(`  - ${s} : ${n} dossier(s) réglé(s)`);
  }
  if (bul.changements.length) {
    l.push('', 'Ce qui a changé grâce à vos signalements :');
    for (const c of bul.changements) l.push(`  • ${c}`);
  }
  l.push('', 'Merci à toutes celles et ceux qui signalent : chaque signalement compte.');
  return l.join('\n');
}

export function bulletinHtml(bul, cfg) {
  let s = '<h2>Vous avez signalé → nous avons changé</h2>'
    + `<p>Bulletin UPCI — ${h(moisNom(bul.annee, bul.mois))} — ${h(cfg.etablissement)}</p>`
    + `<p><strong>${bul.nb_fermes}</strong> signalement(s) traité(s) et clôturé(s) ce mois`
    + ` — délai moyen : ${bul.duree_moy_h === null ? '—' : `${bul.duree_moy_h} h`}.</p>`;
  if (Object.keys(bul.par_site).length) {
    s += '<h3>Par polyclinique</h3><ul>';
    for (const [site, n] of Object.entries(bul.par_site)) s += `<li>${h(site)} : ${n} dossier(s) réglé(s)</li>`;
    s += '</ul>';
  }
  if (bul.changements.length) {
    s += '<h3>Ce qui a changé grâce à vos signalements</h3><ul>';
    for (const c of bul.changements) s += `<li>${h(c)}</li>`;
    s += '</ul>';
  }
  s += '<p><em>Merci à toutes celles et ceux qui signalent : chaque signalement compte.</em></p>';
  return s;
}
