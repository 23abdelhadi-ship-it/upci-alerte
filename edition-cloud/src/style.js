/** Feuille de style unique embarquée (servie par la route /assets/style.css) —
 * aucune ressource externe, comme dans l'édition PHP. */
export const STYLE_CSS = `/* UPCI Alert — édition serveur. Feuille de style unique, aucune ressource externe. */
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; background: #f4f7f4; color: #1c2b1f; }
.wrap { max-width: 980px; margin: 0 auto; padding: 16px; }
.entete { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #1d7a3a; padding-bottom: 8px; margin-bottom: 16px; flex-wrap: wrap; gap: 6px; }
.logo { font-size: 26px; font-weight: 800; color: #1d7a3a; }
.logo span { color: #10331c; font-weight: 400; }
.etab { font-size: 14px; color: #555; }
.pied { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 12.5px; color: #666; text-align: center; }
h1 { font-size: 23px; margin: 6px 0 10px; }
h2 { font-size: 19px; }
h3 { font-size: 16px; }
.intro { color: #444; }
a { color: #1d7a3a; }
code { background: #ececec; padding: 1px 5px; border-radius: 4px; }

.form label { display: block; font-weight: 600; margin: 14px 0 5px; }
.form select, .form input[type="email"], .form input[type="password"], .form input[type="text"], .form input:not([type]), .form textarea {
  width: 100%; padding: 9px; font-size: 16px; border: 1px solid #b9c9bc; border-radius: 8px; background: #fff; }
.choix { display: flex; flex-wrap: wrap; gap: 8px; }
.choix .opt { font-weight: 400; margin: 0; background: #fff; border: 1px solid #b9c9bc; border-radius: 20px; padding: 7px 13px; cursor: pointer; }
.choix.gravite .opt { font-size: 18px; padding: 7px 16px; }
.btn { display: inline-block; background: #1d7a3a; color: #fff; border: 0; border-radius: 8px;
       padding: 10px 18px; font-size: 16px; cursor: pointer; text-decoration: none; margin-top: 14px; }
.btn:hover { background: #166330; }
.btn.gros { width: 100%; font-size: 18px; padding: 13px; }
.btn.secondaire { background: #5b7a63; }

.alerte { background: #fdecea; border: 1px solid #d9534f; color: #7a1d18; border-radius: 10px; padding: 12px 16px; margin: 12px 0; }
.ok { background: #e7f4ea; border: 1px solid #1d7a3a; color: #10331c; border-radius: 10px; padding: 12px 16px; margin: 12px 0; }
.recu { background: #fff; border: 2px solid #1d7a3a; border-radius: 14px; padding: 20px; text-align: center; margin-top: 14px; }
.recu .numero { font-size: 34px; font-weight: 800; color: #1d7a3a; letter-spacing: 1px; margin: 8px 0; }
.recu .note { color: #555; font-size: 14px; }

table.ind { border-collapse: collapse; background: #fff; width: 100%; margin: 10px 0; }
table.ind th, table.ind td { border: 1px solid #d5e0d7; padding: 7px 10px; text-align: left; }
table.ind th { background: #e7f4ea; width: 45%; }
table.reg { border-collapse: collapse; background: #fff; width: 100%; font-size: 13.5px; }
table.reg th, table.reg td { border: 1px solid #d5e0d7; padding: 6px 8px; text-align: left; vertical-align: top; }
table.reg th { background: #e7f4ea; }
table.reg tr.crit td { background: #fff3f0; }

.cartes { display: flex; flex-wrap: wrap; gap: 12px; margin: 14px 0; }
.carte { background: #fff; border: 1px solid #d5e0d7; border-radius: 12px; padding: 14px 18px; min-width: 140px; text-align: center; color: #444; }
.carte span { display: block; font-size: 30px; font-weight: 800; color: #10331c; }
.carte.rouge span { color: #c0392b; }
.carte.vert span { color: #1d7a3a; }
.grille { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.bloc { background: #fff; border: 1px solid #d5e0d7; border-radius: 12px; padding: 14px 18px; margin: 14px 0; }
.bloc table.ind { margin: 0; }
.admin-nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.admin-nav a { background: #10331c; color: #fff; padding: 7px 13px; border-radius: 18px; text-decoration: none; font-size: 14px; }
.filtres { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
.filtres select, .filtres input { padding: 8px; font-size: 15px; border: 1px solid #b9c9bc; border-radius: 8px; }
.filtres .btn { margin-top: 0; }
.document { background: #fff; border: 1px solid #d5e0d7; border-radius: 12px; padding: 18px 22px; margin: 14px 0; }
pre.texte { background: #10241a; color: #d9f2de; padding: 14px; border-radius: 10px; overflow-x: auto; font-size: 13.5px; }

@media print {
  body { background: #fff; }
  .admin-nav, .filtres, .pied, form { display: none; }
  .document { border: 0; }
}
`;
