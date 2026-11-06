# Installation — UPCI Alert, édition JavaScript portable

**Une seule base de code, deux domiciles.** Choisissez le vôtre :

- **Voie A — Cloudflare Workers + D1** : hébergement géré, URL publique
  HTTPS native (donc webhook Telegram sans effort), aucun serveur à
  entretenir. Idéal pour un déploiement pilote ou national léger.
- **Voie B — Serveur de l'établissement sous Node.js** : tout reste sur
  le réseau local de l'établissement (serveurs achetés dans le cadre de
  la numérisation), base = un seul fichier SQLite. Voir la note réseau
  du § 6 pour le webhook Telegram en LAN.

Dans les deux voies, la configuration métier se fait ensuite **dans le
navigateur** (page `/installation`) — aucun fichier à éditer.

---

## 1. Prérequis et matériel minimum

| Voie | Prérequis |
|---|---|
| A — Cloudflare | Un compte Cloudflare (offre gratuite suffisante), Node.js ≥ 20 sur le poste de l'installateur (pour wrangler) |
| B — Node | Node.js ≥ 20 sur le serveur (22.5+ requis pour `node:sqlite`, **24 recommandé**), aucun module npm à installer (zéro dépendance) |

Matériel (voie B) : n'importe quel PC/serveur de bureau allumé en continu
convient (1 Go de RAM largement suffisants) — le système est une petite
application Web + un fichier SQLite.

## 2. Voie A — Cloudflare Workers + D1

```bash
# 1) Créer la base D1 et reporter son id dans wrangler.toml
npx wrangler d1 create upci

# 2) Créer les tables (registre, journal, réglages…)
npx wrangler d1 execute upci --remote --file=schema.sql

# 3) Secrets d'amorçage (jamais dans wrangler.toml)
npx wrangler secret put UPCI_SESSION_SECRET     # chaîne aléatoire longue
npx wrangler secret put UPCI_TELEGRAM_TOKEN     # jeton BotFather (facultatif : peut aussi être saisi dans /installation)

# 4) Déployer
npx wrangler deploy
```

Ouvrez ensuite l'URL du Worker : la page **`/installation`** s'affiche
automatiquement (voir § 4). Les contrôles périodiques sont déclarés
dans `wrangler.toml` (`crons = ["*/30 * * * *"]`) — rien d'autre à
planifier. Les réglages saisis vivent dans D1 ; `wrangler.toml` ne
contient aucun secret.

Mises à jour : `npx wrangler deploy` à nouveau (les données D1 et les
réglages sont conservés).

## 3. Voie B — Serveur de l'établissement (Node.js)

```bash
# 1) Copier le projet sur le serveur, p. ex. /opt/upci (ou C:\upci)
# 2) (Facultatif) créer le fichier .env à partir du modèle
cp .env.example .env        # puis adapter PORT, UPCI_BASE_URL…

# 3) Vérifier l'installation et créer la base
node cli/init.mjs

# 4) Démarrer
node server.mjs             # écoute sur le port 8080 par défaut
```

Ouvrez `http://<adresse-du-serveur>:8080/` : la page **`/installation`**
s'affiche automatiquement (voir § 4).

**Service permanent** — Linux (systemd) :

```ini
# /etc/systemd/system/upci.service
[Unit]
Description=UPCI Alert (édition portable)
After=network.target
[Service]
WorkingDirectory=/opt/upci
ExecStart=/usr/bin/node server.mjs
Restart=always
User=upci
[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now upci
```

Windows : planificateur de tâches (« Au démarrage », action :
`node.exe C:\upci\server.mjs`) ou un service via NSSM.

**Contrôles périodiques** : la minuterie interne de `server.mjs` les
exécute toutes les 30 minutes — rien à planifier. Alternatives :
`node cli/cron.mjs` depuis cron/Planificateur, ou l'endpoint protégé
`GET /cron?key=<UPCI_CRON_KEY>` (définir la clé dans `.env`, et poser
alors `UPCI_SANS_MINUTERIE=1` si vous remplacez la minuterie).

