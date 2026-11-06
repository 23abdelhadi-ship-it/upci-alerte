/**
 * Tâches planifiées UPCI — UNE fonction unique, runPeriodicChecks(ctx),
 * invoquée par :
 *   - Cloudflare : le gestionnaire scheduled() du Worker (Cron Trigger
 *     « toutes les 30 minutes » déclaré dans wrangler.toml) ;
 *   - Node : la minuterie interne de server.mjs (toutes les 30 min),
 *     l'endpoint protégé /cron, ou le CLI (node cli/cron.mjs).
 *
 * À chaque passage (miroir de cli/cron.php de l'édition PHP) :
 * relance 1 h et escalade 4 h des critiques ouverts, rappel « non pris
 * en charge », rappel de vérification d'efficacité, règle de
 * regroupement. De façon hebdomadaire (auto-détecté) : moniteur de
 * silence, battement de cœur (santé), sauvegarde (Node uniquement —
 * D1 est sauvegardé par la plateforme). En début de mois : envoi du
 * bilan CLIN et du bulletin du mois écoulé.
 *
 * opts : { dryRun, demo, forceHebdo, log[] } — demo n'est honoré qu'en
 * dryRun (jamais de notification de faux cas en production).
 */
import { jsonTableau, cleSemaineIso, hashCourt, moisNom, fmt, epochVersLocal } from './util.js';
import { notifier, envoyerMail } from './notify.js';
import { bilan, bilanTexte, bulletin, bulletinTexte, sitesSilencieux } from './rapports.js';

