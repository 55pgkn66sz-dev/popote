/* Consommations individuelles : logique pure (sans DOM ni Grist), testable sous Node.
   Reprise adaptée du module « Consommations » de SERVIR : identifiant de colonne par type (csoId),
   IBAN (clé modulo 97), QR de virement SEPA (norme EPC), calcul dû / réglé / solde.
   Retiré par rapport à SERVIR : pelotons, cadres, effets commandés (hors périmètre : personnes seulement). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConsoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var T = {
    CONFIG: 'Conso_Config',
    CONSOMMATEURS: 'Conso_Consommateurs',
    TYPES: 'Conso_Types',
    CONSOMMATIONS: 'Conso_Consommations',
    REGLEMENTS: 'Conso_Reglements',
    ACHATS: 'Conso_Achats',
    STOCKS: 'Conso_Stocks'
  };

  /* Colonnes de Conso_Consommations qui ne sont pas des types de consommation. */
  var RESERVED = ['id', 'manualSort', 'Date', 'Consommateur', 'Commentaire'];

  var MOTIFS = { REAPPRO: 'Réapprovisionnement', PERTE: 'Perte ou casse', INVENTAIRE: 'Inventaire' };

  var DEFAULT_TYPES = [
    { libelle: 'Café', tarif: 0.5 }, { libelle: 'Boisson fraîche', tarif: 1 },
    { libelle: 'Petit-déjeuner', tarif: 2.5 }, { libelle: 'Repas midi', tarif: 6 }, { libelle: 'Repas soir', tarif: 6 }
  ];

  var DROPDOWN_ACTIF = { text: 'choice.Actif', parsed: JSON.stringify(['Attr', ['Name', 'choice'], 'Actif']) };

  /* Schéma documenté (voir README). `ref` : la table contient une référence, elle est créée après les autres.
     Les tables de référence (écriture réservée au gestionnaire) : Config, Consommateurs, Types. */
  var SCHEMA = [
    { id: T.CONFIG, kind: 'reference', usage: 'Réglages (une seule ligne) : coordonnées de règlement, lien du formulaire, gestionnaire', cols: [
      { id: 'Titulaire', type: 'Text', label: 'Titulaire du compte' },
      { id: 'IBAN', type: 'Text', label: 'IBAN' },
      { id: 'Numero_Wero', type: 'Text', label: 'Numéro Wero' },
      { id: 'QR_Contenu', type: 'Text', label: 'Contenu du QR personnalisé' },
      { id: 'Lien_formulaire', type: 'Text', label: 'Lien du formulaire externe' },
      { id: 'Email_gestionnaire', type: 'Text', label: 'Courriel du gestionnaire' }
    ] },
    { id: T.CONSOMMATEURS, kind: 'reference', usage: 'Liste des consommateurs (personnes)', cols: [
      { id: 'Nom', type: 'Text', label: 'Nom' },
      { id: 'Email', type: 'Text', label: 'Courriel' },
      { id: 'Actif', type: 'Bool', label: 'Actif' }
    ] },
    { id: T.TYPES, kind: 'reference', usage: 'Types de consommation et tarifs ; Colonne = colonne correspondante de Conso_Consommations', cols: [
      { id: 'Libelle', type: 'Text', label: 'Libellé' },
      { id: 'Colonne', type: 'Text', label: 'Colonne' },
      { id: 'Tarif', type: 'Numeric', label: 'Tarif unitaire (€)' },
      { id: 'Actif', type: 'Bool', label: 'Actif' },
      { id: 'Seuil_alerte', type: 'Numeric', label: 'Seuil d’alerte du stock' }
    ] },
    { id: T.CONSOMMATIONS, kind: 'saisie', ref: true, usage: 'Consommations déclarées (formulaire externe) ; une colonne Numeric par type', cols: [
      { id: 'Date', type: 'Date', label: 'Date', formula: 'TODAY()', recalcWhen: 0 },
      { id: 'Consommateur', type: 'Ref:' + T.CONSOMMATEURS, label: 'Consommateur', dropdown: true },
      { id: 'Commentaire', type: 'Text', label: 'Commentaire' }
    ] },
    { id: T.REGLEMENTS, kind: 'saisie', ref: true, usage: 'Règlements enregistrés par le gestionnaire', cols: [
      { id: 'Date', type: 'Date', label: 'Date' },
      { id: 'Consommateur', type: 'Ref:' + T.CONSOMMATEURS, label: 'Consommateur' },
      { id: 'Montant', type: 'Numeric', label: 'Montant (€)' },
      { id: 'Observations', type: 'Text', label: 'Observations' }
    ] },
    { id: T.STOCKS, kind: 'saisie', usage: 'Mouvements de stock par type : réapprovisionnements, pertes, ajustements d’inventaire (le stock = mouvements − consommations)', cols: [
      { id: 'Date', type: 'Date', label: 'Date' },
      { id: 'Colonne', type: 'Text', label: 'Colonne du type' },
      { id: 'Libelle', type: 'Text', label: 'Type' },
      { id: 'Quantite', type: 'Numeric', label: 'Quantité (+ entrée, − sortie)' },
      { id: 'Motif', type: 'Choice', label: 'Motif', choices: [MOTIFS.REAPPRO, MOTIFS.PERTE, MOTIFS.INVENTAIRE] },
      { id: 'Observations', type: 'Text', label: 'Observations' }
    ] },
    { id: T.ACHATS, kind: 'saisie', usage: 'Achats de fournitures faits par le gestionnaire (café, denrées…)', cols: [
      { id: 'Date', type: 'Date', label: 'Date' },
      { id: 'Libelle', type: 'Text', label: 'Libellé' },
      { id: 'Fournisseur', type: 'Text', label: 'Fournisseur' },
      { id: 'Montant', type: 'Numeric', label: 'Montant (€)' },
      { id: 'Observations', type: 'Text', label: 'Observations' }
    ] }
  ];

  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

  /* Identifiant de colonne valide (lettres, chiffres, _), repris de SERVIR. */
  function csoId(label) {
    var b = String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return (/^[A-Za-z]/.test(b) ? b : 'C_' + b).slice(0, 40).replace(/_+$/, '') || 'Conso';
  }
  /* Identifiant unique (Grist ignore la casse) parmi `taken` et les colonnes réservées. */
  function uniqueColId(label, taken) {
    var low = (taken || []).concat(RESERVED).map(function (x) { return String(x).toLowerCase(); }), base = csoId(label), id = base, n = 2;
    while (low.indexOf(id.toLowerCase()) !== -1) id = base + '_' + (n++);
    return id;
  }

  function cents(n) { var v = Number(String(n == null ? '' : n).replace(',', '.')); return isFinite(v) ? Math.round(v * 100) : 0; }
  function eur(c) { return (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function parseAmount(v) { var s = String(v == null ? '' : v).trim().replace(/\s/g, '').replace(',', '.'); if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN; return Math.round(parseFloat(s) * 100) / 100; }

  function ibanClean(v) { return String(v || '').replace(/\s+/g, '').toUpperCase(); }
  function ibanFmt(v) { return ibanClean(v).replace(/(.{4})(?=.)/g, '$1 '); }
  function ibanOk(v) { // forme + clé de contrôle modulo 97
    var c = ibanClean(v); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(c)) return false;
    var r = c.slice(4) + c.slice(0, 4), n = 0;
    for (var i = 0; i < r.length; i++) { var ch = r.charCodeAt(i); n = (ch >= 65 ? n * 100 + ch - 55 : n * 10 + ch - 48) % 97; }
    return n === 1;
  }

  function oneLine(s, max) { return String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max); }
  /* Contenu du QR : celui saisi par le gestionnaire, sinon virement SEPA (EPC069-12) pré-rempli.
     Wero ne publie pas de format ouvert : le QR « Recevoir » de l'application Wero se colle dans QR_Contenu. */
  function weroPayload(cfg, opt) {
    opt = opt || {};
    if (cfg.qr) return String(cfg.qr).trim();
    if (!cfg.titulaire || !ibanOk(cfg.iban)) return '';
    var amount = opt.amountCents > 0 && opt.amountCents <= 99999999999 ? 'EUR' + (opt.amountCents / 100).toFixed(2) : '';
    return ['BCD', '002', '1', 'SCT', '', oneLine(cfg.titulaire, 70), ibanClean(cfg.iban), amount, '', '', oneLine(opt.label || 'Consommations', 140)].join('\n');
  }

  function isHttpUrl(u) {
    var s = String(u || '').trim(); if (!/^https?:\/\//i.test(s)) return false;
    try { var p = new URL(s).protocol; return p === 'https:' || p === 'http:'; } catch (e) { return false; }
  }

  /* Lecture normalisée de la configuration (une seule ligne ; la première si plusieurs). */
  function readConfig(rows) {
    var r = (rows && rows[0]) || {};
    function s(k) { return String(r[k] == null ? '' : r[k]).trim(); }
    return { id: r.id || 0, titulaire: s('Titulaire'), iban: s('IBAN'), numero: s('Numero_Wero'), qr: s('QR_Contenu'), lien: s('Lien_formulaire'), gestionnaire: s('Email_gestionnaire'), many: (rows || []).length > 1 };
  }

  /* Types : lignes de Conso_Types -> [{ id, libelle, colonne, prix (€), actif }] ; sans colonne, la ligne est ignorée. */
  function readTypes(rows) {
    return (rows || []).filter(function (r) { return r.Libelle && r.Colonne; }).map(function (r) {
      return { id: r.id, libelle: String(r.Libelle), colonne: String(r.Colonne), prix: Number(r.Tarif) || 0, actif: r.Actif !== false && r.Actif !== 0, seuil: Math.max(0, Number(r.Seuil_alerte) || 0) };
    });
  }

  /* Dû / réglé / solde par consommateur, en centimes (pas d'erreur d'arithmétique flottante).
     consommations : lignes de Conso_Consommations ; reglements : lignes de Conso_Reglements. */
  function computeBalances(d) {
    var types = d.types || [], map = {}, list = [];
    (d.consommateurs || []).forEach(function (c) {
      var o = { id: c.id, nom: String(c.Nom || '').trim(), email: String(c.Email || '').trim(), actif: c.Actif !== false && c.Actif !== 0, qty: {}, duCents: 0, paidCents: 0, soldeCents: 0, nConso: 0, nPay: 0 };
      types.forEach(function (t) { o.qty[t.colonne] = 0; });
      map[c.id] = o; list.push(o);
    });
    var orphans = { conso: 0, pay: 0, cents: 0 };
    (d.consommations || []).forEach(function (r) {
      var o = map[Number(r.Consommateur) || 0], add = 0;
      types.forEach(function (t) {
        var q = Number(r[t.colonne]); if (!isFinite(q)) q = 0;
        add += Math.round(q * cents(t.prix));
        if (o) o.qty[t.colonne] += q;
      });
      if (o) { o.duCents += add; o.nConso++; } else { orphans.conso++; orphans.cents += add; }
    });
    (d.reglements || []).forEach(function (r) {
      var o = map[Number(r.Consommateur) || 0], a = cents(r.Montant);
      if (o) { o.paidCents += a; o.nPay++; } else orphans.pay++;
    });
    var tot = { du: 0, paid: 0 };
    list.forEach(function (o) { o.soldeCents = o.duCents - o.paidCents; tot.du += o.duCents; tot.paid += o.paidCents; });
    list.sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr', { numeric: true, sensitivity: 'base' }); });
    return { rows: list, totals: { duCents: tot.du, paidCents: tot.paid, resteCents: tot.du - tot.paid }, orphans: orphans };
  }

  /* Total des achats (centimes) et nombre de lignes ; trésorerie = encaissé (règlements) − achats. */
  function achatsTotals(rows, paidCents) {
    var tot = 0; (rows || []).forEach(function (r) { tot += cents(r.Montant); });
    return { totalCents: tot, n: (rows || []).length, caisseCents: (paidCents || 0) - tot };
  }

  /* Stock par type = réapprovisionnements − pertes ± inventaires − consommations (toutes les quantités des consommations).
     Autonomie = stock / consommation moyenne par jour sur les 30 derniers jours (today : secondes UTC de minuit, comme les dates Grist). */
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function stockData(d) {
    var types = d.types || [], by = {}, today = d.today || 0, since = today - 29 * 86400;
    var rows = types.map(function (t) { var o = { colonne: t.colonne, libelle: t.libelle, actif: t.actif, seuil: t.seuil || 0, recu: 0, pertes: 0, ajust: 0, conso: 0, conso30: 0 }; by[t.colonne] = o; return o; });
    (d.consommations || []).forEach(function (r) {
      var dt = Number(r.Date) || 0;
      types.forEach(function (t) { var q = Number(r[t.colonne]); if (!isFinite(q)) return; var o = by[t.colonne]; o.conso += q; if (today && dt >= since && dt <= today) o.conso30 += q; });
    });
    var orphans = 0;
    (d.mouvements || []).forEach(function (m) {
      var o = by[m.Colonne], q = Number(m.Quantite); if (!o || !isFinite(q)) { orphans++; return; }
      if (m.Motif === MOTIFS.PERTE) o.pertes += q; else if (m.Motif === MOTIFS.INVENTAIRE) o.ajust += q; else o.recu += q;
    });
    rows.forEach(function (o) {
      o.recu = r3(o.recu); o.pertes = r3(o.pertes); o.ajust = r3(o.ajust); o.conso = r3(o.conso);
      o.stock = r3(o.recu + o.pertes + o.ajust - o.conso);
      o.parJour = today ? o.conso30 / 30 : 0;
      o.autonomie = o.stock > 0 && o.parJour > 0 ? Math.floor(o.stock / o.parJour) : null;
      o.suivi = !!(o.recu || o.pertes || o.ajust || o.conso);   // type jamais mouvementé ni consommé : pas de suivi, pas d'alerte
      o.etat = !o.suivi ? 'none' : o.stock < 0 ? 'neg' : o.stock === 0 ? 'rupture' : o.seuil > 0 && o.stock <= o.seuil ? 'bas' : 'ok';
    });
    return { rows: rows, orphans: orphans };
  }

  function status(o) { return o.soldeCents > 0 ? 'due' : o.soldeCents < 0 ? 'over' : (o.nConso || o.nPay ? 'ok' : 'none'); }

  /* ---------- Création / complétion du schéma ---------- */
  function colSpec(c) {
    var o = { id: c.id, type: c.type, isFormula: false, label: c.label || c.id };
    if (c.choices) o.widgetOptions = JSON.stringify({ choices: c.choices });
    if (c.formula) { o.formula = c.formula; o.recalcWhen = c.recalcWhen == null ? 0 : c.recalcWhen; o.recalcDeps = null; } // formule de déclenchement : à la création de la ligne
    return o;
  }
  function typeColSpec(t) { return { id: t.colonne, type: 'Numeric', isFormula: false, label: t.libelle }; }

  /* État du schéma : tables présentes et colonnes manquantes.
     colsByTable : { nomTable: [colId, ...] } pour les tables présentes. types : types connus (colonnes attendues dans Conso_Consommations). */
  function schemaStatus(tableNames, colsByTable, types) {
    var have = (tableNames || []).map(function (x) { return x.toLowerCase(); });
    return SCHEMA.map(function (t) {
      var exists = have.indexOf(t.id.toLowerCase()) !== -1, cur = ((colsByTable || {})[t.id] || []).map(function (x) { return x.toLowerCase(); });
      var want = t.cols.map(function (c) { return c; });
      if (t.id === T.CONSOMMATIONS) (types || []).forEach(function (ty) { want.push({ id: ty.colonne, type: 'Numeric', label: ty.libelle }); });
      var missing = exists ? want.filter(function (c) { return cur.indexOf(c.id.toLowerCase()) === -1; }) : want;
      return { id: t.id, usage: t.usage, kind: t.kind, ref: !!t.ref, exists: exists, missing: missing, ok: exists && !missing.length };
    });
  }

  /* Actions Grist pour une table du schéma. */
  function addTableAction(def, types) {
    var cols = def.cols.map(colSpec);
    if (def.id === T.CONSOMMATIONS) (types || []).forEach(function (t) { cols.push(typeColSpec(t)); });
    return ['AddTable', def.id, cols];
  }
  function addColumnActions(def, missing) {
    return missing.map(function (c) {
      var spec = (def.cols.filter(function (x) { return x.id === c.id; })[0]) ; return ['AddColumn', def.id, c.id, spec ? colSpec(spec) : { type: 'Numeric', isFormula: false, label: c.label || c.id }];
    });
  }
  function defOf(id) { return SCHEMA.filter(function (t) { return t.id === id; })[0]; }

  /* Affichage des références par le nom (au lieu du numéro de ligne) + liste déroulante limitée aux consommateurs actifs.
     meta : { tables: {id[], tableId[]}, cols: {id[], parentId[], colId[], visibleCol[], widgetOptions[]} } (tables _grist_Tables et _grist_Tables_column). */
  function refDisplayActions(meta) {
    var Tb = meta.tables, K = meta.cols, acts = [];
    function tid(name) { var i = Tb.tableId.indexOf(name); return i === -1 ? 0 : Tb.id[i]; }
    function col(table, id) { var t = tid(table); if (!t) return -1; for (var j = 0; j < K.id.length; j++) if (K.parentId[j] === t && K.colId[j] === id) return j; return -1; }
    var nom = col(T.CONSOMMATEURS, 'Nom'); if (nom === -1) return acts;
    [T.CONSOMMATIONS, T.REGLEMENTS].forEach(function (table) {
      var j = col(table, 'Consommateur'); if (j === -1) return;
      if (K.visibleCol && K.visibleCol[j] !== K.id[nom]) {
        acts.push(['UpdateRecord', '_grist_Tables_column', K.id[j], { visibleCol: K.id[nom] }]);
        acts.push(['SetDisplayFormula', table, null, K.id[j], '$Consommateur.Nom']);
      }
      if (table === T.CONSOMMATIONS) {
        var wo = {}; try { wo = JSON.parse(K.widgetOptions[j] || '{}') || {}; } catch (e) { wo = {}; }
        if (!wo.dropdownCondition || wo.dropdownCondition.text !== DROPDOWN_ACTIF.text) {
          wo.dropdownCondition = DROPDOWN_ACTIF;
          acts.push(['ModifyColumn', table, 'Consommateur', { widgetOptions: JSON.stringify(wo) }]);
        }
      }
    });
    return acts;
  }

  /* ---------- Export CSV (séparateur « ; », BOM UTF-8 pour Excel, protection contre l'injection de formules) ---------- */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(head, rows) { return '﻿' + [head].concat(rows).map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n'); }

  /* Date Grist (secondes UTC à minuit) <-> chaîne ISO. */
  function utcDay(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 : null; }
  function d2(n) { return (n < 10 ? '0' : '') + n; }
  function dmy(sec) { var d = new Date(sec * 1000); return d2(d.getUTCDate()) + '/' + d2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); }
  function isoDay(sec) { var d = new Date(sec * 1000); return d.getUTCFullYear() + '-' + d2(d.getUTCMonth() + 1) + '-' + d2(d.getUTCDate()); }

  return {
    T: T, SCHEMA: SCHEMA, RESERVED: RESERVED, DEFAULT_TYPES: DEFAULT_TYPES,
    norm: norm, csoId: csoId, uniqueColId: uniqueColId, cents: cents, eur: eur, parseAmount: parseAmount,
    ibanClean: ibanClean, ibanFmt: ibanFmt, ibanOk: ibanOk, weroPayload: weroPayload, isHttpUrl: isHttpUrl,
    readConfig: readConfig, achatsTotals: achatsTotals, stockData: stockData, MOTIFS: MOTIFS, readTypes: readTypes, computeBalances: computeBalances, status: status,
    schemaStatus: schemaStatus, addTableAction: addTableAction, addColumnActions: addColumnActions, typeColSpec: typeColSpec, defOf: defOf,
    refDisplayActions: refDisplayActions, csv: csv, csvCell: csvCell, utcDay: utcDay, dmy: dmy, isoDay: isoDay
  };
});
