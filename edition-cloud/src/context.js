/**
 * Contexte d'exécution — l'objet unique passé à toute la logique
 * métier : { db (adaptateur), cfg (configuration effective), plateforme }.
 * Construit par chaque point d'entrée (worker.js, server.mjs, cli/*),
 * puis enrichi des réglages en base par settings.js (chargerReglages).
 * Fournit les petits services partagés : horloge du fuseau, journal
 * d'audit, méta, lecture d'un signalement.
 */
import { epochVersLocal, localVersEpoch } from './util.js';

export function creerContexte({ db, cfg, plateforme = 'node', doBackup = null, backupAgeJours = null }) {
  const tz = () => cfg.timezone || 'Africa/Algiers';
  const ctx = {
    db,
    cfg,
    plateforme,           // 'cloudflare' | 'node'
    doBackup,             // fonction optionnelle (Node : copie du fichier SQLite)
    backupAgeJours,       // fonction optionnelle → âge en jours de la dernière sauvegarde
    reglagesCharges: false,

    /** Horodatage courant au format stocké (« YYYY-MM-DD HH:mm:ss » local). */
    now() {
      return epochVersLocal(Date.now(), tz());
    },
    /** Parties locales courantes {annee, mois, jour} — pour les gardes du cron. */
    partiesNow() {
      const [d] = ctx.now().split(' ');
      const [annee, mois, jour] = d.split('-').map(Number);
      return { annee, mois, jour };
    },
    /** Convertit une date stockée en epoch ms (fuseau configuré). */
    versEpoch(local) {
      return localVersEpoch(local, tz());
    },
    /** Âge en heures d'une date stockée, par rapport à maintenant. */
    ageHeures(local) {
      return (Date.now() - ctx.versEpoch(local)) / 3600000;
    },

    /** Journal d'audit — ajout seul, jamais modifié ni effacé. Échec silencieux. */
    async journal(numero, acteur, action, detail = '') {
      try {
        await db.run(
          'INSERT INTO journal (horodatage, numero, acteur, action, detail) VALUES (?, ?, ?, ?, ?)',
          [ctx.now(), numero || '', acteur || '', action || '', detail || '']);
      } catch (e) {
        console.error('UPCI journal :', e?.message || e);
      }
    },

    async metaGet(cle) {
      const r = await db.first('SELECT valeur FROM meta WHERE cle = ?', [cle]);
      return r ? String(r.valeur) : null;
    },
    async metaSet(cle, valeur) {
      await db.run(
        'INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur',
        [cle, String(valeur)]);
    },

    /** Récupère un signalement par son numéro (ou null). */
    async parNumero(numero) {
      return db.first('SELECT * FROM signalements WHERE numero = ?', [numero]);
    },
  };
  return ctx;
}