## 4. Configuration — la page /installation (les deux voies)

Au premier lancement, toute adresse redirige vers `/installation`.
Renseignez, en langage clair :

- **Nom de l'établissement** et **polycliniques** (une par ligne) ;
- **Emails d'alerte** (chef UPCI, administration) et, en option, emails
  du bulletin mensuel ;
- **Jeton du bot Telegram** et **identifiants de conversation (chat IDs)** ;
- **Seuils** : gravité critique (4 par défaut), heures de relance (1),
  heures d'escalade (4) ;
- **Mot de passe administrateur** et **clé d'accès de la page de clôture**.

Deux boutons permettent de vérifier immédiatement, avant même
d'enregistrer : **« Envoyer un message Telegram test »** et
**« Envoyer un courriel test »** — le résultat s'affiche à l'écran.

Après enregistrement :

- la page `/installation` se **verrouille définitivement** (redirection
  vers la connexion admin) ;
- les mêmes réglages se modifient dans **Administration → Réglages**
  (`/admin/reglages`), derrière le mot de passe admin ;
- tout vit dans la **table `reglages`** de la base (D1 ou fichier
  SQLite) et est relu à chaque exécution : effet immédiat, sans
  redémarrage ni édition de fichier ;
- le jeton Telegram n'est **jamais réaffiché** après enregistrement
  (champ vide + mention « un jeton est enregistré ») ; un champ secret
  laissé vide conserve la valeur existante.

Pré-configuration possible (secours) : les variables d'environnement
`UPCI_*` (voir `.env.example` / secrets Workers) amorcent les mêmes
valeurs — celles de la base priment ensuite.

## 5. Telegram — bot et webhook

1. Créez un bot via **@BotFather** (`/newbot`) et récupérez le jeton.
2. Faites écrire un premier message au bot par chaque destinataire
   (sinon Telegram refuse l'envoi), puis récupérez les **chat IDs**
   (p. ex. via `https://api.telegram.org/bot<jeton>/getUpdates`).
3. Saisissez jeton + chat IDs dans `/installation` (ou `/admin/reglages`)
   et cliquez **« Envoyer un message Telegram test »**.
4. Le webhook (dont dépend le bouton « ✅ Pris en charge ») est
   enregistré **automatiquement** par la page des réglages : à chaque
   enregistrement, et à chaque « message Telegram test », le système
   appelle `setWebhook` sur son adresse publique (`https://…/webhook`)
   et affiche le résultat à l'écran. Rien à faire manuellement sur une
   adresse publique (Cloudflare). En secours, l'appel manuel reste :

```bash
curl "https://api.telegram.org/bot<jeton>/setWebhook" \
  -d "url=https://<votre-adresse-publique>/webhook"
```

## 6. Note réseau — webhook et réseau local (voie B)

Le **webhook Telegram exige une adresse HTTPS publique** joignable
depuis Internet :

- **Voie A (Cloudflare)** : natif — l'URL `*.workers.dev` ou votre
  domaine convient directement.
- **Voie B (serveur en LAN)** : le formulaire, les alertes sortantes et
  les contrôles fonctionnent en réseau local, MAIS le bouton d'accusé
  Telegram (qui passe par le webhook entrant) demande une exposition :
  tunnel (p. ex. Cloudflare Tunnel), adresse publique de
  l'établissement, ou hébergement du seul webhook ailleurs. Sans cela,
  tout fonctionne sauf le bouton d'accusé (les alertes partent, les
  commandes /stats et l'accusé par la page de clôture restent
  disponibles). Choisissez en connaissance de cause.

## 7. Courriel — choix technique assumé

Ni Workers ni le Node standard ne parlent SMTP sans dépendance. Le
canal courriel passe donc par une **API HTTPS générique optionnelle** :
définissez `UPCI_MAIL_API_URL` (et `UPCI_MAIL_API_KEY`, clé Bearer) —
le système y POSTe un JSON `{from, to, subject, text}` (compatible
p. ex. Resend). Sans service configuré, les courriels sont ignorés
proprement (journalisés) et **Telegram reste le canal d'alerte
principal**, comme dans les éditions précédentes. Les boutons de test
de la page de réglages affichent ce diagnostic explicitement.

