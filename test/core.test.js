'use strict';
// node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

test('csoId / uniqueColId', () => {
  assert.equal(C.csoId('Petit-déjeuner'), 'Petit_dejeuner');
  assert.equal(C.csoId('2 cafés'), 'C_2_cafes');
  assert.equal(C.csoId('???'), 'C');
  assert.equal(C.uniqueColId('Date', []), 'Date_2');                 // colonne réservée
  assert.equal(C.uniqueColId('café', ['Cafe']), 'cafe_2');           // casse ignorée, comme Grist
  assert.equal(C.uniqueColId('Café', ['Cafe', 'Cafe_2']), 'Cafe_3');
});

test('IBAN : clé modulo 97', () => {
  assert.ok(C.ibanOk('FR76 3000 6000 0112 3456 7890 189'));
  assert.ok(C.ibanOk('de89370400440532013000'));
  assert.ok(!C.ibanOk('FR76 3000 6000 0112 3456 7890 188'));
  assert.ok(!C.ibanOk(''));
  assert.equal(C.ibanFmt('fr7630006000011234567890189'), 'FR76 3000 6000 0112 3456 7890 189');
});

test('QR SEPA (EPC)', () => {
  const cfg = { titulaire: 'Popote\nAsso', iban: 'FR76 3000 6000 0112 3456 7890 189', qr: '' };
  const l = C.weroPayload(cfg, { label: 'Consommations Léa', amountCents: 1250 }).split('\n');
  assert.equal(l.length, 11);
  assert.deepEqual(l.slice(0, 4), ['BCD', '002', '1', 'SCT']);
  assert.equal(l[5], 'Popote Asso');          // pas de saut de ligne injecté dans le titulaire
  assert.equal(l[7], 'EUR12.50');
  assert.equal(C.weroPayload(cfg, {}).split('\n')[7], '');
  assert.equal(C.weroPayload({ ...cfg, iban: 'FR76 0000' }), '');
  assert.equal(C.weroPayload({ ...cfg, qr: ' custom ' }), 'custom');
});

test('URL du formulaire : http(s) uniquement', () => {
  assert.ok(C.isHttpUrl('https://docs.getgrist.com/forms/abc/1'));
  assert.ok(!C.isHttpUrl('javascript:alert(1)'));
  assert.ok(!C.isHttpUrl('data:text/html,x'));
  assert.ok(!C.isHttpUrl(''));
});

test('soldes en centimes, orphelins, types archivés conservés', () => {
  const types = C.readTypes([
    { id: 1, Libelle: 'Café', Colonne: 'Cafe', Tarif: 0.1, Actif: true },
    { id: 2, Libelle: 'Repas', Colonne: 'Repas', Tarif: 6.2, Actif: false },   // archivé : l'historique compte
    { id: 3, Libelle: 'Sans colonne', Colonne: '', Tarif: 1, Actif: true }
  ]);
  assert.equal(types.length, 2);
  const r = C.computeBalances({
    types,
    consommateurs: [{ id: 1, Nom: 'Zoé', Actif: true }, { id: 2, Nom: 'Abel', Actif: false }],
    consommations: [
      { Consommateur: 1, Cafe: 3, Repas: 1 },       // 0,30 + 6,20
      { Consommateur: 1, Cafe: 4 },                 // 0,40  (3×0,1 flottant exact en centimes)
      { Consommateur: 0, Cafe: 2 },                 // non rapproché
      { Consommateur: 99, Repas: 'x' }              // inconnu + valeur non numérique
    ],
    reglements: [{ Consommateur: 1, Montant: 5 }, { Consommateur: 2, Montant: 2.5 }, { Consommateur: 0, Montant: 1 }]
  });
  const zoe = r.rows.find(x => x.nom === 'Zoé'), abel = r.rows.find(x => x.nom === 'Abel');
  assert.equal(r.rows[0].nom, 'Abel');                     // tri alphabétique
  assert.equal(zoe.duCents, 690); assert.equal(zoe.paidCents, 500); assert.equal(zoe.soldeCents, 190);
  assert.equal(zoe.qty.Cafe, 7);
  assert.equal(abel.soldeCents, -250); assert.equal(C.status(abel), 'over'); assert.equal(C.status(zoe), 'due');
  assert.deepEqual(r.orphans, { conso: 2, pay: 1, cents: 20 });
  assert.equal(r.totals.resteCents, 690 - 750);
});

test('analyse de montant et affichage €', () => {
  assert.equal(C.parseAmount('12,5'), 12.5);
  assert.ok(Number.isNaN(C.parseAmount('abc')));
  assert.ok(Number.isNaN(C.parseAmount('')));
  assert.equal(C.cents('0,1') * 3, 30);
  assert.match(C.eur(1250), /12,50/);
});

test('état du schéma et actions', () => {
  const types = [{ colonne: 'Cafe', libelle: 'Café' }];
  let st = C.schemaStatus([], {}, types);
  assert.equal(st.length, 7); assert.ok(st.every(s => !s.exists));
  st = C.schemaStatus(['conso_config', 'Conso_Consommations'], { Conso_Consommations: ['Date', 'Consommateur', 'Commentaire'] }, types);
  assert.ok(st.find(s => s.id === 'Conso_Consommations').missing.map(c => c.id).join() === 'Cafe');
  const add = C.addTableAction(C.defOf('Conso_Consommations'), types);
  assert.equal(add[0], 'AddTable');
  assert.deepEqual(add[2].map(c => c.id), ['Date', 'Consommateur', 'Commentaire', 'Cafe']);
  assert.equal(add[2][0].formula, 'TODAY()'); assert.equal(add[2][0].recalcWhen, 0);
  assert.equal(add[2][1].type, 'Ref:Conso_Consommateurs');
});

