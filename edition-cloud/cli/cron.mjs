/**
 * Contrôles périodiques en ligne de commande (Node) — même fonction
 * que la minuterie interne, l'endpoint /cron et le scheduled() Workers.
 *   node cli/cron.mjs                     (passage réel)
 *   node cli/cron.mjs --dry-run           (montre ce qui SERAIT fait)
 *   node cli/cron.mjs --dry-run --demo    (inclut les lignes DÉMO — dry-run uniquement)
 *   node cli/cron.mjs --hebdo             (force aussi les tâches hebdomadaires)
 */
import { contexteCli } from './env.mjs';
import { runPeriodicChecks } from '../src/cron.js';

const ctx = await contexteCli();
await runPeriodicChecks(ctx, {
  dryRun: process.argv.includes('--dry-run'),
  demo: process.argv.includes('--demo'),
  forceHebdo: process.argv.includes('--hebdo'),
});
ctx.fermer();
