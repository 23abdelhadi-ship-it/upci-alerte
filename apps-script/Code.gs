/**
 * =====================================================================
 * SYSTÈME UPCI — EPSP DE SAÏDA  •  VERSION 5.0 (édition publiée améliorée)
 * NOTE : l'EPSP de Saïda continue d'exploiter la V3.0 en production.
 * La V5.0 est l'édition améliorée publiée sur GitHub (dépôt upci-alert-system),
 * destinée aux nouvelles installations et à la généralisation.
 * Nouveautés V5.0 (par rapport à V4.0) :
 *  1. BOUCLE D'APPRENTISSAGE des cas critiques : la clôture d'un cas
 *     critique (gravité ≥ seuil) saisit l'« Action corrective » puis la
 *     « Vérification d'efficacité » (colonnes ajoutées EN FIN de registre) ;
 *     le contrôle périodique relance tant que la vérification est en attente.
 *  2. JOURNAL D'AUDIT : feuille « Journal » en ajout seul (append-only) —
 *     chaque changement d'état y est consigné (création, accusé, relance,
 *     escalade, clôture, réouverture…) avec horodatage, numéro et acteur.
 *  3. MODE DÉMO : genererDonneesDemo() crée des signalements marqués
 *     « DÉMO » (aucune notification réelle, exclus des indicateurs) ;
 *     supprimerDonneesDemo() supprime exactement ces lignes.
 *  4. RÈGLE DE REGROUPEMENT : ≥ SEUIL_GROUPE signalements de même type
 *     et même polyclinique en 7 jours → alerte « Regroupement suspecté »
 *     (au plus une par regroupement et par semaine).
 *  5. BILAN CLIN en PDF : le rapport mensuel est aussi produit en PDF
 *     (DocumentApp → PDF), joint à l'email et archivé dans Drive.
 *  6. ACCUSÉ TELEGRAM (P1) : le message d'alerte porte un bouton
 *     « ✅ Pris en charge » ; le doPost traite le callback_query, remplit
 *     « Pris en charge le » / « Accusé par », met à jour le message, et
 *     l'escalade des critiques tient compte de l'absence d'accusé.
 *  7. MONITEUR DE SILENCE (P8) : contrôle hebdomadaire — un site sans
 *     aucun signalement depuis SILENCE_SEMAINES semaines est signalé
 *     à l'administrateur (le silence est une donnée, pas un succès).
 *  8. BULLETIN MENSUEL (P7) : « Vous avez signalé → nous avons changé »,
 *     construit des clôtures du mois écoulé, envoyé à EMAILS_BULLETIN.
 *  9. BATTEMENT DE CŒUR (P14) : contrôle de santé hebdomadaire
 *     (déclencheurs, dernier signalement, registre, sauvegarde récente)
 *     — une ligne OK/alerte à l'administrateur, consignée au Journal.
 * Nouveautés V4.0 (par rapport à V3.0) :
 *  A. Notification du DÉCLARANT à la clôture : son email est conservé au
 *     registre (colonne « Email déclarant », usage interne) et il reçoit
 *     « traité et clôturé » avec le résumé de l'intervention.
 *  B. Accusé de réception enrichi : numéro + lien de suivi public.
 *  C. Page de SUIVI publique (Web App, doGet) : le déclarant saisit son
 *     numéro ET sa polyclinique → statut uniquement (aucune donnée sensible).
 *  D. CONFIGURATION par feuille : une feuille « Configuration » (clé/valeur)
 *     du classeur registre peut surcharger SEUIL_CRITIQUE, SLA et EMAILS —
 *     déployer = remplir un tableau, sans toucher au code.
 *  E. SAUVEGARDE hebdomadaire automatique du registre (CSV horodaté dans
 *     le dossier Drive « Sauvegardes UPCI »).
 * Chaîne d'alerte numérique PCI : Signalement → Alerte → Clôture → Bilan
 * ---------------------------------------------------------------------
 * Nouveautés V3.0 (par rapport à V2.2) :
 *  1. Numérotation SÉQUENTIELLE et auditable : UPCI-2026-0001, 0002...
 *     (verrou anti-collision — remplace l'UUID aléatoire)
 *  2. La CLÔTURE met à jour la ligne du signalement au registre
 *     (statut, intervention, date de clôture, durée calculée) au lieu
 *     d'ajouter une ligne séparée → taux de clôture enfin mesurable.
 *  3. ESCALADE automatique : tout signalement CRITIQUE non clôturé
 *     après 1 h déclenche une relance ; après 4 h, une escalade marquée.
 *  4. RAPPORT MENSUEL automatique pour le CLIN (indicateurs du Doc 3 :
 *     volume, % critiques, % clôturés, délai moyen de clôture).
 *  5. Secrets HORS du code : jeton Telegram et paramètres sensibles
 *     dans les « Script Properties » (voir fonction configurer()).
 *  6. Correspondance des champs INSENSIBLE aux accents/casse et tolère
 *     les petites modifications de titres dans les formulaires.
 *  7. Anti-doublon (même réponse renvoyée sous 3 minutes = ignorée).
 *  8. Alerte administrateur automatique en cas d'erreur d'exécution.
 *  9. Bot Telegram BIDIRECTIONNEL (optionnel, via Web App) :
 *     /stats — synthèse ; /critiques — critiques ouverts ; /aide.
 * 10. Notifications enrichies (HTML Telegram, lien direct au registre).
 *
 * Compatibilité : mêmes noms de fonctions de déclenchement que V2.2
 * (onFormSubmit) → les triggers existants continuent de fonctionner.
 * Après collage du code : exécuter configurer() UNE fois, puis
 * installerTriggers() UNE fois. Voir le guide de déploiement joint.
 * =====================================================================
 */

// ---------------------------------------------------------------------
// 0. CONFIGURATION — valeurs non sensibles uniquement.
//    Les secrets (jeton Telegram) vivent dans les Script Properties,
//    posés par configurer(). Les valeurs ci-dessous servent de repli.
// ---------------------------------------------------------------------
const CONFIG = {
  EMAILS: ["chef-upci@exemple.dz", "admin@exemple.dz"], // destinataires des alertes
  ADMIN_EMAIL: "admin@exemple.dz",                     // alertes d'erreur technique
  TELEGRAM_CHAT_IDS: ["VOTRE_CHAT_ID"],                       // ajouter ici l'ID d'un GROUPE UPCI si créé
  FORM_SIGNAL_ID: "",           // rempli par setupNouveauSysteme() dans les Script Properties
  FORM_CLOTURE_ID: "",          // ⚠️ ID du formulaire de clôture (à renseigner s'il existe)
  REGISTRE_ID: "",              // optionnel : ID d'un classeur registre dédié (vide = destination du formulaire)
  SEUIL_CRITIQUE: 4,            // gravité >= 4 → critique
  SLA_CRITIQUE_HEURES: 1,       // relance si critique ouvert > 1 h
  SLA_ESCALADE_HEURES: 4,       // escalade si critique ouvert > 4 h
  NOTIFIER_DECLARANT: true,     // V4 : email au déclarant à la clôture
  DOSSIER_SAUVEGARDE: "Sauvegardes UPCI", // V4 : dossier Drive des CSV hebdomadaires
  // --- V5 ---
  JOURNAL_ACTIF: true,          // V5 : feuille « Journal » (audit, ajout seul)
  ACCUSE_TELEGRAM: true,        // V5 : bouton « ✅ Pris en charge » sur l'alerte Telegram
  REGROUPEMENT_ACTIF: true,     // V5 : règle de regroupement (cluster)
  SEUIL_GROUPE: 3,              // V5 : nb de signalements même type + même site…
  FENETRE_GROUPE_JOURS: 7,      // V5 : …dans cette fenêtre (jours) → alerte groupée
  VERIF_EFFICACITE_JOURS: 7,    // V5 : rappel « vérification d'efficacité » N jours après la clôture d'un critique
  SILENCE_ACTIF: true,          // V5 : moniteur de silence des sites
  SILENCE_SEMAINES: 3,          // V5 : semaines sans signalement = site silencieux
  BULLETIN_ACTIF: true,         // V5 : bulletin « Vous avez signalé → nous avons changé »
  RAPPORT_PDF: true,            // V5 : bilan CLIN mensuel aussi en PDF
  DOSSIER_RAPPORTS: "Rapports UPCI", // V5 : dossier Drive des PDF de bilans
  SANTE_ACTIF: true,            // V5 : battement de cœur hebdomadaire
  TZ: "Africa/Algiers"
};

// V4/V5 — Surcharge optionnelle par la feuille « Configuration » du classeur
// registre (colonnes : Clé | Valeur). Clés reconnues : SEUIL_CRITIQUE,
// SLA_CRITIQUE_HEURES, SLA_ESCALADE_HEURES, EMAILS (séparés par des virgules) ;
// V5 : SEUIL_GROUPE, SILENCE_SEMAINES, EMAILS_BULLETIN, SITES, SITES_EXEMPTS,
// et interrupteurs OUI/NON : JOURNAL_ACTIF, ACCUSE_TELEGRAM, REGROUPEMENT_ACTIF,
// SILENCE_ACTIF, BULLETIN_ACTIF, RAPPORT_PDF, SANTE_ACTIF.
let EMAILS_SURCHARGE_ = null;
let EMAILS_BULLETIN_ = null;
let SITES_ = null;
let SITES_EXEMPTS_ = null;
const CLES_BOOLEENNES_ = ["JOURNAL_ACTIF", "ACCUSE_TELEGRAM", "REGROUPEMENT_ACTIF",
  "SILENCE_ACTIF", "BULLETIN_ACTIF", "RAPPORT_PDF", "SANTE_ACTIF"];
function appliquerConfigFeuille_() {
  try {
    const ss = classeurRegistre_(); if (!ss) return;
    const f = ss.getSheetByName("Configuration"); if (!f) return;
    const vals = f.getDataRange().getValues();
    for (let i = 0; i < vals.length; i++) {
      const cle = String(vals[i][0] || "").trim().toUpperCase();
      const v = String(vals[i][1] || "").trim();
      if (!cle || !v) continue;
      if (cle === "SEUIL_CRITIQUE" && parseInt(v, 10)) CONFIG.SEUIL_CRITIQUE = parseInt(v, 10);
      if (cle === "SLA_CRITIQUE_HEURES" && parseFloat(v)) CONFIG.SLA_CRITIQUE_HEURES = parseFloat(v);
      if (cle === "SLA_ESCALADE_HEURES" && parseFloat(v)) CONFIG.SLA_ESCALADE_HEURES = parseFloat(v);
      if (cle === "EMAILS") EMAILS_SURCHARGE_ = v.split(",").map(s => s.trim()).filter(String);
      // V5
      if (cle === "SEUIL_GROUPE" && parseInt(v, 10)) CONFIG.SEUIL_GROUPE = parseInt(v, 10);
      if (cle === "SILENCE_SEMAINES" && parseInt(v, 10)) CONFIG.SILENCE_SEMAINES = parseInt(v, 10);
      if (cle === "EMAILS_BULLETIN") EMAILS_BULLETIN_ = v.split(",").map(s => s.trim()).filter(String);
      if (cle === "SITES") SITES_ = v.split(",").map(s => s.trim()).filter(String);
      if (cle === "SITES_EXEMPTS") SITES_EXEMPTS_ = v.split(",").map(s => s.trim()).filter(String);
      if (CLES_BOOLEENNES_.indexOf(cle) > -1)
        CONFIG[cle] = ["OUI", "TRUE", "1", "VRAI", "YES"].indexOf(v.toUpperCase()) > -1;
    }
  } catch (e) { console.log("⚠️ Configuration feuille : " + e.message); }
}

