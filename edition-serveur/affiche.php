<?php
/**
 * Affiches par polyclinique — pages A4 imprimables (une par site).
 * Chaque affiche porte l'ADRESSE du formulaire pré-rempli pour le site
 * (index.php?site=…) : générez le QR de cette adresse avec n'importe
 * quel générateur de QR (outil libre de votre choix), imprimez-le et
 * collez-le dans le cadre prévu AVANT d'afficher. Aucune bibliothèque
 * externe n'est requise par cette page.
 * ?site=<nom exact> pour une seule affiche ; sans paramètre : toutes.
 */
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/vue.php';

$cfg = upci_config();
$base = upci_base_url();
$siteDemande = (string)($_GET['site'] ?? '');
$sites = $siteDemande !== '' && in_array($siteDemande, $cfg['sites'], true)
    ? [$siteDemande]
    : $cfg['sites'];
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>ملصقات الإبلاغ — UPCI</title>
<link rel="stylesheet" href="assets/style.css">
<style>
  @page { size: A4; margin: 12mm; }
  .affiche { border: 4px solid #1d7a3a; border-radius: 18px; padding: 28px 20px;
             text-align: center; color: #10331c; page-break-after: always;
             font-family: "Traditional Arabic", "Amiri", serif; margin-bottom: 24px; }
  .affiche h1 { font-size: 32px; margin: 4px 0; color: #1d7a3a; }
  .affiche h2 { font-size: 20px; margin: 2px 0 6px; font-weight: normal; }
  .affiche .site { font-size: 26px; font-weight: bold; margin: 8px 0; }
  .qr { width: 280px; height: 280px; border: 2px dashed #999; margin: 14px auto;
        display: flex; align-items: center; justify-content: center; color: #888; font-size: 17px; padding: 10px; }
  .url { direction: ltr; unicode-bidi: embed; font-family: monospace; font-size: 14px;
         background: #f2f2f2; border-radius: 8px; padding: 8px; word-break: break-all; }
  .affiche ol { font-size: 21px; text-align: right; margin: 16px 40px; line-height: 1.9; }
  .promesse { background: #e7f4ea; border-radius: 12px; padding: 12px; font-size: 19px; margin-top: 10px; }
  .pied-a { margin-top: 14px; font-size: 15px; color: #555; }
  @media print { .no-print { display: none; } .affiche { margin: 0; } }
</style>
</head>
<body>
<p class="no-print" style="text-align:center">
  تعليمات: لكل عيادة، ولّدوا رمز QR للعنوان الظاهر تحت الإطار (بأي مولّد QR)،
  اطبعوه والصقوه داخل الإطار المقطّع، ثم اطبعوا الملصق وعلّقوه.
  <button onclick="window.print()">🖨 طباعة الكل</button>
</p>
<?php foreach ($sites as $site): ?>
<?php $url = $base . '/index.php?site=' . urlencode($site); ?>
<div class="affiche">
  <h1>لاحظتَ مشكلة تخصّ النظافة أو التعقيم أو السلامة؟</h1>
  <h2>بلّغ عنها في أقل من دقيقة — وحدة الوقاية من العدوى ومكافحتها (UPCI)</h2>
  <div class="site"><?= h($site) ?></div>

  <div class="qr">ضع هنا رمز QR<br>الخاص بهذه العيادة</div>
  <div class="url"><?= h($url) ?></div>

  <ol>
    <li>امسح الرمز بكاميرا هاتفك.</li>
    <li>أجب عن الأسئلة القصيرة (دون اسم أي مريض).</li>
    <li>أرسل — يصل التنبيه فورًا إلى مسؤولة الوحدة.</li>
  </ol>

  <div class="promesse">
    سيصلك بريد برقم بلاغك إن تركت بريدك، وبريد آخر عندما يُعالج ويُغلق.<br>
    ولمتابعة الحالة في أي وقت: افتح «Suivi» من نفس العنوان برقم بلاغك واسم العيادة.
  </div>

  <p class="pied-a">نظام الإنذار الرقمي UPCI — <?= h($cfg['etablissement']) ?><br>
  أمثلة: نفاد الصابون أو المعقّم، عطل معقّمة، وخز إبرة، خطأ في فرز النفايات، رزمة غير معقّمة…</p>
</div>
<?php endforeach; ?>
</body>
</html>
