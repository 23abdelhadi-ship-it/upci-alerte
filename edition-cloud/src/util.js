/**
 * Utilitaires partagés — AUCUNE dépendance, Web-standard uniquement
 * (fonctionne tel quel sous Cloudflare Workers et Node.js ≥ 20).
 */

/** Échappement HTML systématique à l'affichage (équivalent htmlspecialchars). */
export function h(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** Parse un champ JSON stocké en base (types / mesures), tableau sinon. */
export function jsonTableau(v) {
  try {
    const t = JSON.parse(v || '[]');
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

/** Décodage d'entités minimal pour passer d'un texte HTML au texte brut. */
export function texteBrut(html) {
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'");
}

// ---------------------------------------------------------------------
// Dates — stockées en base au format local « YYYY-MM-DD HH:mm:ss »
// dans le fuseau configuré (Africa/Algiers par défaut), comme les
// éditions Apps Script et PHP. Les conversions passent par Intl.
// ---------------------------------------------------------------------

function partiesLocales(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  return p;
}

const pad = (n, l = 2) => String(n).padStart(l, '0');

/** epoch ms → « YYYY-MM-DD HH:mm:ss » dans le fuseau tz. */
export function epochVersLocal(ms, tz) {
  const p = partiesLocales(ms, tz);
  return `${p.year}-${p.month}-${p.day} ${pad(p.hour % 24)}:${p.minute}:${p.second}`;
}

/** Décalage (local − UTC) en ms du fuseau tz à l'instant ms. */
function decalageMs(ms, tz) {
  const p = partiesLocales(ms, tz);
  const commeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return commeUtc - Math.floor(ms / 1000) * 1000;
}

/** « YYYY-MM-DD HH:mm:ss » (fuseau tz) → epoch ms. */
export function localVersEpoch(str, tz) {
  const [d, t = '00:00:00'] = String(str).split(' ');
  const [Y, M, D] = d.split('-').map(Number);
  const [H, Mi, S] = t.split(':').map(Number);
  const devinette = Date.UTC(Y, M - 1, D, H, Mi, S || 0);
  let epoch = devinette - decalageMs(devinette, tz);
  const off2 = decalageMs(epoch, tz);
  if (off2 !== decalageMs(devinette, tz)) epoch = devinette - off2;
  return epoch;
}

/** Formate une date stockée pour l'affichage : « JJ/MM/AAAA HH:MM ». */
export function fmt(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : h(iso);
}

/** « Janvier 2026 » — noms de mois statiques (aucune dépendance de locale). */
export function moisNom(annee, mois) {
  const noms = [null, 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${noms[mois] ?? mois} ${annee}`;
}

/** Clé de semaine ISO « 2026-W45 » pour une date locale « YYYY-MM-DD … ». */
export function cleSemaineIso(localStr) {
  const [d] = String(localStr).split(' ');
  const [Y, M, D] = d.split('-').map(Number);
  const date = new Date(Date.UTC(Y, M - 1, D));
  const jour = (date.getUTCDay() + 6) % 7; // lundi = 0
  date.setUTCDate(date.getUTCDate() - jour + 3); // jeudi de la semaine
  const premierJan = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const jeudi1 = new Date(premierJan);
  jeudi1.setUTCDate(premierJan.getUTCDate() - ((premierJan.getUTCDay() + 6) % 7) + 3);
  const semaine = 1 + Math.round((date - jeudi1) / (7 * 86400000));
  return `${date.getUTCFullYear()}-W${pad(semaine)}`;
}

/** Petit hachage synchrone (FNV-1a) — clés internes de déduplication uniquement. */
export function hashCourt(str) {
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    x ^= str.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  return (x >>> 0).toString(16);
}

// ---------------------------------------------------------------------
// Mot de passe admin — PBKDF2-SHA256 via WebCrypto : disponible à
// l'identique sous Workers et Node (crypto.subtle), donc UNE seule
// implémentation pour les deux domiciles (bcrypt n'existe pas en
// standard Web). Format stocké : pbkdf2$sha256$<itérations>$<sel>$<clé>
// ---------------------------------------------------------------------

// Base64 100 % Web standard (btoa/atob) : Buffer n'existe PAS sous
// Cloudflare Workers — son usage ici a causé le 500 du 1er déploiement.
const b64 = (buf) => {
  const octets = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < octets.length; i++) s += String.fromCharCode(octets[i]);
  return btoa(s);
};
const unb64 = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64VersUrl = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64DepuisUrl = (s) => {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return t;
};

export async function hacherMotDePasse(motDePasse, iterations = 100000) {
  // Plafond Cloudflare Workers : WebCrypto y refuse PBKDF2 au-delà de
  // 100 000 itérations (Node l'accepte — écart vécu au 1er déploiement).
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const cle = await deriver(motDePasse, sel, iterations);
  return `pbkdf2$sha256$${iterations}$${b64(sel)}$${b64(cle)}`;
}

async function deriver(motDePasse, sel, iterations) {
  const materiau = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(motDePasse), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sel, iterations, hash: 'SHA-256' }, materiau, 256);
}

export async function verifierMotDePasse(motDePasse, stocke) {
  if (!stocke || typeof stocke !== 'string') return false;
  const parts = stocke.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[2], 10);
  if (!iterations || iterations < 1000) return false;
  const attendu = unb64(parts[4]);
  const calcule = new Uint8Array(await deriver(motDePasse, unb64(parts[3]), iterations));
  if (calcule.length !== attendu.length) return false;
  let diff = 0;
  for (let i = 0; i < calcule.length; i++) diff |= calcule[i] ^ attendu[i];
  return diff === 0;
}

// ---------------------------------------------------------------------
// Sessions — cookies signés HMAC-SHA256 (sans état côté serveur) :
// valeur = base64url(JSON) + '.' + base64url(HMAC). Le secret vient de
// l'environnement (UPCI_SESSION_SECRET) ou, à défaut, de l'empreinte
// du mot de passe admin / de la clé de clôture.
// ---------------------------------------------------------------------

const b64url = (buf) => b64VersUrl(b64(buf));

async function hmac(secret, message) {
  const cle = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(message));
}

export async function signerSession(secret, donnees, dureeHeures = 12) {
  const charge = { ...donnees, exp: Date.now() + dureeHeures * 3600000 };
  const corps = b64url(new TextEncoder().encode(JSON.stringify(charge)));
  return `${corps}.${b64url(await hmac(secret, corps))}`;
}

export async function verifierSession(secret, valeur) {
  if (!valeur || !secret) return null;
  const idx = valeur.lastIndexOf('.');
  if (idx < 0) return null;
  const corps = valeur.slice(0, idx);
  const sig = valeur.slice(idx + 1);
  const attendu = b64url(await hmac(secret, corps));
  if (sig.length !== attendu.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ attendu.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const charge = JSON.parse(new TextDecoder().decode(unb64(b64DepuisUrl(corps))));
    if (!charge.exp || charge.exp < Date.now()) return null;
    return charge;
  } catch {
    return null;
  }
}

/** Lit les cookies d'une requête Web-standard. */
export function lireCookies(request) {
  const brut = request.headers.get('cookie') || '';
  const out = {};
  for (const morceau of brut.split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0) out[morceau.slice(0, i).trim()] = decodeURIComponent(morceau.slice(i + 1).trim());
  }
  return out;
}

/** En-tête Set-Cookie pour une session (Secure ajouté si HTTPS). */
export function enteteCookie(request, nom, valeur, { effacer = false } = {}) {
  const https = new URL(request.url).protocol === 'https:';
  const attrs = [`${nom}=${encodeURIComponent(valeur)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (effacer) attrs.push('Max-Age=0');
  else attrs.push(`Max-Age=${12 * 3600}`);
  if (https) attrs.push('Secure');
  return attrs.join('; ');
}

/** Un signalement est-il « ouvert » (non clôturé) ? */
export const estOuvert = (sig) => !sig.date_cloture;

/** Adresse email plausible (validation simple, comme filter_var allégé). */
export const emailValide = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
