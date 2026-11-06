<?php
/** Petits helpers d'affichage partagés par les pages web. */
defined('UPCI') or exit;

function upci_page_debut(string $titre, string $base = ''): void
{
    $cfg = upci_config();
    echo '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<title>' . h($titre) . ' — UPCI</title>'
        . '<link rel="stylesheet" href="' . h($base) . 'assets/style.css">'
        . '</head><body><div class="wrap">'
        . '<header class="entete"><div class="logo">UPCI <span>Alert</span></div>'
        . '<div class="etab">' . h($cfg['etablissement']) . ' — ' . h($cfg['wilaya']) . '</div></header>';
}

function upci_page_fin(): void
{
    echo '<footer class="pied">Système d’alerte numérique UPCI — édition serveur. '
        . 'Aucune donnée patient n’est collectée.</footer></div></body></html>';
}