const PROPS = PropertiesService.getScriptProperties();

function prop_(cle, repli) {
  const v = PROPS.getProperty(cle);
  return (v === null || v === "") ? repli : v;
}
function telegramToken_() { return prop_("TELEGRAM_TOKEN", ""); }
function telegramChats_() {
  const v = prop_("TELEGRAM_CHAT_IDS", "");
  return v ? v.split(",").map(s => s.trim()).filter(String) : CONFIG.TELEGRAM_CHAT_IDS;
}
function emails_() {
  if (EMAILS_SURCHARGE_ && EMAILS_SURCHARGE_.length) return EMAILS_SURCHARGE_;
  const v = prop_("EMAILS", "");
  return v ? v.split(",").map(s => s.trim()).filter(String) : CONFIG.EMAILS;
}
// V5 : destinataires du bulletin mensuel (clé EMAILS_BULLETIN de la feuille
// « Configuration ») ; repli sur les destinataires d'alerte.
function emailsBulletin_() {
  return (EMAILS_BULLETIN_ && EMAILS_BULLETIN_.length) ? EMAILS_BULLETIN_ : emails_();
}

// Identifiants des ressources : lus depuis les Script Properties
// (posés automatiquement par setupNouveauSysteme() lors de la reconstruction),
// avec repli sur les constantes CONFIG ci-dessus.
function formSignalId_()  { return prop_("FORM_SIGNAL_ID", CONFIG.FORM_SIGNAL_ID); }
function formClotureId_() { return prop_("FORM_CLOTURE_ID", CONFIG.FORM_CLOTURE_ID); }
function registreId_()    { return prop_("REGISTRE_ID", CONFIG.REGISTRE_ID); }

/**
 * À EXÉCUTER UNE SEULE FOIS après collage du code :
 * renseigne le jeton du bot (ne JAMAIS le remettre dans le code),
 * puis lance installerTriggers().
 * ⚠️ Le jeton V2.2 ayant circulé dans un fichier, il est recommandé
 * de le RÉVOQUER d'abord dans @BotFather (/revoke) et d'en générer
 * un nouveau à coller ci-dessous.
 */
function configurer() {
  PROPS.setProperties({
    TELEGRAM_TOKEN: "COLLER_ICI_LE_NOUVEAU_JETON_BOTFATHER",
    TELEGRAM_CHAT_IDS: CONFIG.TELEGRAM_CHAT_IDS.join(","),
    EMAILS: CONFIG.EMAILS.join(",")
  }, false);
  console.log("✅ Configuration enregistrée dans les Script Properties.");
  console.log("Pensez à SUPPRIMER le jeton de ce fichier après exécution (remplacez-le par un texte vide).");
}

