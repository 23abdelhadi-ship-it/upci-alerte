/**
 * Mode DÉMO — génère 8 signalements « DÉMO » (voir src/seed.js).
 *   node cli/seed_demo.mjs
 * Sous Workers : boutons équivalents dans la zone admin (tableau de bord).
 */
import { contexteCli } from './env.mjs';
import { semerDemo } from '../src/seed.js';

const ctx = await contexteCli();
const numeros = await semerDemo(ctx);
console.log(`DÉMO générée : 8 signalements (${numeros[0]} … ${numeros[numeros.length - 1]})`);
console.log('Essayez : node cli/cron.mjs --dry-run --demo   (relances, escalade, regroupement visibles)');
console.log('Retrait  : node cli/purge_demo.mjs');
ctx.fermer();
