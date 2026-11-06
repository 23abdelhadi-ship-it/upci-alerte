/**
 * Logique métier — création, accusé Telegram, clôture, réouverture.
 * Miroir fidèle des éditions Apps Script (Code.gs V5) et PHP :
 * numérotation séquentielle UPCI-AAAA-NNNN, critique = gravité >= seuil
 * ou délai « Immédiat », clôture sur la même ligne, journal d'audit.
 */
import { estOuvert, fmt } from './util.js';
import { envoyerMail, corpsAlerte, telegramAlerte, telegramMajApresAccuse, notifier } from './notify.js';

/**
 * Prochain numéro séquentiel — UNE instruction atomique
 * (INSERT … ON CONFLICT … RETURNING), valable dans le dialecte SQLite
 * commun à D1 et node:sqlite : aucun risque de collision, pas de
 * transaction interactive (que D1 ne permet pas).
 */
export async function nouveauNumero(ctx) {
  const annee = Number(ctx.now().slice(0, 4));
  const r = await ctx.db.first(
    `INSERT INTO compteurs (annee, dernier) VALUES (?, 1)
     ON CONFLICT(annee) DO UPDATE SET dernier = dernier + 1 RETURNING dernier`,
    [annee]);
  return `UPCI-${annee}-${String(r.dernier).padStart(4, '0')}`;
}

/**
 * Crée un signalement. opts : { demo, date (ISO forcée, seed), notifier }.
 * Retourne la ligne créée.
 */