## 8. Sauvegarde

- **Voie B (Node)** : la base est **un seul fichier** `data/upci.sqlite`
  (+ la table des réglages dedans). Une copie du fichier = une
  sauvegarde complète. Le système crée en plus un instantané propre
  chaque semaine dans `data/sauvegardes/` (VACUUM INTO). Restauration :
  recopier le fichier à sa place, serveur arrêté.
- **Voie A (D1)** : la base est gérée et répliquée par Cloudflare ;
  export ponctuel possible via `npx wrangler d1 export upci --remote`.

Protégez le dossier `data/` de tout accès Web direct (le serveur Node
ne sert que les routes de l'application ; derrière un reverse-proxy,
bloquez explicitement `/data/`).

## 9. Vérification après installation (checklist)

- [ ] `/installation` rempli et verrouillé (retour → redirection login)
- [ ] Boutons de test : Telegram reçu ; courriel reçu (si configuré)
- [ ] Un signalement de test envoyé depuis un téléphone → numéro reçu,
      alerte Telegram avec bouton, accusé par le bouton → statut mis à jour
- [ ] Clôture du signalement de test (page `/cloture`, clé définie)
- [ ] `Administration` : registre, bilan CLIN, journal d'audit visibles
- [ ] Mode démo (tableau de bord admin ou `node cli/seed_demo.mjs`)
      puis passage `node cli/cron.mjs --dry-run --demo` (voie B) :
      relance, escalade et regroupement simulés visibles
- [ ] Sauvegarde : copie du fichier SQLite (B) ou export D1 (A) testée

## 10. Dépannage rapide

| Symptôme | Piste |
|---|---|
| Tout redirige vers /installation | Normal tant que la première configuration n'est pas enregistrée |
| Zone admin « non activée » | Aucun mot de passe défini : /installation, ou `UPCI_ADMIN_HASH` (empreinte via `node cli/hash.mjs`) |
| Pas d'alerte Telegram | Bouton test des réglages ; jeton/chat IDs ; le destinataire doit avoir écrit au bot d'abord |
| Le bouton d'accusé ne répond pas | Webhook non enregistré ou adresse non publique (voir § 6) |
| Courriels jamais reçus | Aucun service d'email configuré (§ 7) — comportement attendu, Telegram reste principal |
| `node:sqlite` introuvable | Node < 22.5 : mettez à jour Node (24 recommandé) |

## ملخص بالعربية

هذه الطبعة تعمل في بيتين بنفس الشيفرة: **Cloudflare Workers** (قاعدة D1،
رابط HTTPS جاهز) أو **خادم المؤسسة المحلي** (Node.js وملف SQLite واحد).
التثبيت: في السحابة `wrangler deploy`، وعلى الخادم المحلي `node server.mjs`.
عند أول تشغيل تظهر صفحة **/installation** تلقائيًا: اسم المؤسسة، العيادات
(واحدة في كل سطر)، بريد التنبيهات، بوت Telegram ومعرّفات المحادثات، عتبة
الخطورة وساعات التذكير والتصعيد، كلمة سر الإدارة ومفتاح صفحة الإغلاق —
مع زرَّي اختبار فوري لتيليغرام والبريد. تُحفظ الإعدادات في قاعدة البيانات
نفسها، وتُقفل صفحة التركيب نهائيًا، وتُدار لاحقًا من **الإدارة ← الإعدادات**.
تنبيه شبكي مهم: زر الاستلام في Telegram يحتاج عنوان HTTPS عموميًا — متاح
مباشرة في Cloudflare، ويحتاج نفقًا أو عنوانًا عموميًا على الخادم المحلي؛
بدونه يعمل كل شيء إلا زر الاستلام. النسخ الاحتياطي على الخادم المحلي هو
ببساطة نسخ ملف `data/upci.sqlite`.
