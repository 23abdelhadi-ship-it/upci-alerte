/**
 * Réglages en base — le cœur de l'interface /installation + /admin/reglages.
 *
 * Les réglages métier vivent dans la table « reglages » (clé/valeur) de
 * la MÊME base que le registre (D1 sous Workers, fichier SQLite sous
 * Node). À chaque invocation (requête web, cron planifié, CLI), les
 * points d'entrée appellent chargerReglages(ctx) : les valeurs en base
 * PRIMENT sur les défauts du code et sur l'environnement d'amorçage.
 * Les fichiers statiques ne servent plus qu'à l'amorçage plateforme.
 *
 * Clés gérées : etablissement, sites, emails_alertes, emails_bulletin,
 * telegram_token, telegram_chat_ids, seuil_critique, sla_relance_h,
 * sla_escalade_h, admin_password_hash, closure_key, installe.
 */
const CLES_LISTES = ['sites', 'emails_alertes', 'emails_bulletin', 'telegram_chat_ids'];
const CLES_NOMBRES = ['seuil_critique', 'sla_relance_h', 'sla_escalade_h'];
const CLES_TEXTES = ['etablissement', 'telegram_token', 'admin_password_hash', 'closure_key'];

/** Lit tous les réglages bruts en base → objet {cle: valeur}. */
export async function lireReglages(ctx) {
  const lignes = await ctx.db.all('SELECT cle, valeur FROM reglages');
  const out = {};
  for (const l of lignes) out[l.cle] = l.valeur;
  return out;
}

/** Le système est-il installé (première configuration terminée) ? */
export async function estConfigure(ctx) {
  const r = await ctx.db.first("SELECT valeur FROM reglages WHERE cle = 'installe'");
  return !!r && r.valeur === '1';
}

/**
 * Applique les réglages en base sur ctx.cfg (une fois par invocation).
 * Une valeur en base ne remplace la valeur d'amorçage que si elle est
 * présente (et non vide pour les textes) — l'environnement reste un
 * filet de secours, jamais l'inverse.
 */
export async function chargerReglages(ctx) {
  if (ctx.reglagesCharges) return ctx.cfg;
  ctx.reglagesCharges = true;
  let bruts = {};
  try {
    bruts = await lireReglages(ctx);
  } catch {
    return ctx.cfg; // table absente (très premier démarrage) : défauts
  }
  for (const cle of CLES_TEXTES) {
    if (typeof bruts[cle] === 'string' && bruts[cle] !== '') ctx.cfg[cle] = bruts[cle];
  }
  for (const cle of CLES_LISTES) {
    if (typeof bruts[cle] === 'string' && bruts[cle] !== '') {
      try {
        const t = JSON.parse(bruts[cle]);
        if (Array.isArray(t)) ctx.cfg[cle] = t.map(String);
      } catch { /* valeur corrompue : on garde l'amorçage */ }
    }
  }
  for (const cle of CLES_NOMBRES) {
    const n = Number(bruts[cle]);
    if (bruts[cle] !== undefined && bruts[cle] !== '' && Number.isFinite(n)) ctx.cfg[cle] = n;
  }
  ctx.reglages = bruts;
  return ctx.cfg;
}

/** Écrit plusieurs réglages (upsert), valeurs déjà sérialisées en texte. */
export async function enregistrerReglages(ctx, valeurs) {
  for (const [cle, valeur] of Object.entries(valeurs)) {
    await ctx.db.run(
      'INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur',
      [cle, String(valeur)]);
  }
  ctx.reglagesCharges = false; // forcer le rechargement à la prochaine utilisation
}

/** Sérialise un réglage selon son type (listes → JSON). */
export function serialiser(cle, valeur) {
  if (CLES_LISTES.includes(cle)) return JSON.stringify(valeur ?? []);
  return String(valeur ?? '');
}
