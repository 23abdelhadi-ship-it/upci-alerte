<?php
/** Garde commune de la zone admin — session + vérification de connexion. */
require dirname(__DIR__) . '/lib/bootstrap.php';
require dirname(__DIR__) . '/lib/db.php';
require dirname(__DIR__) . '/lib/notify.php';
require dirname(__DIR__) . '/lib/metier.php';
require dirname(__DIR__) . '/lib/rapports.php';
require dirname(__DIR__) . '/lib/vue.php';

session_start();
if (empty($_SESSION['upci_admin'])) {
    header('Location: login.php');
    exit;
}

function admin_debut(string $titre): void
{
    upci_page_debut($titre, '../');
    echo '<nav class="admin-nav">'
        . '<a href="index.php">Tableau de bord</a>'
        . '<a href="registre.php">Registre</a>'
        . '<a href="rapport.php">Bilan CLIN</a>'
        . '<a href="bulletin.php">Bulletin</a>'
        . '<a href="journal.php">Journal</a>'
        . '<a href="../cloture.php" target="_blank">Page de clôture</a>'
        . '<a href="logout.php">Déconnexion</a>'
        . '</nav>';
}

function admin_fin(): void
{
    upci_page_fin();
}