// ---------------------------------------------------------------------
// 1. INSTALLATION / MAINTENANCE DES DÉCLENCHEURS
// ---------------------------------------------------------------------
function installerTriggers() {
  const handlers = ["onFormSubmit", "verifierCritiquesEnAttente", "rapportMensuel", "sauvegardeHebdomadaire",
    "controleSilenceSites", "bulletinMensuel", "controleSanteHebdomadaire"];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (handlers.indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  try {
    const formSignal = FormApp.openById(formSignalId_());
    ScriptApp.newTrigger("onFormSubmit").forForm(formSignal).onFormSubmit().create();
    if (formClotureId_()) {
      const formCloture = FormApp.openById(formClotureId_());
      ScriptApp.newTrigger("onFormSubmit").forForm(formCloture).onFormSubmit().create();
    }
    // Escalade SLA : contrôle toutes les 30 minutes
    ScriptApp.newTrigger("verifierCritiquesEnAttente").timeBased().everyMinutes(30).create();
    // Rapport mensuel CLIN : le 1er du mois à 8 h
    ScriptApp.newTrigger("rapportMensuel").timeBased().onMonthDay(1).atHour(8).create();
    // V4 : sauvegarde hebdomadaire du registre (dimanche 7 h)
    ScriptApp.newTrigger("sauvegardeHebdomadaire").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
    // V5 : battement de cœur hebdomadaire (dimanche 8 h, après la sauvegarde)
    ScriptApp.newTrigger("controleSanteHebdomadaire").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(8).create();
    // V5 : moniteur de silence des sites (lundi 8 h)
    ScriptApp.newTrigger("controleSilenceSites").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
    // V5 : bulletin « Vous avez signalé → nous avons changé » (le 1er du mois à 9 h, après le bilan CLIN)
    ScriptApp.newTrigger("bulletinMensuel").timeBased().onMonthDay(1).atHour(9).create();
    console.log("✅ Déclencheurs installés : formulaires + escalade (30 min) + rapport mensuel + sauvegarde hebdomadaire + santé (dim. 8 h) + silence (lun. 8 h) + bulletin mensuel.");
    afficherLiens();
  } catch (e) {
    console.log("❌ Échec de l'installation : " + e.message);
    alerterAdmin_("Échec installerTriggers", e);
  }
}

function afficherLiens() {
  try {
    const formSignal = FormApp.openById(formSignalId_());
    console.log("🔗 Formulaire SIGNALEMENT : " + formSignal.getPublishedUrl());
    const ss = classeurRegistre_();
    if (ss) console.log("📊 Registre : " + ss.getUrl());
    if (formClotureId_()) {
      console.log("🔒 Formulaire CLÔTURE : " + FormApp.openById(formClotureId_()).getPublishedUrl());
    }
  } catch (e) { console.log("❌ afficherLiens : " + e.message); }
}

// ---------------------------------------------------------------------
// 2. ACCÈS AU REGISTRE « Suivi UPCI » (schéma V3, migration douce)
// ---------------------------------------------------------------------
const ENTETES_SUIVI = ["Date", "Numéro", "Type", "Polyclinique", "Service", "Gravité",
  "Délai demandé", "Mesures", "Statut", "Intervention", "Délai réel",
  "Date clôture", "Durée (h)", "Relance 1h", "Escalade 4h", "Email déclarant",
  // V5 — colonnes ajoutées STRICTEMENT À LA FIN : la migration de feuilleSuivi_()
  // les écrit aux positions suivantes sans déplacer aucune colonne existante.
  "Action corrective", "Vérification d'efficacité", "Pris en charge le",
  "Accusé par", "Relance accusé", "Msg Telegram", "Relance vérification"];

/** V5 : un signalement est « démo » si son numéro porte le préfixe DÉMO. */
function estDemo_(numero) { return String(numero || "").indexOf("DÉMO") === 0; }

function classeurRegistre_() {
  if (registreId_()) return SpreadsheetApp.openById(registreId_());
  const dest = FormApp.openById(formSignalId_()).getDestinationId();
  return dest ? SpreadsheetApp.openById(dest) : null;
}

function feuilleSuivi_() {
  const ss = classeurRegistre_();
  if (!ss) return null;
  let sheet = ss.getSheetByName("Suivi UPCI");
  if (!sheet) {
    sheet = ss.insertSheet("Suivi UPCI");
    sheet.appendRow(ENTETES_SUIVI);
    sheet.getRange(1, 1, 1, ENTETES_SUIVI.length).setFontWeight("bold").setBackground("#d9ead3");
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Migration V2 → V3 : ajoute les colonnes manquantes sans rien effacer
  const actuel = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  ENTETES_SUIVI.forEach((h, i) => {
    if (actuel.indexOf(h) === -1) {
      sheet.getRange(1, i + 1).setValue(h).setFontWeight("bold").setBackground("#d9ead3");
    }
  });
  return sheet;
}

function colIndex_(sheet, nom) {
  const entetes = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  return entetes.indexOf(nom) + 1; // 1-based, 0 si absent
}

// ---------------------------------------------------------------------
// 3. LECTURE DES RÉPONSES — correspondance tolérante (accents/casse)
// ---------------------------------------------------------------------
function normaliser_(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function convertirReponses(e) {
  const nv = {};
  e.response.getItemResponses().forEach(ir => {
    const valeur = ir.getResponse();
    nv[ir.getItem().getTitle()] = Array.isArray(valeur) ? valeur : [String(valeur ?? "")];
  });
  return nv;
}

/** Comme champ_ mais joint TOUTES les valeurs (questions à cases à cocher). */
function champMulti_(nv, motifs) {
  const cles = Object.keys(nv);
  for (const m of motifs) {
    const motif = normaliser_(m);
    const cle = cles.find(c => normaliser_(c).indexOf(motif) > -1);
    if (cle && nv[cle]) return nv[cle].map(String).join(", ");
  }
  return "-";
}

/** Cherche une valeur dont le titre normalisé CONTIENT l'un des motifs. */
function champ_(nv, motifs) {
  const cles = Object.keys(nv);
  for (const m of motifs) {
    const motif = normaliser_(m);
    const cle = cles.find(c => normaliser_(c).indexOf(motif) > -1);
    if (cle && nv[cle] && nv[cle][0] !== undefined) return String(nv[cle][0]).trim();
  }
  return "-";
}

// ---------------------------------------------------------------------
// 4. NUMÉROTATION SÉQUENTIELLE (verrouillée, auditable)
// ---------------------------------------------------------------------
function nouveauNumero_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const annee = Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy");
    const cle = "COMPTEUR_" + annee;
    const n = (parseInt(PROPS.getProperty(cle) || "0", 10) || 0) + 1;
    PROPS.setProperty(cle, String(n));
    return "UPCI-" + annee + "-" + ("0000" + n).slice(-4);
  } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------------
// 5. ROUTEUR PRINCIPAL (déclencheur formulaires) + anti-doublon
// ---------------------------------------------------------------------
function onFormSubmit(e) {
  if (!e || !e.response) { console.log("⚠️ Déclencheur : ne pas exécuter manuellement."); return; }
  appliquerConfigFeuille_();
  try {
    const nv = convertirReponses(e);
    // Anti-doublon : même formulaire + mêmes réponses sous 3 minutes
    const empreinte = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,
      e.source.getId() + JSON.stringify(nv)).map(b => (b + 256).toString(16).slice(-2)).join("");
    const cache = CacheService.getScriptCache();
    if (cache.get("dup_" + empreinte)) { console.log("↩️ Doublon ignoré."); return; }
    cache.put("dup_" + empreinte, "1", 180);

    const formId = e.source.getId();
    if (formId === formSignalId_()) traiterSignalement(nv, e.response);
    else if (formClotureId_() && formId === formClotureId_()) traiterCloture(nv);
    else console.log("⚠️ Formulaire non reconnu : " + formId);
  } catch (err) {
    console.log("❌ ERREUR ROUTEUR : " + err.message);
    alerterAdmin_("Erreur onFormSubmit", err);
  }
}

// ---------------------------------------------------------------------
// 6. TRAITEMENT — SIGNALEMENT
// ---------------------------------------------------------------------
function traiterSignalement(nv, response) {
  const numero = nouveauNumero_();
  const poly    = champ_(nv, ["polyclinique"]);
  const service = champ_(nv, ["service ou unité", "service"]);
  const graviteTxt = champ_(nv, ["gravité", "gravite"]);
  const gravite = parseInt(graviteTxt, 10) || 0;
  const delai   = champ_(nv, ["délai d'intervention souhaité", "delai souhaite", "souhaité"]);
  const typesUrg  = champMulti_(nv, ["type d'urgence"]);
  const actionImm = champ_(nv, ["agi immédiatement", "avez-vous agi"]);
  const mesures   = champMulti_(nv, ["mesures"]);

  const critique = (gravite >= CONFIG.SEUIL_CRITIQUE) || normaliser_(delai).indexOf("imm") > -1;
  const sujet = (critique ? "🚨🚨 URGENCE CRITIQUE — " : "Nouveau signalement — ") + numero;
  const corps = [
    critique ? "🚨🚨 SIGNALEMENT CRITIQUE 🚨🚨" : "Nouveau signalement PCI",
    "N° : " + numero,
    "Polyclinique : " + poly,
    "Service : " + service,
    "Type : " + typesUrg,
    "Gravité : " + gravite + (gravite ? "/5" : ""),
    "Délai demandé : " + delai,
    "Action immédiate : " + actionImm,
    "Mesures : " + mesures
  ].join("\n");

  // V4 : email du déclarant (s'il est collecté) — conservé au registre
  // pour la notification de clôture. Tolère l'absence (formulaire sans collecte).
  let emailDecl = "";
  try { emailDecl = response.getRespondentEmail() || ""; } catch (err) { emailDecl = ""; }

  // Emails : inchangés. Telegram : V5 envoie l'alerte AVEC le bouton
  // « ✅ Pris en charge » et conserve les références des messages envoyés
  // (chat_id:message_id) pour pouvoir les mettre à jour lors de l'accusé.
  emails_().forEach(email => envoyerMail(email, sujet, corps));
  let msgTelegram = "";
  if (CONFIG.ACCUSE_TELEGRAM) {
    msgTelegram = envoyerTelegramAlerte_(sujet, corps, numero);
    if (!msgTelegram) envoyerTelegram("<b>" + echapperHtml_(sujet) + "</b>\n\n" + echapperHtml_(corps) + lienRegistre_());
  } else {
    envoyerTelegram("<b>" + echapperHtml_(sujet) + "</b>\n\n" + echapperHtml_(corps) + lienRegistre_());
  }
  enregistrerSignalement_({
    numero: numero, poly: poly, service: service, gravite: gravite,
    delai: delai, mesures: mesures, emailDecl: emailDecl, msgTelegram: msgTelegram,
    statut: critique ? "CRITIQUE - En attente" : "En attente"
  });
  journaliser_(numero, emailDecl || "Déclarant (formulaire)", "création",
    poly + " — " + service + " — gravité " + gravite);

  if (emailDecl) {
    const urlSuivi = prop_("WEBAPP_URL", "");
    envoyerMail(emailDecl, "Accusé de réception — " + numero, [
      "Votre signalement a été enregistré.",
      "N° : " + numero,
      "Polyclinique : " + poly,
      urlSuivi ? ("Suivi de l'état : " + urlSuivi + " — saisissez votre numéro ET la polyclinique.") : "",
      "Vous recevrez un nouvel email lorsque le signalement sera traité et clôturé."
    ].filter(String).join("\n"));
  }
}

function enregistrerSignalement_(d) {
  const sheet = feuilleSuivi_(); if (!sheet) return;
  const ligne = [];
  ligne[colIndex_(sheet, "Date") - 1] = new Date();
  ligne[colIndex_(sheet, "Numéro") - 1] = d.numero;
  ligne[colIndex_(sheet, "Type") - 1] = "Signalement";
  ligne[colIndex_(sheet, "Polyclinique") - 1] = d.poly;
  ligne[colIndex_(sheet, "Service") - 1] = d.service;
  ligne[colIndex_(sheet, "Gravité") - 1] = d.gravite;
  ligne[colIndex_(sheet, "Délai demandé") - 1] = d.delai;
  ligne[colIndex_(sheet, "Mesures") - 1] = d.mesures;
  ligne[colIndex_(sheet, "Statut") - 1] = d.statut;
  ligne[colIndex_(sheet, "Email déclarant") - 1] = d.emailDecl || "";
  ligne[colIndex_(sheet, "Msg Telegram") - 1] = d.msgTelegram || "";
  sheet.appendRow(ligne.map(v => v === undefined ? "" : v));
}

// ---------------------------------------------------------------------
// 7. TRAITEMENT — CLÔTURE (met à jour la ligne du signalement)
// ---------------------------------------------------------------------
function traiterCloture(nv) {
  const numero       = champ_(nv, ["numéro du signalement", "numero du signalement"]);
  const intervention = champ_(nv, ["intervention réalisée", "intervention realisee"]);
  const statutForm   = champ_(nv, ["statut de clôture", "statut"]);
  const delaiReelTxt = champ_(nv, ["délai réel", "delai reel"]);
  // V5 — boucle d'apprentissage (cas critiques) : champs optionnels du
  // formulaire de clôture ; absents des anciens formulaires → ignorés.
  const actionCorrective = champ_(nv, ["action corrective"]);
  const verifEfficacite  = champ_(nv, ["vérification d'efficacité", "verification d'efficacite", "efficacité"]);

  const sheet = feuilleSuivi_();
  let trouve = false, dureeH = "", emailDeclLigne = "", polyLigne = "";
  let dejaFerme = false, verifSeule = false, estCritiqueLigne = false;
  if (sheet && numero && numero !== "-") {
    const cNum = colIndex_(sheet, "Numéro");
    const donnees = sheet.getDataRange().getValues();
    for (let i = 1; i < donnees.length; i++) {
      if (String(donnees[i][cNum - 1]).trim() === numero) {
        trouve = true;
        dejaFerme = !!donnees[i][colIndex_(sheet, "Date clôture") - 1];
        estCritiqueLigne = (parseInt(donnees[i][colIndex_(sheet, "Gravité") - 1], 10) || 0) >= CONFIG.SEUIL_CRITIQUE;
        emailDeclLigne = String(donnees[i][colIndex_(sheet, "Email déclarant") - 1] || "");
        polyLigne = String(donnees[i][colIndex_(sheet, "Polyclinique") - 1] || "");
        // V5 : resoumission sur un dossier DÉJÀ clôturé portant seulement la
        // vérification d'efficacité → on ne touche ni au statut, ni à
        // l'intervention, ni à la date/durée de clôture d'origine.
        verifSeule = dejaFerme && verifEfficacite && verifEfficacite !== "-";
        if (verifSeule) {
          sheet.getRange(i + 1, colIndex_(sheet, "Vérification d'efficacité")).setValue(verifEfficacite);
          if (actionCorrective && actionCorrective !== "-")
            sheet.getRange(i + 1, colIndex_(sheet, "Action corrective")).setValue(actionCorrective);
          journaliser_(numero, "Formulaire clôture", "vérification", verifEfficacite);
        } else {
          const dateSignal = new Date(donnees[i][colIndex_(sheet, "Date") - 1]);
          const maintenant = new Date();
          dureeH = Math.round(((maintenant - dateSignal) / 3600000) * 10) / 10;
          sheet.getRange(i + 1, colIndex_(sheet, "Statut")).setValue(statutForm && statutForm !== "-" ? statutForm : "Clôturé");
          sheet.getRange(i + 1, colIndex_(sheet, "Intervention")).setValue(intervention);
          sheet.getRange(i + 1, colIndex_(sheet, "Délai réel")).setValue(delaiReelTxt);
          sheet.getRange(i + 1, colIndex_(sheet, "Date clôture")).setValue(maintenant);
          sheet.getRange(i + 1, colIndex_(sheet, "Durée (h)")).setValue(dureeH);
          if (actionCorrective && actionCorrective !== "-")
            sheet.getRange(i + 1, colIndex_(sheet, "Action corrective")).setValue(actionCorrective);
          if (verifEfficacite && verifEfficacite !== "-")
            sheet.getRange(i + 1, colIndex_(sheet, "Vérification d'efficacité")).setValue(verifEfficacite);
          journaliser_(numero, "Formulaire clôture", "clôture",
            (statutForm || "Clôturé") + " — " + intervention);
        }
        break;
      }
    }
  }

  const sujet = verifSeule ? ("🔍 Vérification d'efficacité — " + numero) : ("✅ Clôture — " + numero);
  const corps = [
    verifSeule ? ("Vérification d'efficacité enregistrée pour : " + numero)
               : ("Clôture enregistrée pour : " + numero),
    verifSeule ? ("Résultat : " + verifEfficacite) : ("Intervention : " + intervention),
    "Statut : " + (statutForm || "Clôturé"),
    "Délai réel : " + delaiReelTxt,
    dureeH !== "" ? ("Durée totale : " + dureeH + " h") : "",
    (actionCorrective && actionCorrective !== "-") ? ("Action corrective : " + actionCorrective) : "",
    (trouve && !verifSeule && estCritiqueLigne && (!actionCorrective || actionCorrective === "-"))
      ? "⚠️ Cas critique : pensez à renseigner l'action corrective, puis la vérification d'efficacité (formulaire de clôture)." : "",
    trouve ? "Registre mis à jour ✔" : "⚠️ Numéro introuvable au registre — vérification manuelle requise."
  ].filter(String).join("\n");
  envoyerNotifications(sujet, corps);
  if (!trouve) alerterAdmin_("Clôture orpheline", new Error("Numéro introuvable : " + numero));

  // V4 : notification de traitement au déclarant (boucle de retour fermée)
  // V5 : uniquement à la première clôture (pas lors d'une vérification seule).
  if (trouve && !verifSeule && CONFIG.NOTIFIER_DECLARANT && emailDeclLigne) {
    envoyerMail(emailDeclLigne, "Signalement traité et clôturé — " + numero, [
      "Votre signalement " + numero + (polyLigne ? " (" + polyLigne + ")" : "") + " a été traité et clôturé.",
      "Intervention : " + intervention,
      dureeH !== "" ? ("Délai de traitement : " + dureeH + " h") : "",
      "Merci pour votre vigilance — chaque signalement améliore la sécurité des soins."
    ].filter(String).join("\n"));
  }
}

// ---------------------------------------------------------------------
// 8. ESCALADE SLA — critiques ouverts trop longtemps (toutes les 30 min)
// ---------------------------------------------------------------------
function verifierCritiquesEnAttente() {
  appliquerConfigFeuille_();
  const sheet = feuilleSuivi_(); if (!sheet) return;
  const donnees = sheet.getDataRange().getValues();
  const c = nom => colIndex_(sheet, nom);
  const maintenant = new Date();
  for (let i = 1; i < donnees.length; i++) {
    const numero = String(donnees[i][c("Numéro") - 1] || "");
    if (!numero || estDemo_(numero)) continue; // V5 : les démos ne déclenchent aucune alerte réelle
    const statut = String(donnees[i][c("Statut") - 1] || "");
    const gravite = parseInt(donnees[i][c("Gravité") - 1], 10) || 0;
    const estCritique = gravite >= CONFIG.SEUIL_CRITIQUE || statut.indexOf("CRITIQUE") > -1;
    const estOuvert = !donnees[i][c("Date clôture") - 1] && statut.indexOf("Clôtur") === -1;
    if (!estCritique || !estOuvert) continue;
    const ageH = (maintenant - new Date(donnees[i][c("Date") - 1])) / 3600000;
    // V5 (P1) : relance « non pris en charge » — un critique ouvert dont
    // PERSONNE n'a accusé réception après le délai SLA est relancé une fois,
    // indépendamment des relances de clôture ci-dessous (conservées).
    const accuse = !!donnees[i][c("Pris en charge le") - 1];
    if (CONFIG.ACCUSE_TELEGRAM && !accuse && ageH >= CONFIG.SLA_CRITIQUE_HEURES && !donnees[i][c("Relance accusé") - 1]) {
      envoyerNotifications("⚠️ NON PRIS EN CHARGE — critique sans accusé depuis " + Math.round(ageH) + " h — " + numero,
        "Le signalement critique " + numero + " (" + donnees[i][c("Polyclinique") - 1] + " — " +
        donnees[i][c("Service") - 1] + ") n'a reçu AUCUN accusé de prise en charge après " + Math.round(ageH) +
        " heures.\nOuvrez l'alerte Telegram et appuyez sur « ✅ Pris en charge », ou intervenez et clôturez.");
      sheet.getRange(i + 1, c("Relance accusé")).setValue(new Date());
      journaliser_(numero, "Système (SLA)", "relance", "Aucun accusé de prise en charge après " + Math.round(ageH) + " h");
    }
    if (ageH >= CONFIG.SLA_ESCALADE_HEURES && !donnees[i][c("Escalade 4h") - 1]) {
      envoyerNotifications("⏰⏰ ESCALADE — critique non clôturé depuis " + Math.round(ageH) + " h — " + numero,
        "Le signalement critique " + numero + " (" + donnees[i][c("Polyclinique") - 1] + " — " +
        donnees[i][c("Service") - 1] + ") attend toujours une clôture après " + Math.round(ageH) + " heures.\nÉvaluation et consignation au registre requises.");
      sheet.getRange(i + 1, c("Escalade 4h")).setValue(new Date());
      journaliser_(numero, "Système (SLA)", "escalade", "Critique non clôturé après " + Math.round(ageH) + " h");
    } else if (ageH >= CONFIG.SLA_CRITIQUE_HEURES && !donnees[i][c("Relance 1h") - 1]) {
      envoyerNotifications("⏰ RAPPEL SLA — critique en attente > 1 h — " + numero,
        "Le signalement critique " + numero + " (" + donnees[i][c("Polyclinique") - 1] + " — " +
        donnees[i][c("Service") - 1] + ") n'est pas encore clôturé après plus d'une heure (protocole : évaluation < 1 h).");
      sheet.getRange(i + 1, c("Relance 1h")).setValue(new Date());
      journaliser_(numero, "Système (SLA)", "relance", "Critique non clôturé après plus d'une heure");
    }
  }
  // V5 : vérifications d'efficacité en attente + règle de regroupement
  verifierVerificationsEnAttente_(sheet, donnees, c, maintenant);
  verifierRegroupements_(sheet, donnees, c, maintenant);
}

/**
 * V5 — Boucle d'apprentissage : tout critique CLÔTURÉ depuis au moins
 * VERIF_EFFICACITE_JOURS jours sans « Vérification d'efficacité » reçoit
 * UN rappel (drapeau « Relance vérification »), jusqu'à sa saisie via le
 * formulaire de clôture.
 */
function verifierVerificationsEnAttente_(sheet, donnees, c, maintenant) {
  for (let i = 1; i < donnees.length; i++) {
    const numero = String(donnees[i][c("Numéro") - 1] || "");
    if (!numero || estDemo_(numero)) continue;
    const dClot = donnees[i][c("Date clôture") - 1];
    if (!dClot) continue;
    const gravite = parseInt(donnees[i][c("Gravité") - 1], 10) || 0;
    if (gravite < CONFIG.SEUIL_CRITIQUE) continue;
    if (String(donnees[i][c("Vérification d'efficacité") - 1] || "").trim()) continue;
    if (donnees[i][c("Relance vérification") - 1]) continue;
    const ageJ = (maintenant - new Date(dClot)) / 86400000;
    if (ageJ < CONFIG.VERIF_EFFICACITE_JOURS) continue;
    envoyerNotifications("🔍 VÉRIFICATION D'EFFICACITÉ EN ATTENTE — " + numero,
      "Le cas critique " + numero + " (" + donnees[i][c("Polyclinique") - 1] + " — " +
      donnees[i][c("Service") - 1] + ") a été clôturé il y a " + Math.floor(ageJ) + " jours.\n" +
      "Action corrective consignée : " + (String(donnees[i][c("Action corrective") - 1] || "—")) + "\n" +
      "Vérifiez sur place si le problème a réellement disparu, puis consignez le résultat via le formulaire de clôture (champ « Vérification d'efficacité »).");
    sheet.getRange(i + 1, c("Relance vérification")).setValue(new Date());
    journaliser_(numero, "Système", "relance", "Vérification d'efficacité en attente depuis " + Math.floor(ageJ) + " j");
  }
}

/**
 * V5 — Règle de regroupement (cluster) : ≥ SEUIL_GROUPE signalements de
 * même Type ET même Polyclinique dans les FENETRE_GROUPE_JOURS derniers
 * jours → UNE alerte « Regroupement suspecté » (déduplication : au plus
 * une par regroupement et par semaine calendaire, via Script Properties).
 */
function verifierRegroupements_(sheet, donnees, c, maintenant) {
  if (!CONFIG.REGROUPEMENT_ACTIF) return;
  const limite = new Date(maintenant.getTime() - CONFIG.FENETRE_GROUPE_JOURS * 86400000);
  const groupes = {};
  for (let i = 1; i < donnees.length; i++) {
    const numero = String(donnees[i][c("Numéro") - 1] || "");
    if (!numero || estDemo_(numero)) continue;
    const d = new Date(donnees[i][c("Date") - 1]);
    if (isNaN(d) || d < limite) continue;
    const cle = String(donnees[i][c("Type") - 1] || "Signalement") + " | " + String(donnees[i][c("Polyclinique") - 1] || "—");
    (groupes[cle] = groupes[cle] || []).push(numero);
  }
  const semaine = Utilities.formatDate(maintenant, CONFIG.TZ, "yyyy-'S'ww");
  Object.keys(groupes).forEach(cle => {
    const numeros = groupes[cle];
    if (numeros.length < CONFIG.SEUIL_GROUPE) return;
    const cleProp = "GROUPE_" + cle.replace(/[^\wÀ-ÿ]+/g, "_");
    if (PROPS.getProperty(cleProp) === semaine) return; // déjà alerté cette semaine
    PROPS.setProperty(cleProp, semaine);
    envoyerNotifications("🧩 REGROUPEMENT SUSPECTÉ — " + cle,
      numeros.length + " signalements du même type à la même polyclinique en " +
      CONFIG.FENETRE_GROUPE_JOURS + " jours : " + numeros.join(", ") + ".\n" +
      "Piste : cause commune ou début de cluster — examen en réunion CLIN et vigilance renforcée recommandés.");
    journaliser_(numeros[0], "Système", "regroupement", cle + " — " + numeros.length + " signalements en " +
      CONFIG.FENETRE_GROUPE_JOURS + " j : " + numeros.join(", "));
  });
}

// ---------------------------------------------------------------------
// 9. RAPPORT MENSUEL CLIN (indicateurs proposés à la tutelle — Doc 3)
// ---------------------------------------------------------------------
function rapportMensuel() {
  appliquerConfigFeuille_();
  const sheet = feuilleSuivi_(); if (!sheet) return;
  const ref = new Date(); ref.setDate(0); // dernier jour du mois écoulé
  const mois = ref.getMonth(), annee = ref.getFullYear();
  const donnees = sheet.getDataRange().getValues();
  const c = nom => colIndex_(sheet, nom);
  let total = 0, critiques = 0, clotures = 0, sommeDurees = 0, nbDurees = 0;
  const parPoly = {};
  for (let i = 1; i < donnees.length; i++) {
    const d = new Date(donnees[i][c("Date") - 1]);
    if (d.getMonth() !== mois || d.getFullYear() !== annee) continue;
    if (estDemo_(String(donnees[i][c("Numéro") - 1] || ""))) continue; // V5 : démos hors bilan officiel
    total++;
    const g = parseInt(donnees[i][c("Gravité") - 1], 10) || 0;
    if (g >= CONFIG.SEUIL_CRITIQUE) critiques++;
    if (donnees[i][c("Date clôture") - 1]) {
      clotures++;
      const duree = parseFloat(donnees[i][c("Durée (h)") - 1]);
      if (!isNaN(duree)) { sommeDurees += duree; nbDurees++; }
    }
    const p = String(donnees[i][c("Polyclinique") - 1] || "—");
    parPoly[p] = (parPoly[p] || 0) + 1;
  }
  const lignes = [
    "BILAN MENSUEL PCI — EPSP Saïda (" + (mois + 1) + "/" + annee + ")",
    "Signalements enregistrés : " + total,
    "Signalements critiques (gravité ≥ " + CONFIG.SEUIL_CRITIQUE + ") : " + critiques,
    "Actions clôturées : " + clotures + (total ? " (" + Math.round(clotures * 100 / total) + " %)" : ""),
    "Délai moyen de clôture : " + (nbDurees ? (Math.round(sommeDurees / nbDurees * 10) / 10) + " h" : "n/a"),
    "", "Répartition par polyclinique :"
  ];
  Object.keys(parPoly).sort().forEach(p => lignes.push("• " + p + " : " + parPoly[p]));
  lignes.push("", "Document de base pour le bilan épidémiologique présenté au CLIN.");
  const corps = lignes.join("\n");
  // V5 : le bilan est aussi produit en PDF (archivé dans Drive et joint à
  // l'email). En cas d'échec PDF, l'email texte part seul (comportement V4).
  let pdfBilan = null;
  if (CONFIG.RAPPORT_PDF) {
    try { pdfBilan = genererPdfBilan_(lignes); }
    catch (e) { console.log("⚠️ PDF du bilan : " + e.message); }
  }
  emails_().forEach(em => {
    if (pdfBilan) envoyerMailAvecPdf_(em, "📊 Bilan mensuel PCI — " + (mois + 1) + "/" + annee, corps, pdfBilan);
    else envoyerMail(em, "📊 Bilan mensuel PCI — " + (mois + 1) + "/" + annee, corps);
  });
  envoyerTelegram("📊 Bilan mensuel PCI (" + (mois + 1) + "/" + annee + ")\nSignalements : " + total +
    " • Critiques : " + critiques + " • Clôturés : " + clotures);
  console.log(corps);
}

// ---------------------------------------------------------------------
// 10. NOTIFICATIONS (Email + Telegram multi-destinataires, HTML)
// ---------------------------------------------------------------------
function envoyerNotifications(sujet, corps) {
  emails_().forEach(email => envoyerMail(email, sujet, corps));
  envoyerTelegram("<b>" + echapperHtml_(sujet) + "</b>\n\n" + echapperHtml_(corps) + lienRegistre_());
}

function lienRegistre_() {
  try {
    const ss = classeurRegistre_();
    return ss ? "\n\n📊 Registre : " + ss.getUrl() : "";
  } catch (e) { return ""; }
}

function echapperHtml_(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function envoyerMail(dest, obj, corps) {
  try { MailApp.sendEmail(dest, obj, corps); console.log("✅ Email → " + dest); }
  catch (e) { console.log("❌ Email (" + dest + ") : " + e.message); }
}

function envoyerTelegram(texteHtml) {
  const token = telegramToken_();
  if (!token) { console.log("⚠️ TELEGRAM_TOKEN absent des Script Properties — exécutez configurer()."); return; }
  telegramChats_().forEach(chatId => {
    try {
      const res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "post",
        payload: { chat_id: chatId, text: texteHtml, parse_mode: "HTML", disable_web_page_preview: "true" },
        muteHttpExceptions: true
      });
      console.log(res.getResponseCode() === 200 ? "✅ Telegram → " + chatId
        : "❌ Telegram " + res.getResponseCode() + " : " + res.getContentText());
    } catch (e) { console.log("❌ Telegram exception : " + e.message); }
  });
}

