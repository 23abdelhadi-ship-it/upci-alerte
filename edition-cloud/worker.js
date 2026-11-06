/**
 * Point d'entrée CLOUDFLARE WORKERS.
 * Ne contient QUE l'adaptation plateforme : liaison D1 (env.DB),
 * variables/secrets (env), gestionnaire scheduled() pour les Cron
 * Triggers. Toute la logique est dans src/ — partagée avec Node.
 *
 * Déploiement : voir INSTALL.md (wrangler deploy, D1, secrets, webhook).
 */
import { construireConfig } from './src/config.js';
import { adaptateurD1, garantirSchema } from './src/db.js';
import { creerContexte } from './src/context.js';
import { chargerReglages } from './src/settings.js';
import { creerGestionnaire } from './src/app.js';
import { runPeriodicChecks } from './src/cron.js';

async function contexte(env) {
  const cfg = construireConfig(env);
  const db = adaptateurD1(env.DB);
  await garantirSchema(db);
  const ctx = creerContexte({ db, cfg, plateforme: 'cloudflare' });
  await chargerReglages(ctx); // les réglages en base priment, à chaque invocation
  return ctx;
}

export default {
  async fetch(request, env) {
    const ctx = await contexte(env);
    return creerGestionnaire(ctx)(request);
  },

  /** Cron Trigger « toutes les 30 minutes » (wrangler.toml) → contrôles périodiques. */
  async scheduled(event, env, cfCtx) {
    const ctx = await contexte(env);
    const travail = runPeriodicChecks(ctx, {});
    if (cfCtx && typeof cfCtx.waitUntil === 'function') cfCtx.waitUntil(travail);
    else await travail;
  },
};
