/**
 * Sessions — cookies signés HMAC (voir util.js). Deux rôles :
 * « admin » (zone d'administration) et « cloture » (page interne de
 * clôture). Le secret de signature est, par ordre de préférence :
 * UPCI_SESSION_SECRET (env), l'empreinte du mot de passe admin, la
 * clé de clôture — jamais une valeur publiée.
 */
import { lireCookies, signerSession, verifierSession, enteteCookie } from './util.js';

export function secretSession(ctx) {
  return ctx.cfg.session_secret
    || ctx.cfg.admin_password_hash
    || ctx.cfg.closure_key
    || 'upci-secret-par-defaut-a-remplacer';
}

export async function ouvrirSession(ctx, request, role) {
  const valeur = await signerSession(secretSession(ctx), { r: role });
  return enteteCookie(request, role === 'admin' ? 'upci_admin' : 'upci_cloture', valeur);
}

export function fermerSession(ctx, request, role) {
  return enteteCookie(request, role === 'admin' ? 'upci_admin' : 'upci_cloture', '', { effacer: true });
}

export async function sessionRole(ctx, request, role) {
  const cookies = lireCookies(request);
  const valeur = cookies[role === 'admin' ? 'upci_admin' : 'upci_cloture'];
  if (!valeur) return null;
  const charge = await verifierSession(secretSession(ctx), valeur);
  return charge && charge.r === role ? charge : null;
}