function alerterAdmin_(contexte, err) {
  try {
    MailApp.sendEmail(CONFIG.ADMIN_EMAIL, "⚠️ [UPCI] Erreur technique — " + contexte,
      contexte + "\n" + (err && err.message ? err.message : err) + "\n" + new Date());
  } catch (e) { console.log("❌ alerterAdmin : " + e.message); }
}

// ---------------------------------------------------------------------
// 11. BOT BIDIRECTIONNEL (optionnel) — Web App + webhook Telegram
//     Déployer le script en « Application Web » (accès : moi uniquement
//     n'est PAS compatible webhook → choisir « Tout le monde »), puis
//     enregistrer l'URL dans les propriétés (WEBAPP_URL) et exécuter
//     installerWebhook(). Seuls les chats autorisés sont servis.
// ---------------------------------------------------------------------
function installerWebhook() {
  const url = prop_("WEBAPP_URL", "");
  const token = telegramToken_();
  if (!url || !token) { console.log("⚠️ Renseignez WEBAPP_URL et le jeton d'abord."); return; }
  const res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/setWebhook",
    { method: "post", payload: { url: url }, muteHttpExceptions: true });
  console.log(res.getContentText());
}

function doPost(e) {
  try {
    const upd = JSON.parse(e.postData.contents);
    // V5 (P1) : appui sur un bouton inline (« ✅ Pris en charge »)
    if (upd.callback_query) { traiterAccuseTelegram_(upd.callback_query); return; }
    const msg = upd.message;
    if (!msg || !msg.text) return;
    const chatId = String(msg.chat.id);
    if (telegramChats_().indexOf(chatId) === -1) return; // chats autorisés uniquement
    const texte = msg.text.trim();
    if (texte === "/stats") repondreBot_(chatId, texteStats_());
    else if (texte === "/critiques") repondreBot_(chatId, texteCritiques_());
    else if (texte === "/aide" || texte === "/start") repondreBot_(chatId,
      "Bot UPCI — EPSP Saïda\n/stats : synthèse du registre\n/critiques : signalements critiques encore ouverts");
  } catch (err) { console.log("❌ doPost : " + err.message); }
}

