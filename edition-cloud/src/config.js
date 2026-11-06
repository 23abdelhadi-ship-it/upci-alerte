/**
 * Configuration — valeurs par défaut (miroir de config.php de l'édition
 * PHP) + surcharges d'amorçage par l'environnement.
 *
 * IMPORTANT (interface de réglages) : les réglages gérés par la page
 * /installation puis /admin/reglages (établissement, polycliniques,
 * emails, Telegram, seuils, mot de passe admin, clé de clôture) vivent
 * dans la TABLE « reglages » de la base et sont appliqués AU MOMENT de
 * l'exécution par src/settings.js — ils priment sur ce fichier.
 * Ce fichier ne contient donc plus que : (1) les listes fermées du
 * formulaire non exposées dans l'interface, (2) des valeurs par défaut
 * PLACEHOLDER, (3) l'amorçage plateforme (secret de session, accès base).
 * Aucun secret réel ici — jamais.
 */
export const configParDefaut = {
  // --- Établissement (défauts, remplacés par les réglages en base) ---
  etablissement: 'EPSP — NOM DE L’ÉTABLISSEMENT',
  wilaya: 'Wilaya',
  timezone: 'Africa/Algiers',

  // URL publique de l'application (liens emails / affiches). Vide = origine de la requête.
  base_url: '',

  // --- Listes fermées du formulaire (miroir de l'édition PHP) --------
  // EXEMPLE : les 9 polycliniques de l'EPSP de Saïda — la liste réelle
  // se règle dans l'interface (un site par ligne) et vit en base.
  sites: [
    'السلام 2', 'الرباحية', '1000 سكن', 'الشمال «لامارين»', 'سيدي قاسم',
    'سيدي الشيخ', 'النصر', 'عمروس', '1200 سكن',
  ],
  services: [
    'Urgences', 'Consultations', 'Laboratoire', 'Radiologie', 'Maternité',
    'Pharmacie', 'Stérilisation centrale', 'Soins', 'Administration', 'Autre',
  ],
  lieux: [
    'Entrée du service', 'Salle de soins', 'Salle d’attente', 'Local déchets',
    'Magasin / stockage', 'Sanitaires', 'Couloir', 'Bureau', 'Autre',
  ],
  periodes: ['Matin', 'Soir', 'Nuit'],
  types_urgence: [
    'Rupture de stock (savon / solution hydro-alcoolique)',
    'Tri incorrect des déchets (DASRI)',
    'Panne d’équipement (stérilisateur, autoclave…)',
    'Piqûre / AES (accident d’exposition au sang)',
    'Hygiène des mains non respectée',
    'Pack / matériel non stérile',
    'Problème d’eau ou d’assainissement',
    'Autre incident PCI',
  ],
  actions_immediates: ['Oui, totalement', 'Oui, partiellement', 'Non'],
  mesures: [
    'Nettoyage / désinfection immédiate',
    'Produit remplacé',
    'Équipement mis hors service',
    'Zone isolée ou signalée',
    'Responsable informé',
    'Aucune mesure possible',
  ],
  delais_souhaites: ['Immédiat', 'Aujourd’hui même', 'Sous 24 h', 'Sous 48 h'],
  delais_reels: ['Moins d’1 heure', '1 à 4 heures', '4 à 24 heures', 'Plus de 24 heures'],
  statuts_cloture: ['Clôturé', 'Partiellement résolu', 'En cours de traitement', 'Non résolu — à escalader'],

  sites_exempts: [],

  // --- Règles d'escalade (seuil/relance/escalade réglables en base) --
  seuil_critique: 4,          // gravité >= seuil → critique
  sla_relance_h: 1,           // relance si critique ouvert > N h
  sla_escalade_h: 4,          // escalade si critique ouvert > N h
  sla_accuse_h: 1,            // rappel « non pris en charge » (critique sans accusé)
  verif_efficacite_jours: 7,  // rappel vérification d'efficacité après clôture
  seuil_groupe: 3,            // >= N signalements même type + même site…
  fenetre_groupe_jours: 7,    // …dans cette fenêtre → « Regroupement suspecté »
  silence_semaines: 3,        // semaines sans signalement = site silencieux

  // --- Destinataires (défauts, remplacés par les réglages en base) ---
  emails_alertes: ['chef-upci@exemple.dz', 'admin@exemple.dz'],
  emails_bulletin: [],        // vide = emails_alertes
  mail_from: 'upci@exemple.dz',

  // --- Courriel via API HTTPS (optionnel) ------------------------------
  // Sans service configuré, l'envoi courriel est ignoré proprement
  // (journalisé) : Telegram reste le canal d'alerte principal, comme
  // dans les éditions précédentes. Voir INSTALL.md § courriel.
  mail_api_url: '',           // ex. https://api.resend.com/emails
  mail_api_key: '',           // clé Bearer — env UPCI_MAIL_API_KEY

  // --- Telegram (réglages en base ; amorçage possible par env) --------
  telegram_token: '',
  telegram_chat_ids: [],
  telegram_webhook_secret: '',
  accuse_telegram: true,      // bouton « ✅ Pris en charge » sur l'alerte

  // --- Accès protégés (réglages en base ; amorçage par env) -----------
  closure_key: '',            // vide/placeholder = page de clôture verrouillée
  admin_password_hash: '',    // vide = zone admin verrouillée
  session_secret: '',         // env UPCI_SESSION_SECRET (amorçage plateforme)
  cron_key: '',               // env UPCI_CRON_KEY (Node : endpoint /cron protégé)

  // Chemin de la base SQLite (Node uniquement ; ignoré sous Workers/D1).
  db_path: 'data/upci.sqlite',
};

/**
 * Construit la configuration d'exécution : défauts + surcharges
 * d'environnement (amorçage plateforme uniquement — les réglages
 * métier en base sont appliqués ensuite par settings.js).
 * `env` = objet Workers env ou process.env sous Node.
 */
export function construireConfig(env = {}) {
  const cfg = structuredClone(configParDefaut);
  const texte = (cle) => {
    const v = env[cle];
    return typeof v === 'string' && v !== '' ? v : null;
  };
  const liste = (cle) => {
    const v = texte(cle);
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null;
  };
  const affecte = (champ, valeur) => { if (valeur !== null) cfg[champ] = valeur; };

  affecte('etablissement', texte('UPCI_ETABLISSEMENT'));
  affecte('wilaya', texte('UPCI_WILAYA'));
  affecte('base_url', texte('UPCI_BASE_URL'));
  affecte('telegram_token', texte('UPCI_TELEGRAM_TOKEN'));
  affecte('telegram_webhook_secret', texte('UPCI_TELEGRAM_SECRET'));
  affecte('telegram_chat_ids', liste('UPCI_TELEGRAM_CHATS'));
  affecte('emails_alertes', liste('UPCI_EMAILS_ALERTES'));
  affecte('mail_from', texte('UPCI_MAIL_FROM'));
  affecte('mail_api_url', texte('UPCI_MAIL_API_URL'));
  affecte('mail_api_key', texte('UPCI_MAIL_API_KEY'));
  affecte('closure_key', texte('UPCI_CLOSURE_KEY'));
  affecte('admin_password_hash', texte('UPCI_ADMIN_HASH'));
  affecte('session_secret', texte('UPCI_SESSION_SECRET'));
  affecte('cron_key', texte('UPCI_CRON_KEY'));
  affecte('db_path', texte('UPCI_DB_PATH'));
  return cfg;
}
