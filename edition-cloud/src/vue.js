/**
 * Helpers d'affichage partagés par les pages web (miroir de vue.php)
 * + fabriques de réponses Web-standard (Response).
 */
import { h } from './util.js';
import { STYLE_CSS } from './style.js';

export { STYLE_CSS };

export function pageDebut(cfg, titre, base = '') {
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${h(titre)} — UPCI</title>`
    + `<link rel="stylesheet" href="${h(base)}assets/style.css">`
    + '</head><body><div class="wrap">'
    + '<header class="entete"><div class="logo">UPCI <span>Alert</span></div>'
    + `<div class="etab">${h(cfg.etablissement)} — ${h(cfg.wilaya)}</div></header>`;
}

export function pageFin() {
  return '<footer class="pied">Système d’alerte numérique UPCI — édition JavaScript portable. '
    + 'Aucune donnée patient n’est collectée.</footer></div></body></html>';
}

/** Réponse HTML complète. */
export function reponseHtml(corps, { statut = 200, entetes = {} } = {}) {
  return new Response(corps, {
    status: statut,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...entetes },
  });
}

/** Réponse texte brut. */
export function reponseTexte(corps, { statut = 200, entetes = {} } = {}) {
  return new Response(corps, {
    status: statut,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...entetes },
  });
}

/** Redirection 303 (POST → GET, patron PRG comme l'édition PHP). */
export function redirection(url, entetes = {}) {
  return new Response(null, { status: 303, headers: { Location: url, ...entetes } });
}

/** Base publique de l'application : cfg.base_url sinon l'origine de la requête. */
export function baseUrl(ctx, request) {
  if (ctx.cfg.base_url) return ctx.cfg.base_url.replace(/\/+$/, '');
  return new URL(request.url).origin;
}