/** Appel générique à l'API Telegram ; renvoie l'objet JSON ou null. */
function telegramApi_(methode, payload) {
  const token = telegramToken_(); if (!token) return null;
  try {
    const res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/" + methode, {
      method: "post", payload: payload, muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch (e) { console.log("❌ telegramApi " + methode + " : " + e.message); return null; }
}

/**
 * V5 (P1) — Envoie l'alerte Telegram AVEC le bouton inline
 * « ✅ Pris en charge » (callback_data « ack:<numéro> ») et renvoie les
 * références des messages créés, au format « chatId:messageId;… »,
 * à conserver au registre (colonne « Msg Telegram »).
 */
function envoyerTelegramAlerte_(sujet, corps, numero) {
  const token = telegramToken_();
  if (!token) { console.log("⚠️ TELEGRAM_TOKEN absent des Script Properties — exécutez configurer()."); return ""; }
  const texte = "<b>" + echapperHtml_(sujet) + "</b>\n\n" + echapperHtml_(corps) + lienRegistre_();
  const refs = [];
  telegramChats_().forEach(chatId => {
    const r = telegramApi_("sendMessage", {
      chat_id: chatId, text: texte, parse_mode: "HTML", disable_web_page_preview: "true",
      reply_markup: JSON.stringify({ inline_keyboard: [[{ text: "✅ Pris en charge", callback_data: "ack:" + numero }]] })
    });
    if (r && r.ok && r.result) { refs.push(chatId + ":" + r.result.message_id); console.log("✅ Telegram (bouton) → " + chatId); }
    else console.log("❌ Telegram (bouton) → " + chatId + " : " + (r ? r.description : "pas de réponse"));
  });
  return refs.join(";");
}

function repondreCallback_(callbackId, texte) {
  telegramApi_("answerCallbackQuery", { callback_query_id: callbackId, text: texte });
}

/**
 * V5 (P1) — Traitement de l'appui sur « ✅ Pris en charge » :
 *  - seuls les chats autorisés (ou leurs membres) peuvent accuser ;
 *  - idempotent : un second appui répond « déjà pris en charge », sans
 *    double écriture ni double ligne au Journal ;
 *  - remplit « Pris en charge le » / « Accusé par », fait passer le statut
 *    de « En attente » à « Pris en charge » (le marqueur CRITIQUE est
 *    conservé), consigne l'accusé au Journal et met à jour TOUTES les
 *    copies du message d'alerte (bouton retiré, accusé affiché).
 */
function traiterAccuseTelegram_(cq) {
  try {
    const data = String(cq.data || "");
    if (data.indexOf("ack:") !== 0) { repondreCallback_(cq.id, "Action inconnue."); return; }
    const numero = data.substring(4).trim();
    const message = cq.message || {};
    const chatIdMsg = String((message.chat || {}).id || "");
    const from = cq.from || {};
    const fromId = String(from.id || "");
    if (telegramChats_().indexOf(chatIdMsg) === -1 && telegramChats_().indexOf(fromId) === -1) {
      repondreCallback_(cq.id, "⛔ Non autorisé."); return;
    }
    appliquerConfigFeuille_();
    const sheet = feuilleSuivi_();
    if (!sheet) { repondreCallback_(cq.id, "Registre inaccessible."); return; }
    const c = nom => colIndex_(sheet, nom);
    const donnees = sheet.getDataRange().getValues();
    let ligne = -1;
    for (let i = 1; i < donnees.length; i++) {
      if (String(donnees[i][c("Numéro") - 1]).trim() === numero) { ligne = i + 1; break; }
    }
    if (ligne === -1) { repondreCallback_(cq.id, "Signalement introuvable : " + numero); return; }
    const dejaAccuse = donnees[ligne - 1][c("Pris en charge le") - 1];
    if (dejaAccuse) {
      repondreCallback_(cq.id, "Déjà pris en charge par " +
        (donnees[ligne - 1][c("Accusé par") - 1] || "—") + " le " +
        Utilities.formatDate(new Date(dejaAccuse), CONFIG.TZ, "dd/MM HH:mm"));
      return;
    }
    const nom = (((from.first_name || "") + " " + (from.last_name || "")).trim()) || from.username || fromId;
    const maintenant = new Date();
    sheet.getRange(ligne, c("Pris en charge le")).setValue(maintenant);
    sheet.getRange(ligne, c("Accusé par")).setValue(nom);
    const statut = String(donnees[ligne - 1][c("Statut") - 1] || "");
    if (statut.indexOf("En attente") > -1)
      sheet.getRange(ligne, c("Statut")).setValue(statut.replace("En attente", "Pris en charge"));
    journaliser_(numero, nom, "accusé", "Telegram — bouton « Pris en charge »");
    repondreCallback_(cq.id, "✅ Pris en charge : " + numero);
    // Mise à jour de toutes les copies du message d'alerte
    const mention = "\n\n✅ <b>Pris en charge</b> par " + echapperHtml_(nom) + " — " +
      Utilities.formatDate(maintenant, CONFIG.TZ, "dd/MM/yyyy HH:mm");
    const baseTexte = message.text ? echapperHtml_(message.text) : "";
    const refs = String(donnees[ligne - 1][c("Msg Telegram") - 1] || "").split(";").filter(String);
    const cleOrigine = chatIdMsg + ":" + (message.message_id || "");
    if (refs.indexOf(cleOrigine) === -1 && message.message_id) refs.push(cleOrigine);
    refs.forEach(ref => {
      const parts = ref.split(":");
      if (parts.length !== 2) return;
      telegramApi_("editMessageText", {
        chat_id: parts[0], message_id: parts[1],
        text: (baseTexte || echapperHtml_("Alerte " + numero)) + mention,
        parse_mode: "HTML", disable_web_page_preview: "true",
        reply_markup: JSON.stringify({ inline_keyboard: [] })
      });
    });
  } catch (err) { console.log("❌ traiterAccuseTelegram_ : " + err.message); }
}

function repondreBot_(chatId, texte) {
  const token = telegramToken_(); if (!token) return;
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "post", payload: { chat_id: chatId, text: texte }, muteHttpExceptions: true });
}

function texteStats_() {
  const sheet = feuilleSuivi_(); if (!sheet) return "Registre inaccessible.";
  const donnees = sheet.getDataRange().getValues();
  const c = nom => colIndex_(sheet, nom);
  let total = 0, ouverts = 0, critiquesOuverts = 0;
  for (let i = 1; i < donnees.length; i++) {
    if (!donnees[i][c("Numéro") - 1]) continue;
    if (estDemo_(String(donnees[i][c("Numéro") - 1]))) continue; // V5 : démos hors statistiques
    total++;
    if (!donnees[i][c("Date clôture") - 1]) {
      ouverts++;
      if ((parseInt(donnees[i][c("Gravité") - 1], 10) || 0) >= CONFIG.SEUIL_CRITIQUE) critiquesOuverts++;
    }
  }
  return "📊 Registre UPCI\nSignalements : " + total + "\nOuverts : " + ouverts + "\nCritiques ouverts : " + critiquesOuverts;
}

function texteCritiques_() {
  const sheet = feuilleSuivi_(); if (!sheet) return "Registre inaccessible.";
  const donnees = sheet.getDataRange().getValues();
  const c = nom => colIndex_(sheet, nom);
  const lignes = ["🚨 Critiques encore ouverts :"];
  let n = 0;
  for (let i = 1; i < donnees.length; i++) {
    const g = parseInt(donnees[i][c("Gravité") - 1], 10) || 0;
    if (g >= CONFIG.SEUIL_CRITIQUE && !donnees[i][c("Date clôture") - 1] && donnees[i][c("Numéro") - 1] && !estDemo_(String(donnees[i][c("Numéro") - 1]))) {
      lignes.push("• " + donnees[i][c("Numéro") - 1] + " — " + donnees[i][c("Polyclinique") - 1] +
        " / " + donnees[i][c("Service") - 1] + " (gravité " + g + ")");
      n++;
    }
  }
  return n ? lignes.join("\n") : "✅ Aucun signalement critique ouvert.";
}

// ---------------------------------------------------------------------
// 12. DIAGNOSTIC & TESTS (exécution manuelle)
// ---------------------------------------------------------------------
function verifierSante() {
  console.log("--- SANTÉ DU SYSTÈME UPCI V5 ---");
  const token = telegramToken_();
  console.log("Jeton Telegram : " + (token ? "présent (propriétés)" : "ABSENT — exécutez configurer()"));
  if (token) {
    const res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/getMe", { muteHttpExceptions: true });
    console.log("Bot : " + res.getContentText().substring(0, 200));
  }
  try { FormApp.openById(formSignalId_()); console.log("Formulaire signalement : OK"); }
  catch (e) { console.log("Formulaire signalement : ❌ " + e.message); }
  console.log("Formulaire clôture : " + (formClotureId_() ? "renseigné" : "⚠️ NON renseigné — la boucle de clôture est inactive"));
  try { console.log("Registre : " + (classeurRegistre_() ? "OK" : "introuvable")); }
  catch (e) { console.log("Registre : ❌ " + e.message); }
  console.log("Déclencheurs actifs : " + ScriptApp.getProjectTriggers().length);
}

function testerConfiguration() {
  console.log("--- TEST V5 ---");
  envoyerNotifications("Test UPCI V5.0", "Test technique du système (aucune action requise).");
  console.log(texteStats_());
  console.log("--- FIN DU TEST ---");
}

