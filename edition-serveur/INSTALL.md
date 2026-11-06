# Installation — UPCI Alert, édition serveur

Guide d'installation pour le technicien de l'établissement. Trois voies au
choix : **Docker** (la plus simple), **XAMPP** (Windows) ou **LAMP** (Linux).
Dans tous les cas, il n'y a **aucune dépendance à télécharger** pour
l'application elle-même : PHP 8 + SQLite suffisent.

> **ملخص بالعربية في نهاية هذا الدليل.**

---

## 1. Prérequis et matériel minimum

| Élément | Minimum | Remarque |
|---|---|---|
| Machine | N'importe quel PC/serveur de bureau allumé en continu | 1 Go de RAM et 1 Go de disque libres suffisent largement |
| OS | Windows 10+ ou Linux | Au choix selon le parc de l'établissement |
| Runtime | PHP 8.0+ avec l'extension `pdo_sqlite` | Fourni par XAMPP, LAMP ou l'image Docker jointe |
| Réseau | Réseau local (LAN) de l'établissement | **Internet uniquement** pour Telegram et l'email externe |
| Email (optionnel) | Un MTA local ou le SMTP de l'établissement | Sans email, le système fonctionne ; Telegram reste le canal principal |

Le système est **LAN-first** : signalement, registre, clôture, rapports et
cron fonctionnent entièrement en réseau local. Si Internet tombe, seuls les
envois Telegram/email différés sont affectés — rien n'est perdu, tout est
enregistré d'abord dans la base locale.

## 2. Voie A — Docker (recommandée, une commande)

Sur le serveur (Docker Engine + Docker Compose installés) :

```bash
cd upci_serveur
docker compose up -d
php -v # (sur l'hôte, facultatif)
```

Puis, une seule fois, initialisez et vérifiez depuis le conteneur web :

```bash
docker compose exec web php cli/init.php
```

Ouvrez ensuite `http://<IP-du-serveur>:8080/` (formulaire) et
`http://<IP-du-serveur>:8080/admin/` (administration). Le service `cron`
du fichier compose exécute déjà `cli/cron.php` toutes les 30 minutes —
aucune autre planification n'est nécessaire avec cette voie.

**Secrets sous Docker** : ne touchez pas à config.php ; passez les variables
d'environnement au shell avant le lancement (elles priment sur config.php) :

```bash
export UPCI_CLOSURE_KEY="une-cle-longue-propre-a-letablissement"
export UPCI_ADMIN_HASH="$(php -r "echo password_hash('MotDePasseAdmin', PASSWORD_DEFAULT);")"
export UPCI_TELEGRAM_TOKEN="123456:ABC-..."          # jeton BotFather
export UPCI_TELEGRAM_CHATS="123456789"               # chat id du/de la chef UPCI
export UPCI_TELEGRAM_SECRET="un-secret-webhook"      # recommandé
docker compose up -d
```

## 3. Voie B — XAMPP sous Windows

1. Installez XAMPP (Apache + PHP 8) et démarrez **Apache** depuis le panneau
   de contrôle.
2. Copiez le dossier `upci_serveur` dans `C:\xampp\htdocs\upci`.
3. Vérifiez que l'extension SQLite est active : dans `C:\xampp\php\php.ini`,
   la ligne `extension=pdo_sqlite` doit être décommentée (XAMPP l'active
   par défaut).
4. Dans un terminal : `cd C:\xampp\htdocs\upci` puis
   `C:\xampp\php\php.exe cli\init.php` — tous les voyants doivent être ✅.
5. Ouvrez `http://localhost/upci/` (ou `http://<IP-du-serveur>/upci/` depuis
   les postes et téléphones du réseau local).
6. **Tâches planifiées** (Planificateur de tâches Windows) : créez une tâche
   « UPCI cron » qui lance `C:\xampp\php\php.exe` avec l'argument
   `C:\xampp\htdocs\upci\cli\cron.php`, répétition **toutes les 30 minutes**,
   utilisateur SYSTEM, « exécuter même si aucun utilisateur n'est connecté ».

## 4. Voie C — LAMP sous Linux