export async function creerSignalement(ctx, input, opts = {}) {
  const cfg = ctx.cfg;
  const demo = !!opts.demo;
  let numero;
  if (demo) {
    // Numérotation DÉMO séparée — ne consomme pas la numérotation officielle.
    const annee = Number(ctx.now().slice(0, 4));
    const r = await ctx.db.first(
      "SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 1 AND numero LIKE ?",
      [`DÉMO-${annee}-%`]);
    numero = `DÉMO-${annee}-${String(Number(r.n) + 1).padStart(3, '0')}`;
  } else {
    numero = await nouveauNumero(ctx);
  }
  const gravite = Math.max(0, Math.min(5, parseInt(input.gravite ?? 0, 10) || 0));
  const delai = String(input.delai_demande ?? '');
  const critique = gravite >= Number(cfg.seuil_critique)
    || /imm[ée]diat/i.test(delai);
  const date = opts.date ?? ctx.now();
  const statut = critique ? 'CRITIQUE — En attente' : 'En attente';

  await ctx.db.run(
    `INSERT INTO signalements
       (numero, date_creation, polyclinique, service, lieu, periode, types, gravite,
        action_immediate, mesures, delai_demande, email_declarant, statut, est_critique, est_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      numero, date,
      String(input.polyclinique ?? ''), String(input.service ?? ''),
      String(input.lieu ?? ''), String(input.periode ?? ''),
      JSON.stringify([...(input.types ?? [])]), gravite,
      String(input.action_immediate ?? ''),
      JSON.stringify([...(input.mesures ?? [])]),
      delai, String(input.email_declarant ?? ''),
      statut, critique ? 1 : 0, demo ? 1 : 0,
    ]);
  const sig = await ctx.parNumero(numero);
  await ctx.journal(numero, sig.email_declarant || 'Déclarant (formulaire)', 'création',
    `${sig.polyclinique} — ${sig.service} — gravité ${gravite}${demo ? ' [DÉMO]' : ''}`);

  if (!demo && (opts.notifier ?? true)) {
    // 1) Emails d'alerte
    const sujet = `${critique ? '🚨🚨 URGENCE CRITIQUE — ' : 'Nouveau signalement — '}${numero}`;
    for (const email of cfg.emails_alertes ?? []) {
      await envoyerMail(ctx, email, sujet, corpsAlerte(sig));
    }
    // 2) Telegram avec bouton d'accusé ; références conservées pour l'édition ultérieure
    const refs = await telegramAlerte(ctx, sig);
    if (refs.length) {
      await ctx.db.run('UPDATE signalements SET telegram_msgs = ? WHERE numero = ?',
        [JSON.stringify(refs), numero]);
      sig.telegram_msgs = JSON.stringify(refs);
    }
    // 3) Accusé de réception au déclarant (s'il a laissé un email)
    if (sig.email_declarant) {
      const base = cfg.base_url || '';
      await envoyerMail(ctx, sig.email_declarant, `Accusé de réception — ${numero}`, [
        'Votre signalement a été enregistré.',
        `N° : ${numero}`,
        `Polyclinique : ${sig.polyclinique}`,
        `Suivi de l’état : ${base}/statut — saisissez votre numéro ET la polyclinique.`,
        'Vous recevrez un nouvel email lorsque le signalement sera traité et clôturé.',
      ].join('\n'));
    }
  }
  return sig;
}

/**
 * Accusé Telegram (bouton « ✅ Pris en charge ») — idempotent.
 * `from` : objet Telegram de l'utilisateur. Retourne le texte de
 * confirmation à afficher à l'utilisateur du bouton.
 */
export async function accuser(ctx, numero, from, chatId) {
  const cfg = ctx.cfg;
  if (!(cfg.telegram_chat_ids || []).map(String).includes(String(chatId))) {
    return '⛔ Accusé non autorisé pour cette conversation.';
  }
  const sig = await ctx.parNumero(numero);
  if (!sig || sig.est_demo) return 'Signalement introuvable.';
  if (sig.pris_en_charge_le) {
    return `Déjà pris en charge par ${sig.accuse_par || '—'} le ${fmt(sig.pris_en_charge_le)}`;
  }
  if (!estOuvert(sig)) return 'Ce signalement est déjà clôturé.';
  let nom = `${from.first_name || ''} ${from.last_name || ''}`.trim();
  if (from.username) nom = `${nom} (@${from.username})`.trim();
  if (!nom) nom = 'Utilisateur Telegram';
  const maintenant = ctx.now();
  const statut = sig.statut.replace('En attente', 'Pris en charge');
  await ctx.db.run(
    'UPDATE signalements SET pris_en_charge_le = ?, accuse_par = ?, statut = ? WHERE numero = ?',
    [maintenant, nom, statut, numero]);
  await ctx.journal(numero, nom, 'accusé', 'Telegram — bouton « Pris en charge »');
  const maj = await ctx.parNumero(numero);
  await telegramMajApresAccuse(ctx, maj);
  return `✅ ${numero} pris en charge par ${nom}`;
}

/**
 * Clôture (page interne protégée par clé). Mêmes sémantiques que les
 * éditions précédentes : la clôture met à jour la ligne du
 * signalement ; une ré-soumission avec SEULE la vérification
 * d'efficacité ne touche ni la date de clôture, ni la durée, ni
 * l'intervention, et ne re-notifie pas. Retourne un message de
 * résultat (ou lève une Error au message explicite).
 */
export async function cloturer(ctx, numero, input, acteur) {
  const sig = await ctx.parNumero(String(numero).trim());
  if (!sig) throw new Error(`Numéro introuvable : ${numero}`);
  const intervention = String(input.intervention ?? '').trim();
  const statutForm = String(input.statut ?? '');
  const delaiReel = String(input.delai_reel ?? '');
  const actionCorr = String(input.action_corrective ?? '').trim();
  const verif = String(input.verif_efficacite ?? '').trim();
  const dejaFerme = !!sig.date_cloture;

  // Cas V5 : vérification d'efficacité seule sur un dossier déjà clôturé.
  if (dejaFerme && verif !== '' && intervention === '' && actionCorr === '') {
    await ctx.db.run('UPDATE signalements SET verif_efficacite = ? WHERE numero = ?',
      [verif, sig.numero]);
    await ctx.journal(sig.numero, acteur, 'vérification', verif);
    return `Vérification d’efficacité enregistrée pour ${sig.numero} (clôture inchangée).`;
  }

  const sets = [];
  const vals = [];
  if (intervention !== '') { sets.push('intervention = ?'); vals.push(intervention); }
  if (delaiReel !== '') { sets.push('delai_reel = ?'); vals.push(delaiReel); }
  if (actionCorr !== '') { sets.push('action_corrective = ?'); vals.push(actionCorr); }
  if (verif !== '') { sets.push('verif_efficacite = ?'); vals.push(verif); }

  let nouveauStatut = null;
  let fermeMaintenant = false;
  switch (statutForm) {
    case 'Clôturé':
      nouveauStatut = 'Clôturé';
      if (!dejaFerme) {
        fermeMaintenant = true;
        const duree = (ctx.versEpoch(ctx.now()) - ctx.versEpoch(sig.date_creation)) / 3600000;
        sets.push('date_cloture = ?'); vals.push(ctx.now());
        sets.push('duree_h = ?'); vals.push(Math.round(Math.max(duree, 0) * 100) / 100);
      }
      break;
    case 'Partiellement résolu':
      nouveauStatut = dejaFerme ? 'Clôturé' : 'Partiel — en cours';
      break;
    case 'En cours de traitement':
      nouveauStatut = dejaFerme ? 'Clôturé' : 'En cours';
      break;
    case 'Non résolu — à escalader':
      nouveauStatut = dejaFerme ? 'Clôturé' : 'Non résolu — ESCALADE';
      break;
  }
  if (nouveauStatut !== null) { sets.push('statut = ?'); vals.push(nouveauStatut); }
  if (sets.length) {
    vals.push(sig.numero);
    await ctx.db.run(`UPDATE signalements SET ${sets.join(', ')} WHERE numero = ?`, vals);
  }
  if (actionCorr !== '') await ctx.journal(sig.numero, acteur, 'action corrective', actionCorr);
  if (verif !== '') await ctx.journal(sig.numero, acteur, 'vérification', verif);

  if (fermeMaintenant) {
    const dureeH = Math.round(((ctx.versEpoch(ctx.now()) - ctx.versEpoch(sig.date_creation)) / 3600000) * 100) / 100;
    await ctx.journal(sig.numero, acteur, 'clôture', `${intervention || '—'} | Durée : ${dureeH} h`);
    // Notification du déclarant (« traité et clôturé »).
    if (!sig.est_demo && sig.email_declarant) {
      await envoyerMail(ctx, sig.email_declarant, `Signalement traité et clôturé — ${sig.numero}`, [
        `Votre signalement ${sig.numero} (${sig.polyclinique}) a été traité et clôturé.`,
        `Intervention réalisée : ${intervention || '—'}`,
        'Merci de votre vigilance — chaque signalement fait changer les choses.',
      ].join('\n'));
    }
    return `Signalement ${sig.numero} CLÔTURÉ.`;
  }
  if (statutForm === 'Non résolu — à escalader' && !dejaFerme) {
    await ctx.journal(sig.numero, acteur, 'escalade', 'Clôture « Non résolu » — escalade manuelle');
    await notifier(ctx, `⛔ ESCALADE — ${sig.numero} déclaré NON RÉSOLU`,
      `${sig.numero} — ${sig.polyclinique} — ${sig.service}\nIntervention tentée : ${intervention || '—'}`);
    return `Signalement ${sig.numero} marqué NON RÉSOLU — escalade envoyée.`;
  }
  return `Signalement ${sig.numero} mis à jour (${nouveauStatut ?? sig.statut}).`;
}

/** Réouverture manuelle par l'administrateur. */
export async function rouvrir(ctx, numero, acteur) {
  const sig = await ctx.parNumero(numero);
  if (!sig) throw new Error(`Numéro introuvable : ${numero}`);
  const statut = sig.est_critique ? 'CRITIQUE — En attente' : 'En attente';
  await ctx.db.run(
    'UPDATE signalements SET date_cloture = NULL, duree_h = NULL, statut = ? WHERE numero = ?',
    [statut, numero]);
  await ctx.journal(numero, acteur, 'réouverture', 'Réouverture manuelle');
  return `Signalement ${numero} rouvert.`;
}