// ---------------------------------------------------------------------
// 13. RECONSTRUCTION AUTOMATIQUE DU SYSTÈME (compte institutionnel)
//     setupNouveauSysteme() crée, en une seule exécution :
//       - le formulaire SIGNALEMENT (structure identique à l'original),
//       - le classeur REGISTRE (destination des deux formulaires),
//       - le formulaire CLÔTURE (celui qui manquait à la V2.2),
//       - la feuille « Suivi UPCI » (via feuilleSuivi_),
//     puis enregistre les identifiants dans les Script Properties.
//     Ordre de déploiement : setupNouveauSysteme() → configurer() →
//     installerTriggers() → verifierSante() → testerConfiguration().
// ---------------------------------------------------------------------

// ⚠️ STRUCTURE À COMPLÉTER depuis la transcription verbatim de l'ancien formulaire.
// Tant que ce tableau est vide, setupNouveauSysteme() refuse de s'exécuter.
const STRUCTURE_SIGNALEMENT = [
  // Transcription verbatim de l'ancien formulaire (lecture seule, 31/10/2026).
  // Le champ « Email » de l'original est la collecte d'e-mail intégrée de Google Forms
  // -> traitée par form.setCollectEmail(true), pas par un item de ce tableau.
  { title: "Polyclinique concernée", type: "LIST", required: true, choices: [
    "Polyclinique Salam 2", "Polyclinique Rebahia", "Polyclinique 1000 logements",
    "Polyclinique Nord (Lamarine)", "Polyclinique Sidi Gacem", "Polyclinique Sidi Chikh",
    "Polyclinique Nasr", "Polyclinique Amrous", "Polyclinique 1200 logements" ] },
  { title: "Service / Unité concerné(e)", type: "LIST", required: true, choices: [
    "Bureau du médecin", "Salle de soins", "Laboratoire", "Radiologie",
    "Maternité", "Pharmacie", "Accueil", "Autre / non précisé" ] },
  { title: "Localisation précise", type: "MC", required: true, choices: [
    "Dans la salle", "Entrée du service", "Toilettes", "Stockage", "Non précisé" ] },
  { title: "Période / Shift", type: "MC", required: true, choices: [
    "Matin", "Soir", "Nuit" ] },
  { title: "Type d'urgence", type: "CHECKBOX", required: true, choices: [
    "Accident d'exposition au sang (AES)", "Non-respect de l'hygiène des mains",
    "Tri incorrect des déchets", "Déversement ou contamination biologique",
    "Rupture critique de stérilisation",
    "Rupture d'équipements de protection individuelle (EPI)",
    "Infection suspectée", "Autre / non précisé" ] },
  { title: "Degré de gravité", type: "SCALE", required: true, min: 1, max: 5,
    labelLow: "Faible", labelHigh: "Extrême" },
  { title: "Avez-vous agi immédiatement ?", type: "MC", required: true, choices: [
    "Oui, prise en charge", "Oui, partiellement", "Non, en attente" ] },
  { title: "Mesures prises", type: "CHECKBOX", required: true, choices: [
    "Désinfection de la zone", "Changement d'équipement", "Isolement du patient",
    "Information du responsable", "Correction du tri" ] },
  { title: "Délai d'intervention souhaité", type: "MC", required: true, choices: [
    "Immédiate", "Dans la journée", "Dans les 24h" ] }
];

const STRUCTURE_CLOTURE = [
  { title: "Numéro du signalement concerné", type: "TEXT", required: true,
    help: "Exemple : UPCI-2026-0001 — il figure sur l'alerte Telegram / email reçue." },
  { title: "Intervention réalisée", type: "PARAGRAPH", required: true },
  { title: "Statut de clôture", type: "MC", required: true,
    choices: ["Clôturé", "Partiellement clôturé", "En cours de traitement", "Non résolu — escalade"] },
  { title: "Délai réel d'intervention", type: "MC", required: true,
    choices: ["Moins d'1 heure", "1 à 4 heures", "4 à 24 heures", "Plus de 24 heures"] },
  // V5 — boucle d'apprentissage : optionnels, attendus pour les cas critiques.
  { title: "Action corrective (cas critiques)", type: "PARAGRAPH", required: false,
    help: "Ce qui a été changé pour éviter la répétition (procédure, stock, équipement…)." },
  { title: "Vérification d'efficacité (cas critiques)", type: "PARAGRAPH", required: false,
    help: "À remplir PLUS TARD, lors d'une nouvelle soumission de ce formulaire avec le même numéro : le problème a-t-il réellement disparu ?" }
];

const DESC_SIGNALEMENT = "Signalement rapide d'une situation urgente liée à la prévention et au contrôle des infections au sein de l'EPSP de Saïda. 15 secondes. Aucune saisie libre : choisissez uniquement. Conformément à la note n°14 du 25 mai 2026 et à la note de rappel n°93 du 19 octobre 2026.";
const DESC_CLOTURE = "UPCI — EPSP de Saïda : formulaire de clôture réservé au Chef d'UPCI / à l'équipe d'intervention. La clôture met à jour la ligne du signalement au registre central et calcule la durée totale de traitement.";

function ajouterQuestion_(form, q) {
  let item;
  switch (q.type) {
    case "LIST":
      item = form.addListItem(); item.setChoiceValues(q.choices); break;
    case "MC":
      item = form.addMultipleChoiceItem(); item.setChoiceValues(q.choices); break;
    case "CHECKBOX":
      item = form.addCheckboxItem(); item.setChoiceValues(q.choices); break;
    case "SCALE":
      item = form.addScaleItem(); item.setBounds(q.min || 1, q.max || 5);
      if (q.labelLow || q.labelHigh) item.setLabels(q.labelLow || "", q.labelHigh || "");
      break;
    case "PARAGRAPH":
      item = form.addParagraphTextItem(); break;
    default: // TEXT
      item = form.addTextItem(); break;
  }
  item.setTitle(q.title);
  if (q.help) item.setHelpText(q.help);
  if (q.required) item.setRequired(true);
  return item;
}

function setupNouveauSysteme() {
  if (prop_("FORM_SIGNAL_ID", "")) {
    console.log("⛔ Un signalement existe déjà (FORM_SIGNAL_ID présent dans les propriétés). Abandon pour éviter les doublons. Si reconstruction nécessaire : effacez d'abord la propriété FORM_SIGNAL_ID.");
    console.log("Formulaire existant : https://docs.google.com/forms/d/" + prop_("FORM_SIGNAL_ID", "") + "/edit");
    return;
  }
  if (!STRUCTURE_SIGNALEMENT.length) {
    console.log("⛔ STRUCTURE_SIGNALEMENT est vide — transcription de l'ancien formulaire non intégrée. Abandon.");
    return;
  }

  // 1) Formulaire SIGNALEMENT
  const form = FormApp.create("Signalement d'urgence — UPCI — EPSP Saïda");
  form.setDescription(DESC_SIGNALEMENT);
  form.setCollectEmail(true); // champ « Email » obligatoire de l'original (collecte intégrée)
  form.setConfirmationMessage("Signalement reçu. Merci pour votre vigilance.");
  form.setAllowResponseEdits(false);
  STRUCTURE_SIGNALEMENT.forEach(q => ajouterQuestion_(form, q));

  // 2) Classeur REGISTRE — destination commune des réponses
  const ss = SpreadsheetApp.create("Registre UPCI — EPSP Saïda");
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // 3) Formulaire CLÔTURE (inexistant en V2.2)
  const fc = FormApp.create("Clôture de signalement — UPCI — EPSP Saïda");
  fc.setDescription(DESC_CLOTURE);
  fc.setCollectEmail(true); // traçabilité de l'agent qui clôture
  fc.setConfirmationMessage("Clôture enregistrée. Merci pour votre intervention.");
  fc.setAllowResponseEdits(false);
  STRUCTURE_CLOTURE.forEach(q => ajouterQuestion_(fc, q));
  fc.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // 4) Identifiants + paramètres dans les Script Properties
  PROPS.setProperties({
    FORM_SIGNAL_ID: form.getId(),
    FORM_CLOTURE_ID: fc.getId(),
    REGISTRE_ID: ss.getId(),
    TELEGRAM_CHAT_IDS: CONFIG.TELEGRAM_CHAT_IDS.join(","),
    EMAILS: CONFIG.EMAILS.join(",")
  }, false);

  // 5) Feuille de suivi V3 dans le registre
  feuilleSuivi_();

  console.log("✅ SYSTÈME CRÉÉ");
  console.log("📋 Signalement — ID : " + form.getId());
  console.log("📋 Signalement — édition : " + form.getEditUrl());
  console.log("📋 Signalement — public (QR) : " + form.getPublishedUrl());
  console.log("🔒 Clôture — ID : " + fc.getId());
  console.log("🔒 Clôture — édition : " + fc.getEditUrl());
  console.log("🔒 Clôture — public (QR) : " + fc.getPublishedUrl());
  console.log("📊 Registre : " + ss.getUrl());
  console.log("➡️ Étapes suivantes : configurer() → installerTriggers() → verifierSante() → testerConfiguration()");
}