test('affichage des références : idempotent', () => {
  const meta = {
    tables: { id: [1, 2, 3], tableId: ['Conso_Consommateurs', 'Conso_Consommations', 'Conso_Reglements'] },
    cols: { id: [10, 20, 30], parentId: [1, 2, 3], colId: ['Nom', 'Consommateur', 'Consommateur'], visibleCol: [0, 0, 0], widgetOptions: ['', '', ''] }
  };
  const a = C.refDisplayActions(meta);
  assert.equal(a.filter(x => x[0] === 'SetDisplayFormula').length, 2);
  assert.equal(a.filter(x => x[0] === 'ModifyColumn').length, 1);
  meta.cols.visibleCol = [0, 10, 10];
  meta.cols.widgetOptions[1] = JSON.stringify({ dropdownCondition: { text: 'choice.Actif' } });
  assert.deepEqual(C.refDisplayActions(meta), []);
});

test('CSV : injection de formule neutralisée, guillemets échappés', () => {
  assert.equal(C.csvCell('=CMD()'), "'=CMD()");
  assert.equal(C.csvCell('-12,50'), '-12,50');
  assert.equal(C.csvCell('a;b'), '"a;b"');
  assert.equal(C.csvCell('dit "oui"'), '"dit ""oui"""');
  assert.ok(C.csv(['A'], [['x']]).startsWith('﻿'));
});

test('achats : total et trésorerie en centimes', () => {
  const r = C.achatsTotals([{ Montant: 12.1 }, { Montant: 0.2 }, { Montant: 'x' }], 5000);
  assert.deepEqual(r, { totalCents: 1230, n: 3, caisseCents: 3770 });
  assert.deepEqual(C.achatsTotals([], 0), { totalCents: 0, n: 0, caisseCents: 0 });
  assert.ok(C.SCHEMA.find(t => t.id === 'Conso_Achats' && !t.ref));   // créée avant les tables à références
});

test('stock : mouvements − consommations, seuil, autonomie', () => {
  const day = 86400, today = C.utcDay('2026-03-31');
  const types = C.readTypes([
    { id: 1, Libelle: 'Café', Colonne: 'Cafe', Tarif: 0.5, Actif: true, Seuil_alerte: 10 },
    { id: 2, Libelle: 'Repas', Colonne: 'Repas', Tarif: 6, Actif: true },
    { id: 3, Libelle: 'Ancien', Colonne: 'Ancien', Tarif: 1, Actif: false }
  ]);
  assert.equal(types[0].seuil, 10);
  const M = C.MOTIFS;
  const r = C.stockData({
    types, today,
    consommations: [
      { Date: today, Cafe: 30, Repas: 2 },
      { Date: today - 10 * day, Cafe: 30 },
      { Date: today - 60 * day, Cafe: 100 },          // hors des 30 jours : compté dans le stock, pas dans le rythme
      { Date: today, Cafe: 'x' }
    ],
    mouvements: [
      { Colonne: 'Cafe', Quantite: 200, Motif: M.REAPPRO }, { Colonne: 'Cafe', Quantite: -5, Motif: M.PERTE }, { Colonne: 'Cafe', Quantite: 1, Motif: M.INVENTAIRE },
      { Colonne: 'Repas', Quantite: 2, Motif: M.REAPPRO }, { Colonne: 'Inconnu', Quantite: 9, Motif: M.REAPPRO }
    ]
  });
  const c = r.rows.find(x => x.colonne === 'Cafe'), p = r.rows.find(x => x.colonne === 'Repas'), a = r.rows.find(x => x.colonne === 'Ancien');
  assert.equal(c.stock, 200 - 5 + 1 - 160); assert.equal(c.stock, 36); assert.equal(c.etat, 'ok');
  assert.equal(c.autonomie, Math.floor(36 / (60 / 30)));     // 60 consommés sur 30 jours -> 2 / jour
  assert.equal(p.stock, 0); assert.equal(p.etat, 'rupture'); assert.equal(p.autonomie, null);
  assert.equal(a.stock, 0); assert.equal(a.etat, 'none'); assert.equal(r.orphans, 1);
  const bas = C.stockData({ types, today, consommations: [{ Date: today, Cafe: 195 }], mouvements: [{ Colonne: 'Cafe', Quantite: 200, Motif: M.REAPPRO }] }).rows[0];
  assert.equal(bas.etat, 'bas');
  const neg = C.stockData({ types, today, consommations: [{ Date: today, Cafe: 1 }], mouvements: [] }).rows[0];
  assert.equal(neg.stock, -1); assert.equal(neg.etat, 'neg');
  assert.equal(C.stockData({ types, consommations: [{ Cafe: 0.1 }, { Cafe: 0.2 }], mouvements: [{ Colonne: 'Cafe', Quantite: 0.3, Motif: M.REAPPRO }] }).rows[0].stock, 0);   // pas d'erreur flottante
});

test('schéma : choix du motif et seuil des types', () => {
  const st = C.defOf('Conso_Stocks'), act = C.addTableAction(st, []);
  assert.deepEqual(JSON.parse(act[2].find(c => c.id === 'Motif').widgetOptions).choices, ['Réapprovisionnement', 'Perte ou casse', 'Inventaire']);
  assert.ok(C.defOf('Conso_Types').cols.some(c => c.id === 'Seuil_alerte'));
  assert.ok(!st.ref);
});

test('dates UTC', () => {
  const s = C.utcDay('2026-03-01'); assert.equal(C.dmy(s), '01/03/2026'); assert.equal(C.isoDay(s), '2026-03-01');
  assert.equal(C.utcDay('01/03/2026'), null);
});
