/**
 * Mode DÉMO — génère 8 signalements clairement marqués « DÉMO »
 * (préfixe DÉMO-AAAA-NNN, aucune notification réelle, exclus des
 * indicateurs officiels et des escalades du cron en production).
 * Miroir de cli/seed_demo.php de l'édition PHP. Utilisé par les CLI
 * Node ET par les boutons protégés de la zone admin (voie Workers).
 */
import { creerSignalement } from './metier.js';
import { epochVersLocal } from './util.js';

export async function semerDemo(ctx) {
  const cfg = ctx.cfg;
  const site = (i) => cfg.sites[i] ?? cfg.sites[0];
  const ilYA = (secondes) => epochVersLocal(Date.now() - secondes * 1000, cfg.timezone);
  const H = 3600;
  const J = 24 * H;

  const base = {
    service: 'Laboratoire', lieu: 'Magasin / stockage', periode: 'Matin',
    types: [cfg.types_urgence[0]], gravite: 2,
    action_immediate: 'Oui, partiellement', mesures: ['Responsable informé'],
    delai_demande: 'Sous 24 h', email_declarant: '',
  };
  const creer = (surcharge, ageSecondes) => creerSignalement(
    ctx, { ...base, ...surcharge }, { demo: true, date: ilYA(ageSecondes), notifier: false });
  const maj = async (numero, sets) => {
    const cols = Object.keys(sets).map((k) => `${k} = ?`);
    await ctx.db.run(
      `UPDATE signalements SET ${cols.join(', ')} WHERE numero = ?`,
      [...Object.values(sets), numero]);
  };

  // 1) Ouvert simple, hier — rupture de stock de savon.
  const s1 = await creer({ polyclinique: site(0) }, 26 * H);

  // 2) Critique OUVERT depuis 5 h, sans accusé — relance/escalade/rappel visibles.
  const s2 = await creer({
    polyclinique: site(1), service: 'Urgences', lieu: 'Entrée du service',
    periode: 'Soir', types: [cfg.types_urgence[3]], gravite: 5,
    action_immediate: 'Oui, totalement', mesures: ['Zone isolée ou signalée'],
    delai_demande: 'Immédiat',
  }, 5 * H);

  // 3) Critique ouvert depuis 3 h, PRIS EN CHARGE après 30 min.
  const s3 = await creer({
    polyclinique: site(2), service: 'Stérilisation centrale', lieu: 'Salle de soins',
    types: [cfg.types_urgence[5]], gravite: 4, delai_demande: 'Immédiat',
  }, 3 * H);
  await maj(s3.numero, {
    pris_en_charge_le: ilYA(3 * H - 1800), accuse_par: 'DÉMO — Chef UPCI',
    statut: 'CRITIQUE — Pris en charge',
  });

  // 4) Critique CLÔTURÉ il y a 2 jours — boucle d'apprentissage COMPLÈTE.
  const s4 = await creer({
    polyclinique: site(3), service: 'Pharmacie',
    types: [cfg.types_urgence[2]], gravite: 4, delai_demande: 'Aujourd’hui même',
  }, 2 * J);
  await maj(s4.numero, {
    statut: 'Clôturé', date_cloture: ilYA(2 * J - 3 * H), duree_h: 3.0,
    delai_reel: '1 à 4 heures',
    intervention: 'Autoclave de réserve mis en service, pièce commandée.',
    action_corrective: 'Maintenance préventive planifiée pour les deux autoclaves.',
    verif_efficacite: 'Contrôle sur place : équipement fonctionnel, problème disparu.',
    pris_en_charge_le: ilYA(2 * J - 600), accuse_par: 'DÉMO — Chef UPCI',
  });

  // 5) Critique CLÔTURÉ il y a 10 jours — vérification d'efficacité EN ATTENTE.
  const s5 = await creer({
    polyclinique: site(4), lieu: 'Local déchets', periode: 'Nuit',
    types: [cfg.types_urgence[1]], gravite: 5, delai_demande: 'Immédiat',
    email_declarant: 'demo-declarant@exemple.dz',
  }, 10 * J);
  await maj(s5.numero, {
    statut: 'Clôturé', date_cloture: ilYA(10 * J - 6 * H), duree_h: 6.0,
    delai_reel: '4 à 24 heures',
    intervention: 'Tri refait, conteneurs DASRI remplacés et étiquetés.',
    action_corrective: 'Affiche de tri plastifiée posée au local déchets + rappel en réunion de service.',
    pris_en_charge_le: ilYA(10 * J - 900), accuse_par: 'DÉMO — Chef UPCI',
  });

  // 6-8) Trio « Tri incorrect des déchets » au même site en 5 jours → regroupement.
  const trio = { polyclinique: site(6), service: 'Soins', lieu: 'Local déchets', types: [cfg.types_urgence[1]] };
  const s6 = await creer({ ...trio, gravite: 3, delai_demande: 'Sous 24 h' }, 1 * J);
  const s7 = await creer({ ...trio, gravite: 2, periode: 'Soir' }, 3 * J);
  await maj(s7.numero, {
    statut: 'Clôturé', date_cloture: ilYA(3 * J - 5 * H), duree_h: 5.0,
    delai_reel: '4 à 24 heures', intervention: 'Conteneurs triés et remplacés.',
  });
  const s8 = await creer({ ...trio, gravite: 3, lieu: 'Entrée du service' }, 5 * J);
  await maj(s8.numero, {
    statut: 'Clôturé', date_cloture: ilYA(5 * J - 2 * H), duree_h: 2.0,
    delai_reel: '1 à 4 heures', intervention: 'Local déchets réorganisé, étiquetage refait.',
  });

  await ctx.journal('', 'Système (démo)', 'démo', 'Jeu de démonstration généré : 8 signalements DÉMO');
  return [s1, s2, s3, s4, s5, s6, s7, s8].map((s) => s.numero);
}

/** Retire EXACTEMENT les signalements du mode démo (est_demo = 1). */
export async function purgerDemo(ctx) {
  const avant = await ctx.db.first('SELECT COUNT(*) AS n FROM signalements WHERE est_demo = 1');
  await ctx.db.run('DELETE FROM signalements WHERE est_demo = 1');
  const n = Number(avant?.n ?? 0);
  await ctx.journal('', 'Système (démo)', 'démo', `Retrait du mode démo : ${n} signalement(s) supprimé(s)`);
  return n;
}