```bash
sudo apt install apache2 php php-sqlite3        # ou l'équivalent de votre distribution
sudo cp -r upci_serveur /var/www/html/upci
sudo chown -R www-data:www-data /var/www/html/upci/data
sudo chmod 775 /var/www/html/upci/data
cd /var/www/html/upci && php cli/init.php
```

Ouvrez `http://<IP-du-serveur>/upci/`. Planification (crontab de www-data) :

```cron
*/30 * * * * php /var/www/html/upci/cli/cron.php >> /var/log/upci-cron.log 2>&1
```

## 5. Configuration — config.php (le seul fichier à régler)

Ouvrez `config.php` et remplacez les valeurs d'exemple :

- `etablissement`, `wilaya` : identité affichée partout.
- `sites`, `services`, `lieux`, `types_urgence`… : **vos** listes fermées
  (les 9 polycliniques de Saïda ne sont qu'un exemple).
- `base_url` : l'adresse publique de l'application, ex.
  `http://192.168.1.50/upci` — indispensable pour des liens corrects dans
  les emails et les affiches.
- `emails_alertes` : chef d'unité UPCI + superviseur.
- `closure_key` : **une clé longue et unique** — elle protège la page de
  clôture. Tant qu'elle vaut `CHANGEZ-CETTE-CLE`, la page reste verrouillée.
- `admin_password_hash` : générez-la avec
  `php -r "echo password_hash('VotreMotDePasse', PASSWORD_DEFAULT), PHP_EOL;"`
- Seuils (déjà éprouvés) : critique ≥ 4, relance 1 h, escalade 4 h,
  vérification d'efficacité 7 j, regroupement ≥ 3 / 7 j, silence 3 semaines.

## 6. Telegram — bot et webhook

1. Créez le bot via **@BotFather** (`/newbot`) et notez le jeton.
2. Faites écrire un message au bot par chaque destinataire, puis récupérez
   les `chat id` (par ex. via `https://api.telegram.org/bot<JETON>/getUpdates`).
3. Renseignez `telegram_token` et `telegram_chat_ids` (config.php ou
   variables d'environnement).
4. Enregistrez le webhook (le bouton « ✅ Pris en charge » en dépend) :

```bash
php cli/init.php --webhook
```

   …qui appelle `setWebhook` vers `<base_url>/webhook.php` avec le secret si
   défini. Équivalent manuel :

```bash
curl "https://api.telegram.org/bot<JETON>/setWebhook?url=<BASE_URL>/webhook.php&secret_token=<SECRET>"
```

> Note : Telegram exige une URL **HTTPS publique** pour le webhook. Sur un
> serveur purement local sans nom de domaine, le bouton d'accusé ne peut pas
> fonctionner (les alertes sortantes, elles, fonctionnent : ce sont des
> appels sortants). Solutions : exposer le serveur via le nom de domaine de
> l'établissement, ou utiliser l'édition Apps Script pour l'accusé Telegram
> tout en gardant l'édition serveur pour le registre local. Les relances et
> escalades par email ne sont pas affectées.

## 7. Sauvegarde

La base entière tient dans **un seul fichier** : `data/upci.sqlite`.

- **Manuelle** : copiez ce fichier où vous voulez (clé USB, autre poste).
- **Scriptée** : `php cli/backup.php` produit un instantané propre dans
  `data/sauvegardes/upci-AAAAMMJJ-HHMMSS.sqlite` (purge au-delà de 90 jours).
- **Automatique** : le cron hebdomadaire fait déjà une sauvegarde ; planifiez
  en plus une copie du dossier `data/` vers un support externe chaque semaine.
- **Restauration** : arrêtez le serveur web, remplacez `data/upci.sqlite`
  par la sauvegarde, relancez. C'est tout.

## 8. Protection du dossier data/ (Nginx)

Sous Apache, les fichiers `.htaccess` livrés bloquent déjà l'accès direct à
`data/` et `lib/`. Sous Nginx, ajoutez dans le bloc `server` :

```nginx
location ~ ^/upci/(data|lib)/ { deny all; }
```

Et ne servez jamais le dossier du projet en entier sans ces règles : la base
contient les emails des déclarants (usage interne).

## 9. Vérification après installation (checklist)

- [ ] `php cli/init.php` : tous les voyants ✅ (ou ⚠️ compris et acceptés)
- [ ] Un signalement de test arrive sur Telegram et par email en quelques secondes
- [ ] Son accusé (bouton « ✅ Pris en charge ») met à jour le message et le registre
- [ ] Sa clôture depuis `cloture.php` passe la ligne à « Clôturé » avec la durée,
      et le déclarant reçoit l'email de clôture
- [ ] `php cli/seed_demo.php` puis `php cli/cron.php --dry-run --demo` : les relances,
      l'escalade et le regroupement du jeu démo sont annoncés
- [ ] `php cli/purge_demo.php` : le registre est propre après la démonstration
- [ ] Zone `/admin/` : tableau de bord, registre, bilan CLIN et journal s'affichent
- [ ] Affiches imprimées depuis `affiche.php` (QR collé) dans chaque service
- [ ] Clé de clôture et mot de passe admin **changés** par rapport aux exemples

## 10. Dépannage rapide

| Symptôme | Cause probable | Remède |
|---|---|---|
| Page blanche / erreur 500 | Extension `pdo_sqlite` inactive | Activez-la dans php.ini, redémarrez Apache |
| « Base de données verrouillée » | Concurrence sur le fichier SQLite | Vérifiez qu'un seul cron tourne ; le mode WAL + busy_timeout sont déjà réglés |
| Aucune alerte Telegram | Jeton ou chat id erroné ; destinataire n'a jamais écrit au bot | Faites écrire au bot, corrigez les ids, retestez |
| Alertes OK mais bouton d'accusé muet | Webhook non enregistré ou pas d'HTTPS public | Voir §6 |
| Aucun email | Pas de MTA sur le serveur | Installez/configurez le relais SMTP de l'établissement ; Telegram continue d'alerter |
| Pas de relance/escalade | Cron non planifié | Voie Docker : service `cron` actif ; sinon vérifiez crontab / Planificateur de tâches |
| Heure décalée | Fuseau du serveur | `timezone` dans config.php vaut `Africa/Algiers` par défaut |

## 11. Mise à jour

Remplacez les fichiers du programme par la nouvelle version **sans toucher**
à `config.php` ni au dossier `data/` : la base se met à jour toute seule au
premier accès (schéma créé « si absent »). Sauvegardez avant, comme toujours.

---

## ملخص بالعربية

**ما هذا؟** نفس نظام تنبيه UPCI لكنه يعمل كليًا على الخادم المحلي للمؤسسة
(ذاك الذي أمرت الوزارة باقتنائه) — دون Google ودون إنترنت إلا لتنبيهات
Telegram والبريد.

**التركيب بأقصر طريق:**

1. **Docker:** داخل مجلد المشروع نفّذوا `docker compose up -d` ثم
   `docker compose exec web php cli/init.php` وافتحوا
   `http://<الخادم>:8080`.
2. **Windows/XAMPP:** انسخوا المجلد إلى `C:\xampp\htdocs\upci`، شغّلوا
   `php cli\init.php`، وجدولوا `cli\cron.php` كل 30 دقيقة من «مخطّط المهام».
3. **Linux/LAMP:** انسخوا المجلد إلى `/var/www/html/upci`، أعطوا صلاحية الكتابة
   لمجلد `data`، وأضيفوا سطر الـ cron الموجود أعلاه.

**قبل الإنتاج، في ملف `config.php` فقط:** اسم المؤسسة ومواقعها، بريد المستلمين،
**مفتاح إغلاق** طويل خاص بكم، و**بصمة كلمة مرور الإدارة** (تولّد بالأمر المذكور
في الدليل) — القيم الجاهزة في الملف أمثلة فقط.

**النسخ الاحتياطي:** كل النظام في ملف واحد `data/upci.sqlite` — انسخوه أسبوعيًا
لأي وسائط خارجي، أو شغّلوا `php cli/backup.php`، علمًا أن الـ cron ينسخ
تلقائيًا كل أسبوع.

**تنبيه مهم:** زرّ «تمت الاستلام» في Telegram يحتاج عنوان HTTPS عموميًا للخادم؛
إن بقي الخادم داخل الشبكة المحلية فقط، تعمل التنبيهات الصادرة والتصعيدات
بالبريد كالمعتاد، ويُستعاض عن الزرّ بالتأكيد عبر صفحة الإغلاق.
