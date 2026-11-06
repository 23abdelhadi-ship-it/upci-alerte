Ce dossier contient, dès la première utilisation :

  upci.sqlite        — TOUTE la base (registre, journal, compteurs).
                       Sauvegarde = copier ce fichier.
  sauvegardes/       — instantanés automatiques hebdomadaires
                       (cli/backup.php et cron) au format upci-AAAAMMJJ-HHMMSS.sqlite.

Ne partagez jamais ce dossier sur le web : le .htaccess joint bloque l'accès
direct sous Apache ; sous Nginx, ajoutez la règle donnée dans INSTALL.md.
