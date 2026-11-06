<?php
/** Bulletin « Vous avez signalé → nous avons changé » — génération + envoi email. */
require __DIR__ . '/_garde.php';

$cfg = upci_config();
$pdo = upci_db();

$defaut = strtotime('first day of last month');
$annee = (int)($_REQUEST['annee'] ?? date('Y', $defaut));
$mois  = (int)($_REQUEST['mois'] ?? date('n', $defaut));
if ($mois < 1 || $mois > 12) $mois = (int)date('n', $defaut);
if ($annee < 2024 || $annee > 2100) $annee = (int)date('Y', $defaut);

$bul = upci_bulletin($pdo, $cfg, $annee, $mois);
$message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['envoyer'])) {
    $dest = $cfg['emails_bulletin'] ?: $cfg['emails_alertes'];
    if ($bul['nb_fermes'] === 0 && !$bul['changements']) {
        $message = 'Bulletin vide (aucune clôture ce mois-là) — envoi annulé.';
        upci_journal($pdo, '', 'Admin (bulletin)', 'bulletin', 'Envoi ignoré : mois vide ' . $mois . '/' . $annee);
    } else {
        $n = 0;
        foreach ($dest as $email) {
            if (upci_mail($email, 'Bulletin UPCI — Vous avez signalé → nous avons changé (' . upci_mois_nom($annee, $mois) . ')',
                upci_bulletin_texte($bul, $cfg))) {
                $n++;
            }
        }
        upci_journal($pdo, '', 'Admin (bulletin)', 'bulletin', 'Envoyé à ' . $n . ' destinataire(s) pour ' . upci_mois_nom($annee, $mois));
        $message = 'Bulletin envoyé à ' . $n . ' destinataire(s) (' . implode(', ', $dest) . ').'
            . ($n === 0 ? ' ⚠️ Aucun envoi n’a abouti : vérifiez le serveur d’email (MTA).' : '');
    }
}

admin_debut('Bulletin mensuel');
echo '<h1>Bulletin « Vous avez signalé → nous avons changé »</h1>'
    . '<p class="intro">Construit automatiquement des clôtures du mois choisi. Objectif : prouver aux déclarants que signaler fait changer les choses.</p>'
    . '<form method="get" class="filtres"><label>Mois</label><select name="mois">';
for ($m = 1; $m <= 12; $m++) echo '<option value="' . $m . '"' . ($m === $mois ? ' selected' : '') . '>' . $m . '</option>';
echo '</select><label>Année</label><input type="number" name="annee" value="' . $annee . '" style="width:90px">'
    . '<button class="btn" type="submit">Générer</button></form>';
if ($message) echo '<div class="ok">' . h($message) . '</div>';
echo '<div class="document">' . upci_bulletin_html($bul, $cfg) . '</div>'
    . '<form method="post"><input type="hidden" name="mois" value="' . $mois . '">'
    . '<input type="hidden" name="annee" value="' . $annee . '">'
    . '<button class="btn" type="submit" name="envoyer" value="1">📨 Envoyer par email aux destinataires du bulletin</button> '
    . '<button class="btn secondaire" type="button" onclick="window.print()">🖨 Imprimer</button></form>'
    . '<h3>Version texte</h3><pre class="texte">' . h(upci_bulletin_texte($bul, $cfg)) . '</pre>';
admin_fin();