export async function runPeriodicChecks(ctx, opts = {}) {
  const cfg = ctx.cfg;
  const DRY = !!opts.dryRun;
  const DEMO = !!opts.demo;
  const lignes = [];
  const dire = (txt) => {
    lignes.push(txt);
    (opts.log ?? console.log)(txt);
  };
  if (DEMO && !DRY) {
    dire('Refusé : demo exige dryRun (aucune notification de faux cas en production).');
    return lignes;
  }
  const condDemo = DEMO ? 'est_demo IN (0, 1)' : 'est_demo = 0';

  const notifierCron = async (sujet, corps, numero = '', action = '', detail = '') => {
    if (DRY) {
      dire(`DRY-RUN — enverrait : « ${sujet} »`);
      return;
    }
    await notifier(ctx, sujet, corps);
    if (action !== '') await ctx.journal(numero, 'Système', action, detail);
  };
  const tampon = async (colonne, id) => {
    if (DRY) return;
    await ctx.db.run(`UPDATE signalements SET ${colonne} = ? WHERE id = ?`, [ctx.now(), id]);
  };

  dire(`Cron UPCI${DRY ? ' (DRY-RUN)' : ''} — début`);
  const maintenant = Date.now();

  // ------------------------------------------------------------------
  // 1) Critiques ouverts : relance 1 h, escalade 4 h, rappel sans accusé
  // ------------------------------------------------------------------
  const ouverts = await ctx.db.all(
    `SELECT * FROM signalements WHERE ${condDemo} AND est_critique = 1 AND date_cloture IS NULL ORDER BY date_creation`);
  for (const s of ouverts) {
    const ageH = (maintenant - ctx.versEpoch(s.date_creation)) / 3600000;
    const resume = `${s.numero} — ${s.polyclinique} — ${s.service} — gravité ${s.gravite} — ouvert depuis ${Math.round(ageH * 10) / 10} h.`;
    if (ageH >= Number(cfg.sla_relance_h) && !s.relance_1h_le) {
      await notifierCron(
        `⏰ RELANCE — Critique ouvert depuis plus de ${cfg.sla_relance_h} h : ${s.numero}`,
        `${resume}\nIntervenez et clôturez via la page de clôture.`,
        s.numero, 'relance', `Relance ${cfg.sla_relance_h} h (critique ouvert)`);
      await tampon('relance_1h_le', s.id);
      dire(`Relance 1h : ${s.numero}`);
    }
    if (ageH >= Number(cfg.sla_escalade_h) && !s.escalade_4h_le) {
      await notifierCron(
        `⛔ ESCALADE — Critique ouvert depuis plus de ${cfg.sla_escalade_h} h : ${s.numero}`,
        `${resume}\nEscalade transmise à la supervision. Intervention immédiate requise.`,
        s.numero, 'escalade', `Escalade ${cfg.sla_escalade_h} h (critique ouvert)`);
      await tampon('escalade_4h_le', s.id);
      dire(`Escalade 4h : ${s.numero}`);
    }
    if (ageH >= Number(cfg.sla_accuse_h) && !s.pris_en_charge_le && !s.relance_accuse_le) {
      await notifierCron(
        `👀 NON PRIS EN CHARGE — ${s.numero}`,
        `${resume}\nOuvrez l’alerte Telegram et appuyez sur « ✅ Pris en charge », ou intervenez et clôturez.`,
        s.numero, 'relance', 'Rappel : critique sans accusé de réception');
      await tampon('relance_accuse_le', s.id);
      dire(`Rappel sans accusé : ${s.numero}`);
    }
  }

  // ------------------------------------------------------------------
  // 2) Vérification d'efficacité en attente (critiques clôturés)
  // ------------------------------------------------------------------
  const enAttente = await ctx.db.all(
    `SELECT * FROM signalements WHERE ${condDemo} AND est_critique = 1
     AND date_cloture IS NOT NULL AND verif_efficacite = '' AND relance_verif_le IS NULL`);
  for (const s of enAttente) {
    const ageJ = (maintenant - ctx.versEpoch(s.date_cloture)) / 86400000;
    if (ageJ < Number(cfg.verif_efficacite_jours)) continue;
    await notifierCron(
      `🔍 Vérification d’efficacité en attente — ${s.numero}`,
      `${s.numero} — ${s.polyclinique} — clôturé depuis ${Math.floor(ageJ)} j.\n`
      + `Action corrective consignée : ${s.action_corrective || '—'}\n`
      + 'Vérifiez sur place si le problème a réellement disparu, puis consignez le résultat via la page de clôture (champ « Vérification d’efficacité »).',
      s.numero, 'relance', `Vérification d’efficacité en attente depuis ${Math.floor(ageJ)} j`);
    await tampon('relance_verif_le', s.id);
    dire(`Rappel vérification : ${s.numero}`);
  }

  // ------------------------------------------------------------------
  // 3) Règle de regroupement : >= seuil, même type + même site, fenêtre glissante
  // ------------------------------------------------------------------
  const limite = epochVersLocal(maintenant - Number(cfg.fenetre_groupe_jours) * 86400000, cfg.timezone);
  const recents = await ctx.db.all(
    `SELECT * FROM signalements WHERE ${condDemo} AND date_creation >= ? ORDER BY date_creation`, [limite]);
  const groupes = new Map();
  for (const s of recents) {
    for (const t of jsonTableau(s.types)) {
      const cle = `${t} | ${s.polyclinique}`;
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(s.numero);
    }
  }
  const semaine = cleSemaineIso(ctx.now());
  for (const [cle, numeros] of groupes) {
    if (numeros.length < Number(cfg.seuil_groupe)) continue;
    const cleMeta = `groupe_${hashCourt(cle)}`;
    if (!DRY && (await ctx.metaGet(cleMeta)) === semaine) continue; // déjà alerté cette semaine
    await notifierCron(
      `🧩 REGROUPEMENT SUSPECTÉ — ${cle}`,
      `${numeros.length} signalements du même type à la même polyclinique en ${cfg.fenetre_groupe_jours} jours : ${numeros.join(', ')}.\n`
      + 'Piste : cause commune ou début de cluster — examen en réunion CLIN et vigilance renforcée recommandés.',
      numeros[0], 'regroupement',
      `${cle} — ${numeros.length} signalements en ${cfg.fenetre_groupe_jours} j : ${numeros.join(', ')}`);
    if (!DRY) await ctx.metaSet(cleMeta, semaine);
    dire(`Regroupement : ${cle} (${numeros.length})`);
  }

  // ------------------------------------------------------------------
  // 4) Hebdomadaire (auto) : silence des sites, santé, sauvegarde
  // ------------------------------------------------------------------
  const dernierHebdo = await ctx.metaGet('dernier_hebdo');
  const hebdoDu = !!opts.forceHebdo || dernierHebdo === null
    || (maintenant - ctx.versEpoch(dernierHebdo)) >= 6 * 86400000;
  if (hebdoDu) {
    // 4a) Moniteur de silence
    const silencieux = await sitesSilencieux(ctx);
    if (silencieux.length) {
      await notifierCron(
        `🔇 Sites silencieux — aucun signalement depuis ${cfg.silence_semaines} semaines`,
        `Sites concernés :\n- ${silencieux.join('\n- ')}\n\nLe silence est une donnée, pas un succès : vérifiez l’affiche QR, rappelez la démarche en douceur (soutien, pas de blâme).`,
        '', 'silence', silencieux.join(', '));
      dire(`Silence : ${silencieux.length} site(s)`);
    } else {
      dire('Silence : aucun site silencieux');
    }
    // 4b) Battement de cœur — une ligne de santé
    const nbOuv = Number((await ctx.db.first(
      'SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND date_cloture IS NULL')).n);
    const nbCrit = Number((await ctx.db.first(
      'SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 0 AND est_critique = 1 AND date_cloture IS NULL')).n);
    const dernierSig = (await ctx.db.first(
      'SELECT MAX(date_creation) AS m FROM signalements WHERE est_demo = 0')).m;
    const ageSauv = ctx.backupAgeJours ? await ctx.backupAgeJours() : null;
    const problemes = [];
    if (ctx.plateforme === 'node') {
      if (ageSauv === null) problemes.push('aucune sauvegarde trouvée');
      else if (ageSauv > 8) problemes.push(`dernière sauvegarde âgée de ${Math.floor(ageSauv)} j`);
    }
    const sauvTexte = ctx.plateforme === 'node'
      ? (ageSauv === null ? 'aucune' : `il y a ${Math.floor(ageSauv)} j`)
      : 'plateforme D1 (gérée par Cloudflare)';
    const ligneSante = `${problemes.length ? `⚠️ SANTÉ UPCI — ALERTE : ${problemes.join(' ; ')}` : '💚 SANTÉ UPCI — OK'}`
      + ` | Ouverts : ${nbOuv} (critiques : ${nbCrit})`
      + ` | Dernier signalement : ${dernierSig ? fmt(dernierSig) : 'aucun'}`
      + ` | Sauvegarde : ${sauvTexte}`
      + ` | Base : ${ctx.db.type}`;
    await notifierCron(ligneSante, ligneSante, '', 'santé', ligneSante);
    dire(`Santé : ${ligneSante}`);
    // 4c) Sauvegarde hebdomadaire (Node uniquement — fichier SQLite)
    if (!DRY) {
      if (ctx.doBackup) {
        const chemin = await ctx.doBackup();
        if (chemin) dire(`Sauvegarde : ${chemin}`);
      }
      await ctx.metaSet('dernier_hebdo', ctx.now());
    } else {
      dire('DRY-RUN — sauvegarde hebdomadaire simulée');
    }
  }

  // ------------------------------------------------------------------
  // 5) Mensuel (auto, première semaine du mois) : bilan CLIN + bulletin
  // ------------------------------------------------------------------
  const { annee, mois, jour } = ctx.partiesNow();
  const moisPrec = mois === 1 ? 12 : mois - 1;
  const anneePrec = mois === 1 ? annee - 1 : annee;
  const cleMois = `${anneePrec}-${String(moisPrec).padStart(2, '0')}`;
  if (jour <= 7 && (await ctx.metaGet('dernier_envoi_mensuel')) !== cleMois) {
    const b = await bilan(ctx, anneePrec, moisPrec);
    await notifierCron(
      `Bilan mensuel CLIN — ${moisNom(anneePrec, moisPrec)}`, bilanTexte(b, cfg),
      '', 'bilan', `Bilan CLIN ${cleMois} envoyé`);
    dire(`Bilan CLIN ${cleMois} : envoyé`);
    const bul = await bulletin(ctx, anneePrec, moisPrec);
    if (bul.nb_fermes > 0 || bul.changements.length) {
      const dest = (cfg.emails_bulletin?.length ? cfg.emails_bulletin : cfg.emails_alertes) ?? [];
      if (DRY) {
        dire(`DRY-RUN — bulletin ${cleMois} enverrait à : ${dest.join(', ')}`);
      } else {
        for (const email of dest) {
          await envoyerMail(ctx, email,
            `Bulletin UPCI — Vous avez signalé → nous avons changé (${moisNom(anneePrec, moisPrec)})`,
            bulletinTexte(bul, cfg));
        }
        await ctx.journal('', 'Système', 'bulletin', `Bulletin ${cleMois} envoyé à ${dest.length} destinataire(s)`);
      }
      dire(`Bulletin ${cleMois} : envoyé`);
    } else {
      dire(`Bulletin ${cleMois} : vide, non envoyé`);
      if (!DRY) await ctx.journal('', 'Système', 'bulletin', `Bulletin ${cleMois} ignoré (vide)`);
    }
    if (!DRY) await ctx.metaSet('dernier_envoi_mensuel', cleMois);
  }

  dire('Cron UPCI — fin');
  return lignes;
}
