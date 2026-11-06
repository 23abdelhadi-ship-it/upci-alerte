<?php
/**
 * =====================================================================
 * UPCI ALERT — ÉDITION SERVEUR • CONFIGURATION UNIQUE
 * =====================================================================
 * C'est le SEUL fichier à modifier pour installer le système dans un
 * établissement. Toutes les valeurs ci-dessous sont des PLACEHOLDERS :
 * remplacez-les par celles de VOTRE établissement avant la mise en
 * production. Aucun secret réel ne doit être commité/partagé.
 *
 * Certains secrets peuvent aussi être fournis par variables
 * d'environnement (prioritaires) — pratique recommandée sous Docker :
 *   UPCI_TELEGRAM_TOKEN, UPCI_TELEGRAM_SECRET, UPCI_CLOSURE_KEY,
 *   UPCI_ADMIN_HASH
 * =====================================================================
 */
return [

    // --- Établissement -------------------------------------------------
    'etablissement' => 'EPSP — NOM DE L’ÉTABLISSEMENT',
    'wilaya'        => 'Wilaya',
    'timezone'      => 'Africa/Algiers',

    // URL publique de l'application (pour les liens dans les emails et
    // les affiches QR). Vide = détection automatique (déconseillé en prod).
    // Exemple : 'http://192.168.1.50' ou 'http://serveur-epsp/upci'
    'base_url' => '',

    // Base de données : UN seul fichier SQLite. La sauvegarde = sa copie.
    'db_path' => __DIR__ . '/data/upci.sqlite',

    // --- Listes fermées du formulaire (à adapter à l'établissement) ----
    // EXEMPLE : les 9 polycliniques de l'EPSP de Saïda — remplacez par les vôtres.
    'sites' => [
        'السلام 2', 'الرباحية', '1000 سكن', 'الشمال «لامارين»', 'سيدي قاسم',
        'سيدي الشيخ', 'النصر', 'عمروس', '1200 سكن',
    ],
    'services' => [
        'Urgences', 'Consultations', 'Laboratoire', 'Radiologie', 'Maternité',
        'Pharmacie', 'Stérilisation centrale', 'Soins', 'Administration', 'Autre',
    ],
    'lieux' => [
        'Entrée du service', 'Salle de soins', 'Salle d’attente', 'Local déchets',
        'Magasin / stockage', 'Sanitaires', 'Couloir', 'Bureau', 'Autre',
    ],
    'periodes' => ['Matin', 'Soir', 'Nuit'],
    // Types d'incidents PCI (choix multiple) — liste fermée, aucun texte libre.
    'types_urgence' => [
        'Rupture de stock (savon / solution hydro-alcoolique)',
        'Tri incorrect des déchets (DASRI)',
        'Panne d’équipement (stérilisateur, autoclave…)',
        'Piqûre / AES (accident d’exposition au sang)',
        'Hygiène des mains non respectée',
        'Pack / matériel non stérile',
        'Problème d’eau ou d’assainissement',
        'Autre incident PCI',
    ],
    'actions_immediates' => ['Oui, totalement', 'Oui, partiellement', 'Non'],
    'mesures' => [
        'Nettoyage / désinfection immédiate',
        'Produit remplacé',
        'Équipement mis hors service',
        'Zone isolée ou signalée',
        'Responsable informé',
        'Aucune mesure possible',
    ],
    'delais_souhaites' => ['Immédiat', 'Aujourd’hui même', 'Sous 24 h', 'Sous 48 h'],
    'delais_reels'     => ['Moins d’1 heure', '1 à 4 heures', '4 à 24 heures', 'Plus de 24 heures'],
    'statuts_cloture'  => ['Clôturé', 'Partiellement résolu', 'En cours de traitement', 'Non résolu — à escalader'],

    // Sites exemptés du moniteur de silence (fermeture, travaux…)
    'sites_exempts' => [],

    // --- Règles d'escalade (valeurs éprouvées de l'édition Apps Script) -
    'seuil_critique'        => 4,   // gravité >= 4 → critique
    'sla_relance_h'         => 1,   // relance si critique ouvert > 1 h
    'sla_escalade_h'        => 4,   // escalade marquée si critique ouvert > 4 h
    'sla_accuse_h'          => 1,   // rappel « non pris en charge » (critique sans accusé)
    'verif_efficacite_jours'=> 7,   // rappel vérification d'efficacité après clôture d'un critique
    'seuil_groupe'          => 3,   // >= N signalements même type + même site…
    'fenetre_groupe_jours'  => 7,   // …dans cette fenêtre → « Regroupement suspecté »
    'silence_semaines'      => 3,   // semaines sans signalement = site silencieux

    // --- Destinataires --------------------------------------------------
    'emails_alertes'  => ['chef-upci@exemple.dz', 'admin@exemple.dz'],
    'emails_bulletin' => [],  // vide = emails_alertes
    'mail_from'       => 'upci@exemple.dz',

    // --- Telegram (canal d'alerte uniquement — aucune donnée sensible) --
    'telegram_token'         => '',  // jeton BotFather — ou env UPCI_TELEGRAM_TOKEN
    'telegram_chat_ids'      => [],  // ex. ['123456789'] — ou env UPCI_TELEGRAM_CHATS (virgules)
    'telegram_webhook_secret'=> '',  // secret du webhook — ou env UPCI_TELEGRAM_SECRET
    'accuse_telegram'        => true, // bouton « ✅ Pris en charge » sur l'alerte

    // --- Accès protégés ---------------------------------------------------
    // Clé d'accès de la page de clôture (interne uniquement). CHANGEZ-LA.
    'closure_key' => 'CHANGEZ-CETTE-CLE',
    // Empreinte du mot de passe admin — générez-la avec :
    //   php -r "echo password_hash('VotreMotDePasse', PASSWORD_DEFAULT), PHP_EOL;"
    // Vide = zone admin verrouillée tant qu'elle n'est pas définie.
    'admin_password_hash' => '',
];