// ---------------------------------------------------------------------
// V4-A. SAUVEGARDE HEBDOMADAIRE DU REGISTRE (CSV dans Drive)
// ---------------------------------------------------------------------
function sauvegardeHebdomadaire() {
  try {
    const sheet = feuilleSuivi_(); if (!sheet) return;
    const valeurs = sheet.getDataRange().getValues();
    const csv = valeurs.map(r => r.map(v => {
      const s = (v instanceof Date) ? Utilities.formatDate(v, CONFIG.TZ, "yyyy-MM-dd HH:mm") : String(v == null ? "" : v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";")).join("\n");
    let dossier;
    const it = DriveApp.getFoldersByName(CONFIG.DOSSIER_SAUVEGARDE);
    dossier = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.DOSSIER_SAUVEGARDE);
    const nom = "Suivi_UPCI_" + Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd") + ".csv";
    dossier.createFile(nom, csv, MimeType.CSV);
    console.log("✅ Sauvegarde hebdomadaire : " + nom);
  } catch (e) {
    console.log("❌ sauvegardeHebdomadaire : " + e.message);
    alerterAdmin_("Échec sauvegarde hebdomadaire", e);
  }
}

// ---------------------------------------------------------------------
// V4-B. PAGE DE SUIVI PUBLIQUE (Web App — à déployer, voir docs/02)
// Le déclarant saisit son NUMÉRO et sa POLYCLINIQUE : seuls le statut
// et les dates sont affichés. Aucune donnée sensible, aucun email.
// Sans paramètres : affiche le petit formulaire de recherche.
// ---------------------------------------------------------------------
function doGet(e) {
  const p = (e && e.parameter) || {};
  const numero = String(p.numero || "").trim();
  const poly = normaliser_(String(p.poly || ""));
  let bloc = "";
  if (numero) {
    let trouve = null;
    try {
      const sheet = feuilleSuivi_();
      if (sheet) {
        const donnees = sheet.getDataRange().getValues();
        const cNum = colIndex_(sheet, "Numéro"), cPoly = colIndex_(sheet, "Polyclinique");
        for (let i = 1; i < donnees.length; i++) {
          if (String(donnees[i][cNum - 1]).trim() === numero &&
              normaliser_(String(donnees[i][cPoly - 1] || "")) === poly) { trouve = donnees[i]; break; }
        }
      }
    } catch (err) { console.log("❌ doGet : " + err.message); }
    if (trouve) {
      const sheet2 = feuilleSuivi_();
      const statut = String(trouve[colIndex_(sheet2, "Statut") - 1] || "");
      const dClot = trouve[colIndex_(sheet2, "Date clôture") - 1];
      bloc = "<p style='font-size:18px'>N° <b>" + echapperHtml_(numero) + "</b></p>" +
             "<p>Statut : <b>" + echapperHtml_(statut) + "</b></p>" +
             (dClot ? "<p>Clôturé le : " + echapperHtml_(String(dClot)) + "</p>" : "<p>Traitement en cours.</p>");
    } else {
      bloc = "<p style='color:#b00'>Aucun signalement trouvé pour ce numéro et cette polyclinique. Vérifiez la saisie.</p>";
    }
  }
  const html = "<!DOCTYPE html><html lang='fr'><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>Suivi de signalement — UPCI</title></head>" +
    "<body style='font-family:Arial,sans-serif;max-width:480px;margin:24px auto;padding:0 16px'>" +
    "<h2>Suivi de votre signalement — UPCI</h2>" + bloc +
    "<form method='get'><label>Numéro du signalement<br>" +
    "<input name='numero' required style='width:100%;padding:8px' placeholder='UPCI-2026-0001'></label><br><br>" +
    "<label>Polyclinique<br><input name='poly' required style='width:100%;padding:8px'></label><br><br>" +
    "<button type='submit' style='padding:10px 18px'>Vérifier</button></form>" +
    "<p style='color:#666;font-size:13px'>Aucune donnée personnelle n'est affichée sur cette page.</p>" +
    "</body></html>";
  return HtmlService.createHtmlOutput(html).setTitle("Suivi UPCI");
}

// =====================================================================
// V5-A. JOURNAL D'AUDIT — feuille « Journal » (AJOUT SEUL / append-only)
// Chaque changement d'état y est consigné : création, accusé, relance,
// escalade, clôture, vérification, réouverture, regroupement, silence,
// santé, bulletin, démo. Aucune fonction ne modifie ni ne supprime une
// ligne du Journal : c'est la piste d'audit du système.
// =====================================================================
const ENTETES_JOURNAL = ["Horodatage", "Numéro", "Acteur", "Action", "Détail"];

function feuilleJournal_() {
  const ss = classeurRegistre_();
  if (!ss) return null;
  let sheet = ss.getSheetByName("Journal");
  if (!sheet) {
    sheet = ss.insertSheet("Journal");
    sheet.appendRow(ENTETES_JOURNAL);
    sheet.getRange(1, 1, 1, ENTETES_JOURNAL.length).setFontWeight("bold").setBackground("#fce5cd");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function journaliser_(numero, acteur, action, detail) {
  if (!CONFIG.JOURNAL_ACTIF) return;
  try {
    const sheet = feuilleJournal_(); if (!sheet) return;
    sheet.appendRow([new Date(), String(numero || ""), String(acteur || ""),
      String(action || ""), String(detail || "").substring(0, 500)]);
  } catch (e) { console.log("⚠️ Journal : " + e.message); } // ne jamais bloquer le flux principal
}

// =====================================================================
// V5-B. OUTILS PDF — bilan CLIN (DocumentApp → PDF) + envoi avec pièce jointe
// =====================================================================
function dossierDrive_(nom) {
  const it = DriveApp.getFoldersByName(nom);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nom);
}

/**
 * Crée le PDF du bilan à partir des lignes texte du rapport mensuel,
 * l'archive dans le dossier « Rapports UPCI » et renvoie le fichier PDF.
 * Le document Google Docs intermédiaire est mis à la corbeille : seul
 * le PDF est conservé.
 */
function genererPdfBilan_(lignes) {
  const titre = lignes[0] || "Bilan mensuel PCI";
  const doc = DocumentApp.create(titre);
  const body = doc.getBody();
  body.appendParagraph(titre).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  for (let i = 1; i < lignes.length; i++) body.appendParagraph(lignes[i]);
  body.appendParagraph("").appendParagraph(
    "Document généré automatiquement par le système d'alerte UPCI — " +
    Utilities.formatDate(new Date(), CONFIG.TZ, "dd/MM/yyyy HH:mm"));
  doc.saveAndClose();
  const fichierDoc = DriveApp.getFileById(doc.getId());
  const blob = fichierDoc.getAs(MimeType.PDF).setName(titre.replace(/[^\wÀ-ÿ ()-]/g, "") + ".pdf");
  const pdf = dossierDrive_(CONFIG.DOSSIER_RAPPORTS).createFile(blob);
  fichierDoc.setTrashed(true);
  console.log("✅ PDF du bilan archivé : " + pdf.getName());
  return pdf;
}

function envoyerMailAvecPdf_(dest, obj, corps, fichierPdf) {
  try {
    MailApp.sendEmail({ to: dest, subject: obj, body: corps, attachments: [fichierPdf.getBlob()] });
    console.log("✅ Email + PDF → " + dest);
  } catch (e) {
    console.log("❌ Email + PDF (" + dest + ") : " + e.message);
    envoyerMail(dest, obj, corps); // repli : texte seul
  }
}

// =====================================================================
// V5-C. RÉOUVERTURE MANUELLE (exécution depuis l'éditeur, par l'admin)
// Réouvre un dossier clôturé : efface date/durée de clôture, repasse le
// statut à « Rouvert — En attente », notifie et consigne au Journal.
// =====================================================================
function rouvrirSignalement(numero) {
  appliquerConfigFeuille_();
  const sheet = feuilleSuivi_();
  if (!sheet || !numero) { console.log("⚠️ rouvrirSignalement : registre ou numéro manquant."); return; }
  const c = nom => colIndex_(sheet, nom);
  const donnees = sheet.getDataRange().getValues();
  for (let i = 1; i < donnees.length; i++) {
    if (String(donnees[i][c("Numéro") - 1]).trim() === String(numero).trim()) {
      if (!donnees[i][c("Date clôture") - 1]) { console.log("ℹ️ " + numero + " n'est pas clôturé — rien à rouvrir."); return; }
      sheet.getRange(i + 1, c("Date clôture")).setValue("");
      sheet.getRange(i + 1, c("Durée (h)")).setValue("");
      sheet.getRange(i + 1, c("Statut")).setValue("Rouvert — En attente");
      journaliser_(numero, "Administrateur (manuel)", "réouverture", "Réouverture manuelle depuis l'éditeur");
      envoyerNotifications("↩️ RÉOUVERTURE — " + numero,
        "Le dossier " + numero + " (" + donnees[i][c("Polyclinique") - 1] + " — " +
        donnees[i][c("Service") - 1] + ") a été rouvert et repasse en attente de traitement.");
      console.log("✅ " + numero + " rouvert.");
      return;
    }
  }
  console.log("⚠️ rouvrirSignalement : numéro introuvable — " + numero);
}

// =====================================================================
// V5-D. MODE DÉMO — données de formation / présentation
// genererDonneesDemo() : crée des signalements marqués « DÉMO » dans le
// registre, SANS aucune notification (ni email, ni Telegram) et SANS
// consommmer la numérotation officielle. Les lignes DÉMO sont exclues
// des indicateurs, des escalades, des regroupements et du silence.
// supprimerDonneesDemo() : supprime exactement ces lignes, rien d'autre.
// =====================================================================
function genererDonneesDemo() {
  appliquerConfigFeuille_();
  const sheet = feuilleSuivi_(); if (!sheet) { console.log("⚠️ Registre introuvable."); return; }
  const c = nom => colIndex_(sheet, nom);
  const annee = Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy");
  let seq = 0;
  sheet.getDataRange().getValues().forEach(r => {
    const m = String(r[c("Numéro") - 1] || "").match(/^DÉMO-\d{4}-(\d+)$/);
    if (m) seq = Math.max(seq, parseInt(m[1], 10) || 0);
  });
  const maintenant = Date.now();
  const specs = [
    { decH: 12 * 24, poly: "Polyclinique Salam 2", service: "Laboratoire", gravite: 2, mesures: "Désinfection de la zone", ferme: true, duree: 3, intervention: "DÉMO — Remplacement du distributeur de savon et réassort du stock." },
    { decH: 6 * 24, poly: "Polyclinique Rebahia", service: "Salle de soins", gravite: 4, mesures: "Correction du tri", ferme: true, duree: 5, intervention: "DÉMO — Collecte et remplacement du conteneur DASRI.", action: "DÉMO — Un conteneur DASRI de réserve est installé dans chaque salle de soins.", verif: "DÉMO — Contrôle à J+7 : tri conforme, aucun débordement constaté." },
    { decH: 5 * 24, poly: "Polyclinique 1000 logements", service: "Pharmacie", gravite: 3, mesures: "Information du responsable", ferme: true, duree: 8, intervention: "DÉMO — Réassort des gants et affichage du seuil d'alerte de stock." },
    { decH: 2 * 24, poly: "Polyclinique Nord (Lamarine)", service: "Accueil", gravite: 5, mesures: "Isolement du patient", ferme: true, duree: 2, intervention: "DÉMO — Désinfection complète de la zone d'accueil.", action: "DÉMO — Solution hydro-alcoolique ajoutée au comptoir d'accueil." },
    { decH: 4, poly: "Polyclinique Nasr", service: "Maternité", gravite: 4, mesures: "Changement d'équipement", ferme: false, statut: "CRITIQUE - En attente" },
    { decH: 26, poly: "Polyclinique Sidi Gacem", service: "Radiologie", gravite: 2, mesures: "Désinfection de la zone", ferme: false, statut: "En attente" },
    { decH: 8 * 24, poly: "Polyclinique Sidi Chikh", service: "Salle de soins", gravite: 3, mesures: "Correction du tri", ferme: true, duree: 26, intervention: "DÉMO — Briefing de l'équipe sur le tri des déchets." },
    { decH: 10 * 24, poly: "Polyclinique Amrous", service: "Bureau du médecin", gravite: 1, mesures: "Information du responsable", ferme: true, duree: 1, intervention: "DÉMO — Réaffichage de la procédure d'hygiène des mains." }
  ];
  specs.forEach(s => {
    seq++;
    const numero = "DÉMO-" + annee + "-" + ("000" + seq).slice(-3);
    const dateSignal = new Date(maintenant - s.decH * 3600000);
    const ligne = [];
    ligne[c("Date") - 1] = dateSignal;
    ligne[c("Numéro") - 1] = numero;
    ligne[c("Type") - 1] = "DÉMO";
    ligne[c("Polyclinique") - 1] = s.poly;
    ligne[c("Service") - 1] = s.service;
    ligne[c("Gravité") - 1] = s.gravite;
    ligne[c("Délai demandé") - 1] = "DÉMO";
    ligne[c("Mesures") - 1] = s.mesures;
    if (s.ferme) {
      ligne[c("Statut") - 1] = "Clôturé";
      ligne[c("Intervention") - 1] = s.intervention || "";
      ligne[c("Délai réel") - 1] = "DÉMO";
      ligne[c("Date clôture") - 1] = new Date(dateSignal.getTime() + (s.duree || 1) * 3600000);
      ligne[c("Durée (h)") - 1] = s.duree || 1;
      ligne[c("Action corrective") - 1] = s.action || "";
      ligne[c("Vérification d'efficacité") - 1] = s.verif || "";
    } else {
      ligne[c("Statut") - 1] = s.statut || "En attente";
    }
    sheet.appendRow(ligne.map(v => v === undefined ? "" : v));
    journaliser_(numero, "Mode démo", "création", "Données de démonstration (formation / présentation)");
  });
  console.log("✅ Mode démo : " + specs.length + " signalements DÉMO créés (aucune notification envoyée). " +
    "Pour les retirer : supprimerDonneesDemo().");
}

function supprimerDonneesDemo() {
  const sheet = feuilleSuivi_(); if (!sheet) { console.log("⚠️ Registre introuvable."); return; }
  const cNum = colIndex_(sheet, "Numéro");
  const donnees = sheet.getDataRange().getValues();
  let supprimes = 0;
  for (let i = donnees.length - 1; i >= 1; i--) { // de bas en haut : indices stables
    if (estDemo_(String(donnees[i][cNum - 1] || ""))) { sheet.deleteRow(i + 1); supprimes++; }
  }
  journaliser_("-", "Mode démo", "suppression démo", supprimes + " ligne(s) DÉMO supprimée(s)");
  console.log("✅ Mode démo : " + supprimes + " ligne(s) DÉMO supprimée(s). Aucune autre ligne touchée.");
}

// =====================================================================
// V5-E. MONITEUR DE SILENCE (P8) — contrôle hebdomadaire des sites muets
// Un site sans AUCUN signalement depuis SILENCE_SEMAINES semaines est
// signalé à l'administrateur : le silence est une donnée (sous-détection
// probable), pas un succès. Sites : clé SITES de la feuille
// « Configuration », sinon valeurs distinctes du registre.
// Exemptions possibles : clé SITES_EXEMPTS (fermeture, travaux…).
// =====================================================================
function controleSilenceSites() {
  appliquerConfigFeuille_();
  if (!CONFIG.SILENCE_ACTIF) return;
  const sheet = feuilleSuivi_(); if (!sheet) return;
  const c = nom => colIndex_(sheet, nom);
  const donnees = sheet.getDataRange().getValues();
  const limite = new Date(Date.now() - CONFIG.SILENCE_SEMAINES * 7 * 86400000);
  const vus = {}, actifs = {};
  for (let i = 1; i < donnees.length; i++) {
    const poly = String(donnees[i][c("Polyclinique") - 1] || "").trim();
    if (!poly) continue;
    vus[poly] = true;
    if (estDemo_(String(donnees[i][c("Numéro") - 1] || ""))) continue; // les démos ne « réveillent » pas un site
    const d = new Date(donnees[i][c("Date") - 1]);
    if (!isNaN(d) && d >= limite) actifs[poly] = true;
  }
  const sites = (SITES_ && SITES_.length) ? SITES_.slice() : Object.keys(vus);
  const exempts = (SITES_EXEMPTS_ || []).map(normaliser_);
  const silencieux = sites.filter(s => !actifs[s] && exempts.indexOf(normaliser_(s)) === -1);
  if (!sites.length) { console.log("ℹ️ Silence : aucun site connu (registre vide et clé SITES absente)."); return; }
  if (!silencieux.length) { console.log("✅ Silence : tous les sites ont signalé dans les " + CONFIG.SILENCE_SEMAINES + " dernières semaines."); return; }
  const sujet = "🔕 Sites silencieux — aucun signalement depuis " + CONFIG.SILENCE_SEMAINES + " semaines";
  const corps = [sujet + " :",
    silencieux.map(s => "• " + s).join("\n"),
    "",
    "Un site qui ne signale rien n'est pas un site sans problèmes : sous-détection probable.",
    "Action suggérée : visite d'appui bienveillante et vérification de l'affichage du QR code — pas de sanction."
  ].join("\n");
  envoyerMail(CONFIG.ADMIN_EMAIL, sujet, corps);
  envoyerTelegram("<b>" + echapperHtml_(sujet) + "</b>\n\n" + echapperHtml_(corps));
  journaliser_("-", "Système", "silence", silencieux.length + " site(s) silencieux : " + silencieux.join(", "));
  console.log(corps);
}

// =====================================================================
// V5-F. BULLETIN MENSUEL (P7) — « Vous avez signalé → nous avons changé »
// Construit des clôtures du mois écoulé : volumes par site, dossiers
// résolus, délai moyen de clôture et changements concrets (actions
// correctives). Aucune donnée sensible (aucun email de déclarant).
// Destinataires : clé EMAILS_BULLETIN, sinon destinataires d'alerte.
// =====================================================================
function bulletinMensuel() {
  appliquerConfigFeuille_();
  if (!CONFIG.BULLETIN_ACTIF) return;
  const sheet = feuilleSuivi_(); if (!sheet) return;
  const ref = new Date(); ref.setDate(0); // dernier jour du mois écoulé
  const mois = ref.getMonth(), annee = ref.getFullYear();
  const c = nom => colIndex_(sheet, nom);
  const donnees = sheet.getDataRange().getValues();
  let total = 0, sommeDurees = 0, nbDurees = 0;
  const parSite = {}, resolus = [], changements = [];
  for (let i = 1; i < donnees.length; i++) {
    const numero = String(donnees[i][c("Numéro") - 1] || "");
    if (!numero || estDemo_(numero)) continue;
    const d = new Date(donnees[i][c("Date") - 1]);
    const poly = String(donnees[i][c("Polyclinique") - 1] || "—");
    if (!isNaN(d) && d.getMonth() === mois && d.getFullYear() === annee) {
      total++;
      parSite[poly] = (parSite[poly] || 0) + 1;
    }
    const dClot = donnees[i][c("Date clôture") - 1] ? new Date(donnees[i][c("Date clôture") - 1]) : null;
    if (dClot && !isNaN(dClot) && dClot.getMonth() === mois && dClot.getFullYear() === annee) {
      resolus.push("• " + numero + " — " + poly + " : " + String(donnees[i][c("Intervention") - 1] || "traité"));
      const duree = parseFloat(donnees[i][c("Durée (h)") - 1]);
      if (!isNaN(duree)) { sommeDurees += duree; nbDurees++; }
      const action = String(donnees[i][c("Action corrective") - 1] || "").trim();
      if (action) changements.push("• " + numero + " (" + poly + ") : " + action);
    }
  }
  if (!total && !resolus.length) {
    console.log("ℹ️ Bulletin : aucune activité le mois écoulé — envoi annulé.");
    journaliser_("-", "Système", "bulletin", "Aucune activité (" + (mois + 1) + "/" + annee + ") — envoi annulé");
    return;
  }
  const lignes = [
    "VOUS AVEZ SIGNALÉ → NOUS AVONS CHANGÉ",
    "Bulletin PCI — EPSP Saïda (" + (mois + 1) + "/" + annee + ")",
    "",
    "📣 Vous avez signalé : " + total + " signalement(s) ce mois-ci" +
      (Object.keys(parSite).length ? " (" + Object.keys(parSite).sort().map(p => p + " : " + parSite[p]).join(" ; ") + ")" : "") + ".",
    "✅ Nous avons traité : " + resolus.length + " dossier(s) clôturé(s)" +
      (nbDurees ? " — délai moyen de clôture : " + (Math.round(sommeDurees / nbDurees * 10) / 10) + " h." : "."),
    "",
    "🔧 Ce qui a concrètement changé grâce à vos signalements :"
  ];
  if (changements.length) changements.slice(0, 10).forEach(x => lignes.push(x));
  else lignes.push("• (Les actions correctives des cas critiques apparaîtront ici dès leur consignation.)");
  lignes.push("", "📌 Exemples de dossiers résolus :");
  if (resolus.length) resolus.slice(0, 10).forEach(x => lignes.push(x));
  else lignes.push("• Aucun dossier clôturé ce mois-ci — les dossiers ouverts restent suivis.");
  lignes.push("", "Merci pour votre vigilance. Continuez : le QR code affiché dans votre service est votre outil — chaque signalement compte.");
  const corps = lignes.join("\n");
  const dests = emailsBulletin_();
  dests.forEach(em => envoyerMail(em, "📬 Vous avez signalé → nous avons changé — " + (mois + 1) + "/" + annee, corps));
  journaliser_("-", "Système", "bulletin", "Bulletin " + (mois + 1) + "/" + annee + " envoyé à " + dests.length + " destinataire(s)");
  console.log(corps);
}

// =====================================================================
// V5-G. BATTEMENT DE CŒUR (P14) — contrôle de santé hebdomadaire
// Vérifie : déclencheurs attendus présents, registre joignable, date du
// dernier signalement, sauvegarde récente présente. Envoie UNE ligne
// OK/alerte à l'administrateur (email + Telegram) et consigne au Journal.
// Le silence du système devient ainsi visible avant qu'il ne nuise.
// =====================================================================
function controleSanteHebdomadaire() {
  appliquerConfigFeuille_();
  if (!CONFIG.SANTE_ACTIF) return;
  const problemes = [];
  // 1) Déclencheurs attendus
  const attendus = ["onFormSubmit", "verifierCritiquesEnAttente", "rapportMensuel",
    "sauvegardeHebdomadaire", "controleSilenceSites", "bulletinMensuel", "controleSanteHebdomadaire"];
  const presents = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  const manquants = attendus.filter(h => presents.indexOf(h) === -1);
  if (manquants.length) problemes.push("déclencheur(s) manquant(s) : " + manquants.join(", ") + " — relancez installerTriggers()");
  // 2) Registre joignable + dernier signalement
  let dernierTxt = "aucun";
  try {
    const sheet = feuilleSuivi_();
    if (!sheet) problemes.push("registre inaccessible");
    else {
      const cDate = colIndex_(sheet, "Date"), cNum = colIndex_(sheet, "Numéro");
      const donnees = sheet.getDataRange().getValues();
      let dernier = null;
      for (let i = 1; i < donnees.length; i++) {
        if (estDemo_(String(donnees[i][cNum - 1] || ""))) continue;
        const d = new Date(donnees[i][cDate - 1]);
        if (!isNaN(d) && (!dernier || d > dernier)) dernier = d;
      }
      if (dernier) dernierTxt = Utilities.formatDate(dernier, CONFIG.TZ, "dd/MM/yyyy");
    }
  } catch (e) { problemes.push("registre inaccessible : " + e.message); }
  // 3) Sauvegarde récente (≤ 8 jours)
  let sauvTxt = "absente";
  try {
    const it = DriveApp.getFoldersByName(CONFIG.DOSSIER_SAUVEGARDE);
    if (!it.hasNext()) problemes.push("dossier « " + CONFIG.DOSSIER_SAUVEGARDE + " » introuvable");
    else {
      const fichiers = it.next().getFiles();
      let recente = null;
      while (fichiers.hasNext()) {
        const f = fichiers.next();
        if (!recente || f.getLastUpdated() > recente) recente = f.getLastUpdated();
      }
      if (!recente) problemes.push("aucune sauvegarde dans le dossier");
      else {
        sauvTxt = Utilities.formatDate(recente, CONFIG.TZ, "dd/MM/yyyy");
        if ((Date.now() - recente.getTime()) > 8 * 86400000) problemes.push("sauvegarde ancienne (" + sauvTxt + ")");
      }
    }
  } catch (e) { problemes.push("sauvegarde non vérifiable : " + e.message); }
  const ok = !problemes.length;
  const ligne = (ok ? "💓 UPCI — santé OK" : "⚠️ UPCI — santé DÉGRADÉE") +
    " | déclencheurs " + (attendus.length - manquants.length) + "/" + attendus.length +
    " | dernier signalement : " + dernierTxt + " | sauvegarde : " + sauvTxt +
    (ok ? "" : " | problèmes : " + problemes.join(" ; "));
  envoyerMail(CONFIG.ADMIN_EMAIL, ligne, ligne);
  envoyerTelegram(echapperHtml_(ligne));
  journaliser_("-", "Système", "santé", ligne);
  console.log(ligne);
}
