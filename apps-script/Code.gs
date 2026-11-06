/**
 * =====================================================================
 * SYSTÈME UPCI — EPSP DE SAÏDA  •  VERSION 4.0 (édition publiée améliorée)
 * NOTE : l'EPSP de Saïda continue d'exploiter la V3.0 en production.
 * La V4.0 est l'édition améliorée publiée sur GitHub (dépôt upci-alert-system),
 * destinée aux nouvelles installations et à la généralisation.
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
  TZ: "Africa/Algiers"
};

// V4 — Surcharge optionnelle par la feuille « Configuration » du classeur
// registre (colonnes : Clé | Valeur). Clés reconnues : SEUIL_CRITIQUE,
// SLA_CRITIQUE_HEURES, SLA_ESCALADE_HEURES, EMAILS (séparés par des virgules).
let EMAILS_SURCHARGE_ = null;
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
  const handlers = ["onFormSubmit", "verifierCritiquesEnAttente", "rapportMensuel", "sauvegardeHebdomadaire"];
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
    console.log("✅ Déclencheurs installés : formulaires + escalade (30 min) + rapport mensuel + sauvegarde hebdomadaire.");
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
  "Date clôture", "Durée (h)", "Relance 1h", "Escalade 4h", "Email déclarant"];

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

  envoyerNotifications(sujet, corps);
  enregistrerSignalement_({
    numero: numero, poly: poly, service: service, gravite: gravite,
    delai: delai, mesures: mesures, emailDecl: emailDecl,
    statut: critique ? "CRITIQUE - En attente" : "En attente"
  });

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

  const sheet = feuilleSuivi_();
  let trouve = false, dureeH = "", emailDeclLigne = "", polyLigne = "";
  if (sheet && numero && numero !== "-") {
    const cNum = colIndex_(sheet, "Numéro");
    const donnees = sheet.getDataRange().getValues();
    for (let i = 1; i < donnees.length; i++) {
      if (String(donnees[i][cNum - 1]).trim() === numero) {
        const dateSignal = new Date(donnees[i][colIndex_(sheet, "Date") - 1]);
        const maintenant = new Date();
        dureeH = Math.round(((maintenant - dateSignal) / 3600000) * 10) / 10;
        sheet.getRange(i + 1, colIndex_(sheet, "Statut")).setValue(statutForm && statutForm !== "-" ? statutForm : "Clôturé");
        sheet.getRange(i + 1, colIndex_(sheet, "Intervention")).setValue(intervention);
        sheet.getRange(i + 1, colIndex_(sheet, "Délai réel")).setValue(delaiReelTxt);
        sheet.getRange(i + 1, colIndex_(sheet, "Date clôture")).setValue(maintenant);
        sheet.getRange(i + 1, colIndex_(sheet, "Durée (h)")).setValue(dureeH);
        emailDeclLigne = String(donnees[i][colIndex_(sheet, "Email déclarant") - 1] || "");
        polyLigne = String(donnees[i][colIndex_(sheet, "Polyclinique") - 1] || "");
        trouve = true;
        break;
      }
    }
  }

  const sujet = "✅ Clôture — " + numero;
  const corps = [
    "Clôture enregistrée pour : " + numero,
    "Intervention : " + intervention,
    "Statut : " + (statutForm || "Clôturé"),
    "Délai réel : " + delaiReelTxt,
    dureeH !== "" ? ("Durée totale : " + dureeH + " h") : "",
    trouve ? "Registre mis à jour ✔" : "⚠️ Numéro introuvable au registre — vérification manuelle requise."
  ].filter(String).join("\n");
  envoyerNotifications(sujet, corps);
  if (!trouve) alerterAdmin_("Clôture orpheline", new Error("Numéro introuvable : " + numero));

  // V4 : notification de traitement au déclarant (boucle de retour fermée)
  if (trouve && CONFIG.NOTIFIER_DECLARANT && emailDeclLigne) {
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
    const statut = String(donnees[i][c("Statut") - 1] || "");
    const gravite = parseInt(donnees[i][c("Gravité") - 1], 10) || 0;
    const estCritique = gravite >= CONFIG.SEUIL_CRITIQUE || statut.indexOf("CRITIQUE") > -1;
    const estOuvert = !donnees[i][c("Date clôture") - 1] && statut.indexOf("Clôtur") === -1;
    if (!estCritique || !estOuvert) continue;
    const ageH = (maintenant - new Date(donnees[i][c("Date") - 1])) / 3600000;
    const numero = String(donnees[i][c("Numéro") - 1]);
    if (ageH >= CONFIG.SLA_ESCALADE_HEURES && !donnees[i][c("Escalade 4h") - 1]) {
      envoyerNotifications("⏰⏰ ESCALADE — critique non clôturé depuis " + Math.round(ageH) + " h — " + numero,
        "Le signalement critique " + numero + " (" + donnees[i][c("Polyclinique") - 1] + " — " +
        donnees[i][c("Service") - 1] + ") attend toujours une clôture après " + Math.round(ageH) + " heures.\nÉvaluation et consignation au registre requises.");
      sheet.getRange(i + 1, c("Escalade 4h")).setValue(new Date());
    } else if (ageH >= CONFIG.SLA_CRITIQUE_HEURES && !donnees[i][c("Relance 1h") - 1]) {
      envoyerNotifications("⏰ RAPPEL SLA — critique en attente > 1 h — " + numero,
        "Le signalement critique " + numero + " (" + donnees[i][c("Polyclinique") - 1] + " — " +
        donnees[i][c("Service") - 1] + ") n'est pas encore clôturé après plus d'une heure (protocole : évaluation < 1 h).");
      sheet.getRange(i + 1, c("Relance 1h")).setValue(new Date());
    }
  }
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
  emails_().forEach(em => envoyerMail(em, "📊 Bilan mensuel PCI — " + (mois + 1) + "/" + annee, corps));
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
    const msg = upd.message || (upd.callback_query && upd.callback_query.message);
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
    if (g >= CONFIG.SEUIL_CRITIQUE && !donnees[i][c("Date clôture") - 1] && donnees[i][c("Numéro") - 1]) {
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
  console.log("--- SANTÉ DU SYSTÈME UPCI V3 ---");
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
  console.log("--- TEST V3 ---");
  envoyerNotifications("Test UPCI V3.0", "Test technique du système (aucune action requise).");
  console.log(texteStats_());
  console.log("--- FIN DU TEST ---");
}

// ---------------------------------------------------------------------
// 13. RECONSTRUCTION AUTOMATIQUE DU SYSTÈME (compte 23abdelhadi@gmail.com)
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
    choices: ["Moins d'1 heure", "1 à 4 heures", "4 à 24 heures", "Plus de 24 heures"] }
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
