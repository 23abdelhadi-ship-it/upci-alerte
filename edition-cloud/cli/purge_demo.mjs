/**
 * Retire EXACTEMENT les signalements du mode démo (est_demo = 1).
 *   node cli/purge_demo.mjs
 */
import { contexteCli } from './env.mjs';
import { purgerDemo } from '../src/seed.js';

const ctx = await contexteCli();
const n = await purgerDemo(ctx);
console.log(`Mode démo retiré : ${n} signalement(s) DÉMO supprimé(s).`);
ctx.fermer();
