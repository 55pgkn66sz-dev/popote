/* Widget Grist « Consommations individuelles » : interface et accès à Grist.
   La logique de calcul est dans core.js (testée sous Node). Niveau d'accès demandé : « Accès complet »
   (création des tables et lecture des tables de métadonnées). Les droits réels sont ceux des permissions avancées du document. */
(function () {
  'use strict';
  var C = window.ConsoCore, T = C.T;
  var VUE_REGLER = /[?&]vue=regler\b/.test(location.search);   // ?vue=regler : vue « Régler » seule, pour les consommateurs
  var S = {
    tab: VUE_REGLER ? 'regler' : 'suivi', names: [], cols: {}, denied: {}, loaded: false, busy: false, err: '',
    cfgRows: [], cfg: C.readConfig([]), consommateurs: [], typesRaw: [], types: [], consommations: [], reglements: [], achats: [], ach: { date: '', lib: '', four: '', amt: '', obs: '', err: '', ok: '', del: null }, meta: null,
    bal: null, q: '', f: '', detail: null, add: null, rg: null, edit: null, sk: null, skDel: null, stocks: [], draft: null, schema: []
  };
  var qrLib = null;

  /* ---------- Utilitaires ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function localIso() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function G() { return window.grist.docApi; }
  function toast(kind, text) {
    var t = $('toast'); t.innerHTML = '<div class="alert ' + (kind === 'error' ? 'err' : '') + '" role="' + (kind === 'error' ? 'alert' : 'status') + '">' + esc(text) + '</div>';
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.innerHTML = ''; }, kind === 'error' ? 9000 : 3500);
  }
  function errText(e) {
    var m = (e && e.message) || String(e);
    return /access|permission|denied|blocked|not allowed|forbidden|autoris/i.test(m) ? 'Droits insuffisants : cette action est réservée au gestionnaire (permissions avancées du document). Détail : ' + m : m;
  }
  function rows(t) { var ks = Object.keys(t).filter(function (k) { return k !== 'id'; }); return (t.id || []).map(function (id, i) { var o = { id: id }; ks.forEach(function (k) { o[k] = t[k][i]; }); return o; }); }
  function realName(n) { return S.names.filter(function (x) { return x.toLowerCase() === n.toLowerCase(); })[0] || null; }
  function bal(id) { return S.bal && S.bal.rows.filter(function (r) { return r.id === id; })[0]; }
  function hasTables() { return S.schema.length && S.schema.every(function (s) { return s.exists; }); }

  /* ---------- Chargement ---------- */
  async function load() {
    S.names = await G().listTables(); S.cols = {}; S.denied = {};
    async function tbl(name) {
      var n = realName(name); if (!n) return null;
      try { var t = await G().fetchTable(n); S.cols[name] = Object.keys(t).filter(function (k) { return k !== 'id'; }); return rows(t); }
      catch (e) { S.denied[name] = errText(e); return []; }
    }
    S.cfgRows = (await tbl(T.CONFIG)) || []; S.cfg = C.readConfig(S.cfgRows);
    S.consommateurs = (await tbl(T.CONSOMMATEURS)) || [];
    S.typesRaw = (await tbl(T.TYPES)) || []; S.types = C.readTypes(S.typesRaw);
    S.consommations = (await tbl(T.CONSOMMATIONS)) || [];
    S.reglements = (await tbl(T.REGLEMENTS)) || [];
    S.achats = (await tbl(T.ACHATS)) || [];
    S.stocks = (await tbl(T.STOCKS)) || [];
    try { var a = await G().fetchTable('_grist_Tables'), b = await G().fetchTable('_grist_Tables_column'); S.meta = { tables: a, cols: b }; } catch (e) { S.meta = null; }
    S.schema = C.schemaStatus(S.names, S.cols, S.types);
    S.bal = C.computeBalances({ types: S.types, consommateurs: S.consommateurs, consommations: S.consommations, reglements: S.reglements });
    S.loaded = true;
  }
  async function refresh() {
    try { await load(); S.err = ''; } catch (e) { S.err = errText(e); }
    render(); if (S.detail && $('modal').open) renderDetail();
  }
  /* Écriture : applique les actions, recharge, réaffiche. Retourne les valeurs de retour, ou null en cas d'échec (message affiché). */
  async function write(actions, okMsg) {
    S.busy = true;
    try {
      var r = await G().applyUserActions(actions);
      await load(); S.err = ''; if (okMsg) toast('ok', okMsg);
      return r && r.retValues ? r.retValues : [];
    } catch (e) { toast('error', 'Enregistrement impossible : ' + errText(e)); try { await load(); } catch (e2) {} return null; }
    finally { S.busy = false; render(); if (S.detail && $('modal').open) renderDetail(); else if (S.add && $('modal').open) renderAdd(); else if (S.rg && $('modal').open) renderRg(); else if (S.edit && $('modal').open) renderEdit(); else if (S.sk && $('modal').open) renderSk(); }
  }

  /* ---------- QR codes ---------- */
  function loadQr() {
    return qrLib || (qrLib = new Promise(function (res, rej) {
      if (window.qrcode) return res();
      var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      sc.onload = function () { res(); }; sc.onerror = function () { qrLib = null; rej(new Error('la bibliothèque des QR codes n’a pas pu être chargée')); };
      document.head.appendChild(sc);
    }));
  }
  function drawQr(slotId, payload) {
    var slot = $(slotId); if (!slot || !payload) return;
    loadQr().then(function () {
      var box = $(slotId); if (!box) return;
      if (window.qrcode.stringToBytesFuncs) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
      var q = window.qrcode(0, 'M'); q.addData(payload); q.make();
      box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true, alt: 'QR code' });
    }, function (e) { var box = $(slotId); if (box) box.innerHTML = '<p class="hint">' + esc(e.message) + '.</p>'; });
  }

  /* Carte de règlement : QR (virement SEPA pré-rempli, ou contenu personnalisé), titulaire, IBAN, numéro Wero. */
  function payCard(opt) {
    var c = S.cfg, pl = C.weroPayload(c, opt || {});
    if (!c.titulaire && !c.iban && !c.numero && !c.qr) return '<div class="alert">Aucun moyen de règlement n’est renseigné. Le gestionnaire peut le faire dans « Back office ».</div>';
    var why = c.iban && !C.ibanOk(c.iban) ? 'IBAN invalide.' : 'titulaire ou IBAN manquant.';
    return '<section class="pay" aria-label="Règlement">' + (opt && opt.amountCents > 0 ? '<p><strong>' + esc(C.eur(opt.amountCents)) + '</strong> à régler</p>' : '') +
      '<div class="qr" id="qr-slot">' + (pl ? '' : '<p class="hint">QR code indisponible : ' + why + '</p>') + '</div><dl>' +
      (c.titulaire ? '<dt>Titulaire</dt><dd>' + esc(c.titulaire) + '</dd>' : '') + (c.iban ? '<dt>IBAN</dt><dd class="iban">' + esc(C.ibanFmt(c.iban)) + '</dd>' : '') +
      (c.numero ? '<dt>Numéro Wero</dt><dd>' + esc(c.numero) + '</dd>' : '') + '</dl></section>';
  }
  function showPay(title, opt) {
    S.detail = null; S.add = null; S.rg = null; S.edit = null; S.sk = null; openModal(title, payCard(opt) + '<p style="text-align:center"><button type="button" class="btn sec" data-act="close">Fermer</button></p>');
    drawQr('qr-slot', C.weroPayload(S.cfg, opt || {}));
  }
  function formBlock() {
    var u = S.cfg.lien;
    if (!u) return '<div class="alert warn">Aucun lien de formulaire n’est réglé. Le gestionnaire le renseigne dans « Back office » (voir le README).</div>';
    if (!C.isHttpUrl(u)) return '<div class="alert err">Le lien du formulaire n’est pas une adresse http(s) valide.</div>';
    return '<p><a class="btn" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Déclarer une consommation</a> <button type="button" class="btn sec" data-act="form-qr">QR code du formulaire</button></p>';
  }
  function showFormQr() {
    S.detail = null; S.add = null; S.rg = null; S.edit = null; S.sk = null; openModal('Formulaire de consommation', '<div class="pay"><div class="qr" id="qr-slot"></div><p class="hint">' + esc(S.cfg.lien) + '</p></div><p style="text-align:center"><button type="button" class="btn sec" data-act="close">Fermer</button></p>');
    drawQr('qr-slot', S.cfg.lien);
  }

  /* ---------- Vues ---------- */
  function render() {
    var nav = $('tabs'), tabs = VUE_REGLER ? [] : [['suivi', 'Suivi'], ['achats', 'Achats'], ['stocks', 'Stocks'], ['regler', 'Régler'], ['bo', 'Back office']];
    nav.innerHTML = tabs.map(function (t) { return '<button type="button" role="tab" data-act="tab" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + '</button>'; }).join('');
    var app = $('app');
    if (S.err) { app.innerHTML = '<div class="alert err" role="alert">' + esc(S.err) + '</div>'; return; }
    if (!S.loaded) { app.innerHTML = '<p class="hint">Chargement…</p>'; return; }
    if (S.tab === 'achats' && !S.ach.date) S.ach.date = localIso();
    app.innerHTML = S.tab === 'bo' ? viewBO() : S.tab === 'regler' ? viewRegler() : S.tab === 'achats' ? viewAchats() : S.tab === 'stocks' ? viewStocks() : viewSuivi();
    if (S.tab === 'regler') drawQr('qr-slot', C.weroPayload(S.cfg, {}));
  }
  function missingBanner() {
    return hasTables() ? '' : '<div class="alert warn">Les tables du widget n’existent pas (toutes). ' + (VUE_REGLER ? 'Le gestionnaire doit les créer.' : 'Ouvrez « Back office » puis cliquez sur « Créer / compléter les tables ».') + '</div>';
  }
  function deniedBanner() {
    var k = Object.keys(S.denied).filter(function (x) { return S.tab !== 'regler' || x === T.CONFIG; }); return k.length ? '<div class="alert err">Lecture refusée sur : ' + k.map(esc).join(', ') + '.</div>' : '';
  }

  function viewRegler() {
    return missingBanner() + deniedBanner() + '<h2>Régler mes consommations</h2><p class="hint">Scannez le code avec l’application de votre banque (virement SEPA) ou utilisez les coordonnées ci-dessous.</p>' + payCard({ label: 'Consommations' }) + '<h2>Déclarer une consommation</h2>' + formBlock();
  }

  function viewSuivi() {
    var b = S.bal, t = b.totals;
    var orph = b.orphans.conso || b.orphans.pay ? '<div class="alert warn"><strong>' + b.orphans.conso + ' consommation(s)</strong> et <strong>' + b.orphans.pay + ' règlement(s)</strong> non rapprochés d’un consommateur (colonne Consommateur vide ou ligne supprimée), soit ' + esc(C.eur(b.orphans.cents)) + ' non comptés. Corrigez-les dans les tables.</div>' : '';
    var typeWarn = hasTables() && !S.types.length ? '<div class="alert warn">Aucun type de consommation : ajoutez-en dans « Back office ».</div>' : '';
    return missingBanner() + deniedBanner() + orph + typeWarn +
      '<div class="kpis">' + [[C.eur(t.duCents), 'dû'], [C.eur(t.paidCents), 'réglé'], [C.eur(t.resteCents), 'reste dû']].map(function (k, i) { return '<div class="kpi' + (i === 2 && t.resteCents > 0 ? ' warn' : '') + '"><strong>' + k[0] + '</strong><span>' + k[1] + '</span></div>'; }).join('') + '</div>' +
      '<div class="toolbar"><label class="sr" for="q">Rechercher</label><input id="q" type="search" placeholder="Rechercher un consommateur" value="' + esc(S.q) + '">' +
      '<label class="sr" for="f">Filtre</label><select id="f">' + [['', 'Tous'], ['due', 'Reste à régler'], ['ok', 'À jour'], ['over', 'Avoir'], ['none', 'Sans activité']].map(function (o) { return '<option value="' + o[0] + '"' + (S.f === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn" data-act="add-open"' + (hasTables() && S.types.some(function (t) { return t.actif; }) ? '' : ' disabled') + '>Ajouter une consommation</button><button type="button" class="btn" data-act="rg-open"' + (hasTables() ? '' : ' disabled') + '>Enregistrer un règlement</button><button type="button" class="btn sec" data-act="export">Exporter en CSV</button>' + '</div>' + formBlock() + '<div id="suivi-table">' + tableSuivi() + '</div>';
  }
  function visibleRows() {
    var q = C.norm(S.q);
    return S.bal.rows.filter(function (o) {
      if (!o.actif && !o.nConso && !o.nPay) return false;                         // consommateur désactivé sans historique : masqué
      if (q && C.norm(o.nom).indexOf(q) === -1) return false;
      return !S.f || C.status(o) === S.f;
    });
  }
  function tableSuivi() {
    var l = visibleRows(), tot = l.reduce(function (s, o) { s[0] += o.duCents; s[1] += o.paidCents; s[2] += o.soldeCents; return s; }, [0, 0, 0]);
    var lab = { due: function (o) { return C.eur(o.soldeCents); }, over: function (o) { return 'Avoir ' + C.eur(-o.soldeCents); }, ok: function () { return 'À jour'; }, none: function () { return '—'; } };
    return '<div class="scroll" style="max-height:60vh"><table><caption class="sr">Consommations et soldes par consommateur</caption><thead><tr><th scope="col">Consommateur</th><th scope="col" class="n">Dû</th><th scope="col" class="n">Réglé</th><th scope="col" class="n">Solde</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
      (l.map(function (o) {
        var st = C.status(o);
        return '<tr class="row" data-act="detail" data-id="' + o.id + '" tabindex="0" title="Ouvrir le détail"><th scope="row">' + esc(o.nom || '(sans nom)') + (o.actif ? '' : ' <span class="hint">(inactif)</span>') + '</th><td class="n">' + C.eur(o.duCents) + '</td><td class="n">' + C.eur(o.paidCents) + '</td>' +
          '<td class="n"><span class="tag ' + st + '">' + lab[st](o) + '</span></td><td class="n"><button type="button" class="btn sec sm" data-act="pay" data-id="' + o.id + '">Régler</button></td></tr>';
      }).join('') || '<tr><td colspan="5" class="hint" style="text-align:center">Aucun consommateur pour ces critères.</td></tr>') +
      '</tbody><tfoot><tr><th scope="row">Total (' + l.length + ')</th><td class="n">' + C.eur(tot[0]) + '</td><td class="n">' + C.eur(tot[1]) + '</td><td class="n">' + C.eur(tot[2]) + '</td><td></td></tr></tfoot></table></div>';
  }

  /* ---------- Fiche d'un consommateur ---------- */
  function openModal(title, html) { $('modal-title').textContent = title; $('modal-body').innerHTML = html; if (!$('modal').open) $('modal').showModal(); }
  function closeModal() { if ($('modal').open) $('modal').close(); S.detail = null; S.add = null; S.rg = null; S.edit = null; S.sk = null; }
  function openDetail(id) { S.add = null; S.rg = null; S.edit = null; S.sk = null; S.detail = { id: id, err: '', del: null }; renderDetail(); }
  function renderDetail() {
    var d = S.detail, o = d && bal(d.id); if (!o) return closeModal();
    var T2 = S.types, act = T2.filter(function (t) { return t.actif; }), today = localIso();
    var ent = S.consommations.filter(function (r) { return Number(r.Consommateur) === o.id; }).sort(function (a, b) { return (Number(b.Date) || 0) - (Number(a.Date) || 0) || b.id - a.id; });
    var pays = S.reglements.filter(function (r) { return Number(r.Consommateur) === o.id; }).sort(function (a, b) { return (Number(b.Date) || 0) - (Number(a.Date) || 0) || b.id - a.id; });
    function delBtn(kind, id) { var k = kind + id; return '<button type="button" class="btn sec sm" data-act="ed-' + kind + '" data-id="' + id + '">Modifier</button> <button type="button" class="btn ' + (d.del === k ? 'danger' : 'sec') + ' sm" data-act="del-' + kind + '" data-id="' + id + '">' + (d.del === k ? 'Confirmer' : 'Supprimer') + '</button>'; }
    function date(r) { var v = Number(r.Date); return v ? C.dmy(v) : '—'; }
    var html = (d.err ? '<div class="alert err" role="alert">' + esc(d.err) + '</div>' : '') +
      '<div class="kpis">' + [[C.eur(o.duCents), 'consommé'], [C.eur(o.paidCents), 'réglé'], [o.soldeCents < 0 ? 'Avoir ' + C.eur(-o.soldeCents) : C.eur(o.soldeCents), o.soldeCents > 0 ? 'reste dû' : 'solde']].map(function (k, i) { return '<div class="kpi' + (i === 2 && o.soldeCents > 0 ? ' warn' : '') + '"><strong>' + k[0] + '</strong><span>' + k[1] + '</span></div>'; }).join('') + '</div>' +
      '<h3>Enregistrer un règlement</h3><div class="grid"><div class="field"><label for="cs-date">Date</label><input type="date" id="cs-date" value="' + today + '"></div>' +
      '<div class="field"><label for="cs-amt">Montant (€)</label><input id="cs-amt" inputmode="decimal" value="' + (o.soldeCents > 0 ? (o.soldeCents / 100).toFixed(2) : '') + '"></div>' +
      '<div class="field"><label for="cs-obs">Observations</label><input id="cs-obs" placeholder="Virement, espèces, chèque n°…"></div></div>' +
      '<p><button type="button" class="btn" data-act="add-pay">Enregistrer le règlement</button> <button type="button" class="btn sec" data-act="pay" data-id="' + o.id + '">QR de règlement</button></p>' +
      '<h3>Règlements (' + pays.length + ')</h3>' + (pays.length ? '<div class="scroll"><table><thead><tr><th>Date</th><th class="n">Montant</th><th>Observations</th><th></th></tr></thead><tbody>' + pays.map(function (r) { return '<tr><td>' + date(r) + '</td><td class="n">' + C.eur(C.cents(r.Montant)) + '</td><td>' + esc(r.Observations || '') + '</td><td class="n">' + delBtn('p', r.id) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="hint">Aucun règlement.</p>') +
      '<h3>Consommations déclarées (' + ent.length + ')</h3>' + (ent.length ? '<div class="scroll"><table><thead><tr><th>Date</th>' + T2.map(function (t) { return '<th class="n">' + esc(t.libelle) + '</th>'; }).join('') + '<th class="n">Montant</th><th></th></tr></thead><tbody>' +
        ent.map(function (r) { var m = T2.reduce(function (s, t) { return s + Math.round((Number(r[t.colonne]) || 0) * C.cents(t.prix)); }, 0);
          return '<tr><td>' + date(r) + '</td>' + T2.map(function (t) { var n = Number(r[t.colonne]) || 0; return '<td class="n">' + (n ? String(n).replace('.', ',') : '') + '</td>'; }).join('') + '<td class="n">' + C.eur(m) + '</td><td class="n">' + delBtn('c', r.id) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="hint">Aucune consommation déclarée.</p>') +
      ('<p><button type="button" class="btn sec" data-act="add-open" data-id="' + o.id + '"' + (act.length ? '' : ' disabled') + '>Ajouter une consommation (saisie manuelle)</button></p>');
    openModal(o.nom, html);
  }
  async function detailAction(a, btn) {
    var d = S.detail; if (!d) return;
    if (a === 'add-pay') {
      var amt = C.parseAmount($('cs-amt').value), day = C.utcDay($('cs-date').value);
      d.err = !day ? 'Indiquez la date du règlement.' : !(amt > 0) ? 'Indiquez un montant supérieur à 0.' : '';
      if (d.err) return renderDetail();
      return write([['AddRecord', T.REGLEMENTS, null, { Date: day, Consommateur: d.id, Montant: amt, Observations: $('cs-obs').value.trim() }]], 'Règlement enregistré.');
    }
    if (a === 'del-p' || a === 'del-c') {
      var id = Number(btn.getAttribute('data-id')), key = a.slice(4) + id;
      if (d.del !== key) { d.del = key; return renderDetail(); }
      d.del = null; return write([['RemoveRecord', a === 'del-p' ? T.REGLEMENTS : T.CONSOMMATIONS, id]], 'Supprimé.');
    }
  }

  /* ---------- Stocks (selon les consommations) ---------- */
  function today() { return C.utcDay(localIso()); }
  function stockRows() { return C.stockData({ types: S.types, consommations: S.consommations, mouvements: S.stocks, today: today() }); }
  function fmtQ(n) { return String(Math.round(n * 1000) / 1000).replace('.', ','); }
  function viewStocks() {
    var ok = !!realName(T.STOCKS);
    if (!ok) return missingBanner() + deniedBanner();
    var sd = stockRows(), seuilOk = (S.cols[T.TYPES] || []).indexOf('Seuil_alerte') !== -1;
    var list = sd.rows.filter(function (r) { return r.actif || r.stock !== 0 || r.recu || r.conso; });
    var alerts = list.filter(function (r) { return r.actif && (r.etat === 'bas' || r.etat === 'rupture' || r.etat === 'neg'); });
    var lab = { none: ['none', 'Non suivi'], ok: ['ok', 'OK'], bas: ['due', 'Stock bas'], rupture: ['due', 'Rupture'], neg: ['due', 'Négatif'] };
    var mv = S.stocks.slice().sort(function (a, b) { return (Number(b.Date) || 0) - (Number(a.Date) || 0) || b.id - a.id; });
    return missingBanner() + deniedBanner() +
      (seuilOk ? '' : '<div class="alert warn">La colonne « Seuil d’alerte » manque dans <code>' + T.TYPES + '</code> : cliquez sur « Créer / compléter les tables » dans le Back office.</div>') +
      (alerts.length ? '<div class="alert warn" role="status"><strong>À réapprovisionner :</strong> ' + alerts.map(function (r) { return esc(r.libelle) + ' (' + fmtQ(r.stock) + ')'; }).join(', ') + '.</div>' : '') +
      (sd.orphans ? '<div class="alert warn">' + sd.orphans + ' mouvement(s) de stock ne correspondent à aucun type (type supprimé ou colonne renommée) : non comptés.</div>' : '') +
      '<div class="toolbar"><button type="button" class="btn" data-act="sk-in">Réapprovisionnement / perte</button><button type="button" class="btn" data-act="sk-inv">Inventaire</button></div>' +
      '<p class="hint">Stock = réapprovisionnements − pertes ± inventaires − consommations déclarées. Autonomie = stock ÷ consommation moyenne par jour sur les 30 derniers jours. Si le stock est négatif, faites un inventaire pour le remettre à la valeur comptée.</p>' +
      '<div class="scroll" style="max-height:50vh"><table><caption class="sr">Stock par type de consommation</caption><thead><tr><th scope="col">Type</th><th scope="col" class="n">Reçu</th><th scope="col" class="n">Pertes</th><th scope="col" class="n">Ajust.</th><th scope="col" class="n">Consommé</th><th scope="col" class="n">Stock</th><th scope="col" class="n">Seuil d’alerte</th><th scope="col" class="n">Autonomie</th><th scope="col">État</th></tr></thead><tbody>' +
      (list.map(function (r) {
        var t = S.types.filter(function (x) { return x.colonne === r.colonne; })[0], l = lab[r.etat];
        return '<tr><th scope="row">' + esc(r.libelle) + (r.actif ? '' : ' <span class="hint">(archivé)</span>') + '</th><td class="n">' + fmtQ(r.recu) + '</td><td class="n">' + fmtQ(r.pertes) + '</td><td class="n">' + fmtQ(r.ajust) + '</td><td class="n">' + fmtQ(r.conso) + '</td><td class="n"><strong>' + fmtQ(r.stock) + '</strong></td>' +
          '<td class="n"><input data-sk-seuil="' + (t ? t.id : 0) + '" inputmode="decimal" value="' + (r.seuil ? fmtQ(r.seuil) : '') + '" placeholder="—" style="width:5rem;text-align:right" aria-label="Seuil d’alerte de ' + esc(r.libelle) + '"' + (seuilOk && t ? '' : ' disabled') + '></td>' +
          '<td class="n">' + (r.autonomie === null ? '—' : r.autonomie + ' j') + '</td><td><span class="tag ' + l[0] + '">' + l[1] + '</span></td></tr>';
      }).join('') || '<tr><td colspan="9" class="hint" style="text-align:center">Aucun type de consommation.</td></tr>') + '</tbody></table></div>' +
      '<h2>Mouvements de stock (' + mv.length + ')</h2><div class="scroll" style="max-height:40vh"><table><caption class="sr">Mouvements de stock</caption><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Motif</th><th scope="col" class="n">Quantité</th><th scope="col">Observations</th><th scope="col"><span class="sr">Action</span></th></tr></thead><tbody>' +
      (mv.map(function (m) {
        var d = Number(m.Date), q = Number(m.Quantite) || 0, conf = S.skDel === m.id, ty = S.types.filter(function (x) { return x.colonne === m.Colonne; })[0];
        return '<tr><td>' + (d ? C.dmy(d) : '—') + '</td><td>' + esc(ty ? ty.libelle : (m.Libelle || m.Colonne || '?')) + '</td><td>' + esc(m.Motif || '') + '</td><td class="n">' + (q > 0 ? '+' : '') + fmtQ(q) + '</td><td>' + esc(m.Observations || '') + '</td><td class="n"><button type="button" class="btn ' + (conf ? 'danger' : 'sec') + ' sm" data-act="sk-del" data-id="' + m.id + '">' + (conf ? 'Confirmer' : 'Supprimer') + '</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="hint" style="text-align:center">Aucun mouvement. Commencez par un inventaire pour saisir le stock actuel.</td></tr>') + '</tbody></table></div>';
  }
  function openSk(kind) { S.detail = null; S.add = null; S.rg = null; S.edit = null; S.skDel = null; S.sk = { kind: kind, date: localIso(), motif: C.MOTIFS.REAPPRO, q: {}, obs: '', err: '', ok: '' }; renderSk(); var f = $('sk-q0'); if (f) f.focus(); }
  function readSk() {
    var k = S.sk; if (!k || !$('sk-date')) return;
    k.date = $('sk-date').value; k.obs = $('sk-obs').value.trim(); if ($('sk-motif')) k.motif = $('sk-motif').value;
    skTypes().forEach(function (t, i) { var e = $('sk-q' + i); if (e) k.q[t.colonne] = e.value; });
  }
  function skTypes() { return S.types.filter(function (t) { return S.sk.kind === 'inv' ? true : t.actif; }).filter(function (t) { return S.sk.kind !== 'inv' || t.actif || (stockRows().rows.filter(function (r) { return r.colonne === t.colonne; })[0] || {}).stock; }); }
  function renderSk() {
    var k = S.sk; if (!k) return; var inv = k.kind === 'inv', th = {};
    stockRows().rows.forEach(function (r) { th[r.colonne] = r; });
    openModal(inv ? 'Inventaire' : 'Réapprovisionnement / perte',
      (k.err ? '<div class="alert err" role="alert">' + esc(k.err) + '</div>' : '') + (k.ok ? '<div class="alert" role="status">' + esc(k.ok) + '</div>' : '') +
      (inv ? '<p class="hint">Saisissez la quantité <strong>comptée</strong> pour chaque type. Les types laissés vides sont ignorés. L’écart avec le stock théorique est enregistré comme ajustement « Inventaire ».</p>' : '') +
      '<div class="grid"><div class="field"><label for="sk-date">Date</label><input type="date" id="sk-date" value="' + esc(k.date) + '"></div>' +
      (inv ? '' : '<div class="field"><label for="sk-motif">Motif</label><select id="sk-motif"><option' + (k.motif === C.MOTIFS.REAPPRO ? ' selected' : '') + '>' + C.MOTIFS.REAPPRO + '</option><option' + (k.motif === C.MOTIFS.PERTE ? ' selected' : '') + '>' + C.MOTIFS.PERTE + '</option></select></div>') +
      '<div class="field"><label for="sk-obs">Observations</label><input id="sk-obs" value="' + esc(k.obs) + '" placeholder="' + (inv ? 'Comptage du…' : 'Livraison, bon n°…') + '" autocomplete="off"></div></div>' +
      '<h3>' + (inv ? 'Quantités comptées' : 'Quantités (positives)') + '</h3><div class="grid">' + skTypes().map(function (t, i) { var r = th[t.colonne]; return '<div class="field"><label for="sk-q' + i + '">' + esc(t.libelle) + (inv && r ? ' <span class="hint">(théorique : ' + fmtQ(r.stock) + ')</span>' : '') + '</label><input type="number" min="0" step="any" id="sk-q' + i + '" value="' + esc(k.q[t.colonne] || '') + '"></div>'; }).join('') + '</div>' +
      '<p><button type="button" class="btn" data-act="sk-save">Enregistrer</button> <button type="button" class="btn sec" data-act="close">Fermer</button></p>');
  }
  async function saveSk() {
    var k = S.sk; if (!k) return; readSk(); k.ok = '';
    var day = C.utcDay(k.date), inv = k.kind === 'inv', th = {}, acts = [], neg = false, bad = false;
    stockRows().rows.forEach(function (r) { th[r.colonne] = r; });
    skTypes().forEach(function (t) {
      var raw = String(k.q[t.colonne] || '').trim(); if (raw === '') return;
      var n = C.parseAmount(raw); if (!isFinite(n) || n < 0) { neg = true; return; }
      var f = { Date: day, Colonne: t.colonne, Libelle: t.libelle, Observations: k.obs };
      if (inv) { var diff = Math.round((n - (th[t.colonne] ? th[t.colonne].stock : 0)) * 1000) / 1000; if (!diff) return; f.Quantite = diff; f.Motif = C.MOTIFS.INVENTAIRE; }
      else { if (!n) return; f.Quantite = k.motif === C.MOTIFS.PERTE ? -n : n; f.Motif = k.motif; }
      acts.push(['AddRecord', T.STOCKS, null, f]);
    });
    k.err = !day ? 'Indiquez la date.' : neg ? 'Quantités invalides : des nombres positifs ou nuls sont attendus.' : !acts.length ? (inv ? 'Aucun écart à enregistrer : saisissez au moins une quantité différente du stock théorique.' : 'Indiquez au moins une quantité.') : '';
    if (k.err) return renderSk();
    var r = await write(acts);
    if (r && S.sk) { k.ok = acts.length + (inv ? ' ajustement(s) d’inventaire' : ' mouvement(s)') + ' enregistré(s).'; k.q = {}; k.obs = ''; }
    renderSk();
  }
  async function delStock(id) { readSkNone(); if (S.skDel !== id) { S.skDel = id; return render(); } S.skDel = null; await write([['RemoveRecord', T.STOCKS, id]], 'Mouvement supprimé.'); }
  function readSkNone() {}
  async function editSeuil(el) {
    var id = Number(el.getAttribute('data-sk-seuil')), raw = el.value.trim(), v = raw === '' ? 0 : C.parseAmount(raw);
    if (!id || !(v >= 0)) { toast('error', 'Seuil invalide.'); return refresh(); }
    await write([['UpdateRecord', T.TYPES, id, { Seuil_alerte: v }]], 'Seuil enregistré.');
  }

  /* ---------- Achats (fournitures achetées par le gestionnaire) ---------- */
  function viewAchats() {
    var a = S.ach, t = C.achatsTotals(S.achats, S.bal.totals.paidCents), ok = !!realName(T.ACHATS);
    if (!ok) return missingBanner() + deniedBanner();
    var list = S.achats.slice().sort(function (x, y) { return (Number(y.Date) || 0) - (Number(x.Date) || 0) || y.id - x.id; });
    return missingBanner() + deniedBanner() +
      '<div class="kpis">' + [[C.eur(t.totalCents), 'achats (' + t.n + ')'], [C.eur(S.bal.totals.paidCents), 'encaissé (règlements)'], [(t.caisseCents < 0 ? '−' : '') + C.eur(Math.abs(t.caisseCents)), 'solde popote']].map(function (k, i) { return '<div class="kpi' + (i === 2 && t.caisseCents < 0 ? ' warn' : '') + '"><strong>' + k[0] + '</strong><span>' + k[1] + '</span></div>'; }).join('') + '</div>' +
      '<section class="card"><h2>Enregistrer un achat</h2>' + (a.err ? '<div class="alert err" role="alert">' + esc(a.err) + '</div>' : '') + (a.ok ? '<div class="alert" role="status">' + esc(a.ok) + '</div>' : '') +
      '<div class="grid"><div class="field"><label for="ac-date">Date</label><input type="date" id="ac-date" value="' + esc(a.date) + '"></div>' +
      '<div class="field"><label for="ac-lib">Achat</label><input id="ac-lib" value="' + esc(a.lib) + '" placeholder="Café en grains, lait…" autocomplete="off"></div>' +
      '<div class="field"><label for="ac-four">Fournisseur (facultatif)</label><input id="ac-four" value="' + esc(a.four) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="ac-amt">Montant (€)</label><input id="ac-amt" inputmode="decimal" value="' + esc(a.amt) + '"></div>' +
      '<div class="field"><label for="ac-obs">Observations</label><input id="ac-obs" value="' + esc(a.obs) + '" placeholder="Facture n°, remboursé…" autocomplete="off"></div></div>' +
      '<p><button type="button" class="btn" data-act="ac-save">Enregistrer l’achat</button></p></section>' +
      '<div class="toolbar"><h2 style="margin:0;flex:1">Achats enregistrés</h2><button type="button" class="btn sec" data-act="ac-export">Exporter en CSV</button></div>' +
      '<div class="scroll" style="max-height:55vh"><table><caption class="sr">Achats</caption><thead><tr><th scope="col">Date</th><th scope="col">Achat</th><th scope="col">Fournisseur</th><th scope="col" class="n">Montant</th><th scope="col">Observations</th><th scope="col"><span class="sr">Action</span></th></tr></thead><tbody>' +
      (list.map(function (r) {
        var d = Number(r.Date), conf = a.del === r.id;
        return '<tr><td>' + (d ? C.dmy(d) : '—') + '</td><td>' + esc(r.Libelle || '') + '</td><td>' + esc(r.Fournisseur || '') + '</td><td class="n">' + C.eur(C.cents(r.Montant)) + '</td><td>' + esc(r.Observations || '') + '</td>' +
          '<td class="n"><button type="button" class="btn sec sm" data-act="ed-a" data-id="' + r.id + '">Modifier</button> <button type="button" class="btn ' + (conf ? 'danger' : 'sec') + ' sm" data-act="ac-del" data-id="' + r.id + '">' + (conf ? 'Confirmer' : 'Supprimer') + '</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="hint" style="text-align:center">Aucun achat enregistré.</td></tr>') +
      '</tbody><tfoot><tr><th scope="row" colspan="3">Total</th><td class="n">' + C.eur(t.totalCents) + '</td><td colspan="2"></td></tr></tfoot></table></div>';
  }
  function readAchat() {
    var a = S.ach; if (!$('ac-date')) return;
    a.date = $('ac-date').value; a.lib = $('ac-lib').value.trim(); a.four = $('ac-four').value.trim(); a.amt = $('ac-amt').value; a.obs = $('ac-obs').value.trim();
  }
  async function saveAchat() {
    var a = S.ach; readAchat(); a.ok = ''; a.del = null;
    var amt = C.parseAmount(a.amt), day = C.utcDay(a.date);
    a.err = !day ? 'Indiquez la date.' : !a.lib ? 'Indiquez ce qui a été acheté.' : !(amt > 0) ? 'Indiquez un montant supérieur à 0.' : '';
    if (a.err) return render();
    var r = await write([['AddRecord', T.ACHATS, null, { Date: day, Libelle: a.lib, Fournisseur: a.four, Montant: amt, Observations: a.obs }]]);
    if (r) { a.ok = 'Achat enregistré : ' + a.lib + ', ' + C.eur(C.cents(amt)) + '.'; a.lib = ''; a.amt = ''; a.obs = ''; }   // la date et le fournisseur restent pour enchaîner
    render(); var f = $('ac-lib'); if (f) f.focus();
  }
  async function delAchat(id) {
    var a = S.ach; readAchat(); if (a.del !== id) { a.del = id; return render(); }
    a.del = null; await write([['RemoveRecord', T.ACHATS, id]], 'Achat supprimé.');
  }
  function exportAchats() {
    var rows = S.achats.slice().sort(function (x, y) { return (Number(x.Date) || 0) - (Number(y.Date) || 0); }).map(function (r) { var d = Number(r.Date); return [d ? C.isoDay(d) : '', r.Libelle || '', r.Fournisseur || '', (C.cents(r.Montant) / 100).toFixed(2).replace('.', ','), r.Observations || '']; });
    download('Achats_' + localIso() + '.csv', C.csv(['Date', 'Achat', 'Fournisseur', 'Montant (€)', 'Observations'], rows));
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ---------- Modifier un achat, une consommation ou un règlement ---------- */
  function amtStr(v) { return v === null || v === undefined || v === '' ? '' : String(Number(v) || 0).replace('.', ','); }
  function typeCols() { return S.types.filter(function (t) { return (S.cols[T.CONSOMMATIONS] || []).indexOf(t.colonne) !== -1; }); }
  function openEdit(kind, id) {
    var rows = kind === 'a' ? S.achats : kind === 'c' ? S.consommations : S.reglements, r = rows.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    S.detail = null; S.add = null; S.rg = null; S.sk = null;
    var d = Number(r.Date), e = S.edit = { kind: kind, id: id, who: Number(r.Consommateur) || 0, date: d ? C.isoDay(d) : '', lib: r.Libelle || '', four: r.Fournisseur || '', amt: amtStr(r.Montant), obs: r.Observations || '', com: r.Commentaire || '', q: {}, err: '' };
    e.back = e.who;
    if (kind === 'c') typeCols().forEach(function (t) { e.q[t.colonne] = amtStr(r[t.colonne]); });
    renderEdit();
  }
  function readEdit() {
    var e = S.edit; if (!e || !$('ed-date')) return;
    e.date = $('ed-date').value;
    if (e.kind === 'a') { e.lib = $('ed-lib').value.trim(); e.four = $('ed-four').value.trim(); e.amt = $('ed-amt').value; e.obs = $('ed-obs').value.trim(); }
    else { e.who = Number($('ed-who').value) || 0; if (e.kind === 'p') { e.amt = $('ed-amt').value; e.obs = $('ed-obs').value.trim(); } else { e.com = $('ed-com').value.trim(); typeCols().forEach(function (t, i) { e.q[t.colonne] = $('ed-q' + i).value; }); } }
  }
  function renderEdit() {
    var e = S.edit; if (!e) return;
    function f(id, label, val, extra) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" value="' + esc(val) + '" ' + (extra || '') + '></div>'; }
    var who = e.kind === 'a' ? '' : '<div class="field"><label for="ed-who">Consommateur</label><select id="ed-who"><option value="0">— choisir —</option>' + S.bal.rows.map(function (o) { return '<option value="' + o.id + '"' + (o.id === e.who ? ' selected' : '') + '>' + esc(o.nom || '(sans nom)') + (o.actif ? '' : ' (inactif)') + '</option>'; }).join('') + '</select></div>';
    var body = e.kind === 'a' ? f('ed-lib', 'Achat', e.lib, 'autocomplete="off"') + f('ed-four', 'Fournisseur (facultatif)', e.four, 'autocomplete="off"') + f('ed-amt', 'Montant (€)', e.amt, 'inputmode="decimal"') + f('ed-obs', 'Observations', e.obs, 'autocomplete="off"')
      : e.kind === 'p' ? f('ed-amt', 'Montant (€)', e.amt, 'inputmode="decimal"') + f('ed-obs', 'Observations', e.obs, 'autocomplete="off"')
      : typeCols().map(function (t, i) { return '<div class="field"><label for="ed-q' + i + '">' + esc(t.libelle) + (t.actif ? '' : ' (archivé)') + ' (' + esc(C.eur(C.cents(t.prix))) + ')</label><input type="number" min="0" step="any" id="ed-q' + i + '" value="' + esc(e.q[t.colonne] || '') + '"></div>'; }).join('') + f('ed-com', 'Commentaire', e.com, 'autocomplete="off"');
    openModal(e.kind === 'a' ? 'Modifier l’achat' : e.kind === 'p' ? 'Modifier le règlement' : 'Modifier la consommation',
      (e.err ? '<div class="alert err" role="alert">' + esc(e.err) + '</div>' : '') +
      '<div class="grid">' + who + '<div class="field"><label for="ed-date">Date</label><input type="date" id="ed-date" value="' + esc(e.date) + '"></div>' + body + '</div>' +
      '<p><button type="button" class="btn" data-act="ed-save">Enregistrer les modifications</button> <button type="button" class="btn sec" data-act="ed-cancel">Annuler</button></p>');
  }
  async function saveEdit() {
    var e = S.edit; if (!e) return;
    readEdit(); var day = C.utcDay(e.date), amt = C.parseAmount(e.amt), table, f;
    if (e.kind === 'a') {
      e.err = !day ? 'Indiquez la date.' : !e.lib ? 'Indiquez ce qui a été acheté.' : !(amt > 0) ? 'Indiquez un montant supérieur à 0.' : '';
      table = T.ACHATS; f = { Date: day, Libelle: e.lib, Fournisseur: e.four, Montant: amt, Observations: e.obs };
    } else if (e.kind === 'p') {
      e.err = !e.who ? 'Choisissez le consommateur.' : !day ? 'Indiquez la date.' : !(amt > 0) ? 'Indiquez un montant supérieur à 0.' : '';
      table = T.REGLEMENTS; f = { Date: day, Consommateur: e.who, Montant: amt, Observations: e.obs };
    } else {
      var any = false, neg = false; f = { Date: day, Consommateur: e.who, Commentaire: e.com };
      typeCols().forEach(function (t) { var n = Number(String(e.q[t.colonne] || '').replace(',', '.')) || 0; if (n < 0) neg = true; if (n > 0) any = true; f[t.colonne] = n; });
      e.err = !e.who ? 'Choisissez le consommateur.' : !day ? 'Indiquez la date.' : neg ? 'Les quantités ne peuvent pas être négatives.' : !any ? 'Indiquez au moins une quantité (ou supprimez la ligne).' : '';
      table = T.CONSOMMATIONS;
    }
    if (e.err) return renderEdit();
    var r = await write([['UpdateRecord', table, e.id, f]], 'Modification enregistrée.');
    if (r && S.edit) { var back = e.kind === 'a' ? 0 : e.who; S.edit = null; S.sk = null; if (back) openDetail(back); else closeModal(); }
  }
  function cancelEdit() { var back = S.edit && S.edit.kind !== 'a' ? S.edit.back : 0; S.edit = null; S.sk = null; if (back && bal(back)) openDetail(back); else closeModal(); }

  /* Saisie manuelle rapide, pour une personne ou en lot (une ligne par personne cochée). Le formulaire reste ouvert pour enchaîner. */
  function activeIds() { return S.bal.rows.filter(function (o) { return o.actif; }).map(function (o) { return o.id; }); }
  function openAdd(id) { S.detail = null; S.rg = null; S.edit = null; S.sk = null; S.add = { id: id || 0, date: localIso(), q: {}, err: '', ok: '', mode: 'one', sel: null }; renderAdd(); var f = $(S.add.id ? 'am-q0' : 'am-who'); if (f) f.focus(); }
  function readAdd() { // recopie la saisie en cours avant tout réaffichage
    var a = S.add; if (!a || !$('am-date')) return;
    a.date = $('am-date').value;
    S.types.filter(function (t) { return t.actif; }).forEach(function (t, i) { var e = $('am-q' + i); if (e) a.q[t.colonne] = e.value; });
    if (a.mode === 'batch') a.sel = Array.prototype.map.call(document.querySelectorAll('#modal-body [data-am-sel]:checked'), function (e) { return Number(e.value); });
    else if ($('am-who')) a.id = Number($('am-who').value) || 0;
  }
  function addQtys() { // quantités saisies (> 0) par colonne de type
    var o = {}; S.types.filter(function (t) { return t.actif; }).forEach(function (t) { var n = Number((S.add.q || {})[t.colonne]) || 0; if (n > 0) o[t.colonne] = n; }); return o;
  }
  function addSummary() { // texte et libellé du bouton, mis à jour à la volée
    var a = S.add; if (!a || a.mode !== 'batch') return;
    var n = ((a.sel) || []).length, each = S.types.reduce(function (s, t) { return s + Math.round((addQtys()[t.colonne] || 0) * C.cents(t.prix)); }, 0);
    if ($('am-count')) $('am-count').textContent = n + ' consommateur' + (n > 1 ? 's' : '') + ' coché' + (n > 1 ? 's' : '') + (each ? ' : ' + C.eur(each) + ' chacun, ' + C.eur(each * n) + ' au total' : '');
    var b = document.querySelector('#modal-body [data-act=add-save]'); if (b) b.textContent = 'Ajouter pour ' + n + ' personne' + (n > 1 ? 's' : '');
  }
  function renderAdd() {
    var a = S.add; if (!a) return;
    var act = S.types.filter(function (t) { return t.actif; }), batch = a.mode === 'batch', who = S.bal.rows.filter(function (o) { return o.actif || o.id === a.id; });
    if (batch && !a.sel) a.sel = activeIds();
    openModal('Ajouter une consommation',
      (a.err ? '<div class="alert err" role="alert">' + esc(a.err) + '</div>' : '') + (a.ok ? '<div class="alert" role="status">' + esc(a.ok) + '</div>' : '') +
      '<fieldset class="mode"><legend class="sr">Mode de saisie</legend><label><input type="radio" name="am-mode" value="one"' + (batch ? '' : ' checked') + '> Un consommateur</label> <label><input type="radio" name="am-mode" value="batch"' + (batch ? ' checked' : '') + '> En lot (plusieurs consommateurs)</label></fieldset>' +
      '<div class="grid">' + (batch ? '' : '<div class="field"><label for="am-who">Consommateur</label><select id="am-who"><option value="0">— choisir —</option>' + who.map(function (o) { return '<option value="' + o.id + '"' + (o.id === a.id ? ' selected' : '') + '>' + esc(o.nom || '(sans nom)') + '</option>'; }).join('') + '</select></div>') +
      '<div class="field"><label for="am-date">Date</label><input type="date" id="am-date" value="' + esc(a.date) + '"></div></div>' +
      (batch ? '<h3>Consommateurs</h3><p class="toolbar"><button type="button" class="btn sec sm" data-act="am-all">Tout cocher</button><button type="button" class="btn sec sm" data-act="am-none">Tout décocher</button><span class="hint" id="am-count" aria-live="polite"></span></p>' +
        '<div class="scroll checks">' + S.bal.rows.filter(function (o) { return o.actif; }).map(function (o) { return '<label class="chk"><input type="checkbox" data-am-sel value="' + o.id + '"' + (a.sel.indexOf(o.id) !== -1 ? ' checked' : '') + '> ' + esc(o.nom || '(sans nom)') + '</label>'; }).join('') + '</div>' : '') +
      '<h3>Quantités' + (batch ? ' (pour chaque personne cochée)' : '') + '</h3><div class="grid">' + act.map(function (t, i) { return '<div class="field"><label for="am-q' + i + '">' + esc(t.libelle) + ' (' + esc(C.eur(C.cents(t.prix))) + ')</label><input type="number" min="0" step="1" id="am-q' + i + '" value="' + esc(a.q[t.colonne] || '') + '"></div>'; }).join('') + '</div>' +
      '<p><button type="button" class="btn" data-act="add-save">Enregistrer</button> <button type="button" class="btn sec" data-act="close">Fermer</button></p>');
    addSummary();
  }
  async function addSave() {
    var a = S.add; if (!a) return;
    readAdd(); a.ok = '';
    var act = S.types.filter(function (t) { return t.actif; }), neg = act.some(function (t) { return (Number(a.q[t.colonne]) || 0) < 0; }), qty = addQtys(), day = C.utcDay(a.date);
    var ids = a.mode === 'batch' ? (a.sel || []).filter(function (id) { return activeIds().indexOf(id) !== -1; }) : (a.id ? [a.id] : []);
    a.err = !ids.length ? (a.mode === 'batch' ? 'Cochez au moins un consommateur.' : 'Choisissez le consommateur.') : !day ? 'Indiquez la date.' : neg ? 'Les quantités ne peuvent pas être négatives.' : !Object.keys(qty).length ? 'Indiquez au moins une quantité.' : '';
    if (a.err) return renderAdd();
    var acts = ids.map(function (id) { var f = { Date: day, Consommateur: id, Commentaire: a.mode === 'batch' ? 'Saisie manuelle (lot)' : 'Saisie manuelle' }; Object.keys(qty).forEach(function (k) { f[k] = qty[k]; }); return ['AddRecord', T.CONSOMMATIONS, null, f]; });
    var o = bal(ids[0]), r = await write(acts);
    if (r && S.add) { a.q = {}; a.ok = ids.length > 1 ? 'Consommation ajoutée pour ' + ids.length + ' personnes. Vous pouvez en saisir une autre.' : 'Consommation ajoutée pour ' + (o ? o.nom : '') + '. Vous pouvez en saisir une autre.'; }
    renderAdd(); var q0 = $('am-q0'); if (q0) q0.focus();
  }

  /* Saisie rapide de règlements : un consommateur, ou en lot (une ligne par personne cochée, montant modifiable, proposé = solde dû). */
  function dueRows() { return S.bal.rows.filter(function (o) { return o.soldeCents > 0; }); }
  function rgInitBatch(a) { a.sel = {}; a.amts = {}; dueRows().forEach(function (o) { a.sel[o.id] = true; a.amts[o.id] = (o.soldeCents / 100).toFixed(2); }); }
  function openRg(id) {
    S.detail = null; S.add = null; S.edit = null; S.sk = null; S.rg = { id: id || 0, date: localIso(), amt: '', obs: '', err: '', ok: '', mode: 'one', sel: null, amts: null };
    var o = bal(S.rg.id); if (o && o.soldeCents > 0) S.rg.amt = (o.soldeCents / 100).toFixed(2);
    renderRg(); var f = $(S.rg.id ? 'rg-amt' : 'rg-who'); if (f) f.focus();
  }
  function readRg() { // recopie la saisie en cours avant tout réaffichage
    var a = S.rg; if (!a || !$('rg-date')) return;
    a.date = $('rg-date').value; a.obs = $('rg-obs').value.trim();
    if (a.mode === 'batch') {
      a.sel = {}; Array.prototype.forEach.call(document.querySelectorAll('#modal-body [data-rg-sel]'), function (e) { a.sel[e.value] = e.checked; });
      Array.prototype.forEach.call(document.querySelectorAll('#modal-body [data-rg-amt]'), function (e) { a.amts[e.getAttribute('data-rg-amt')] = e.value; });
    } else { a.id = Number($('rg-who').value) || 0; a.amt = $('rg-amt').value; }
  }
  function rgPicked() { // [{ o, amt }] des lignes cochées ; amt = NaN si le montant est invalide
    var a = S.rg; return dueRows().filter(function (o) { return a.sel[o.id]; }).map(function (o) { return { o: o, amt: C.parseAmount(a.amts[o.id]) }; });
  }
  function rgSummary() {
    var a = S.rg; if (!a || a.mode !== 'batch') return;
    var p = rgPicked(), tot = p.reduce(function (s, x) { return s + (x.amt > 0 ? C.cents(x.amt) : 0); }, 0);
    if ($('rg-count')) $('rg-count').textContent = p.length + ' personne' + (p.length > 1 ? 's' : '') + ' cochée' + (p.length > 1 ? 's' : '') + ' : ' + C.eur(tot) + ' au total';
    var b = document.querySelector('#modal-body [data-act=rg-save]'); if (b) b.textContent = 'Enregistrer ' + p.length + ' règlement' + (p.length > 1 ? 's' : '');
  }
  function renderRg() {
    var a = S.rg; if (!a) return;
    var batch = a.mode === 'batch', who = S.bal.rows.filter(function (o) { return o.actif || o.nConso || o.nPay || o.id === a.id; }), o = bal(a.id);
    if (batch && !a.sel) rgInitBatch(a);
    var due = dueRows();
    openModal('Enregistrer un règlement',
      (a.err ? '<div class="alert err" role="alert">' + esc(a.err) + '</div>' : '') + (a.ok ? '<div class="alert" role="status">' + esc(a.ok) + '</div>' : '') +
      '<fieldset class="mode"><legend class="sr">Mode de saisie</legend><label><input type="radio" name="rg-mode" value="one"' + (batch ? '' : ' checked') + '> Un consommateur</label> <label><input type="radio" name="rg-mode" value="batch"' + (batch ? ' checked' : '') + '> En lot (plusieurs consommateurs)</label></fieldset>' +
      '<div class="grid">' + (batch ? '' : '<div class="field"><label for="rg-who">Consommateur</label><select id="rg-who"><option value="0">— choisir —</option>' + who.map(function (x) { return '<option value="' + x.id + '"' + (x.id === a.id ? ' selected' : '') + '>' + esc(x.nom || '(sans nom)') + (x.soldeCents > 0 ? ' — doit ' + esc(C.eur(x.soldeCents)) : '') + '</option>'; }).join('') + '</select></div>') +
      '<div class="field"><label for="rg-date">Date</label><input type="date" id="rg-date" value="' + esc(a.date) + '"></div>' +
      (batch ? '' : '<div class="field"><label for="rg-amt">Montant (€)</label><input id="rg-amt" inputmode="decimal" value="' + esc(a.amt) + '"></div>') +
      '<div class="field"><label for="rg-obs">Observations</label><input id="rg-obs" value="' + esc(a.obs) + '" placeholder="Virement, espèces, chèque n°…"></div></div>' +
      (batch ? '<h3>Personnes qui doivent encore de l’argent</h3><p class="toolbar"><button type="button" class="btn sec sm" data-act="rg-all">Tout cocher</button><button type="button" class="btn sec sm" data-act="rg-none">Tout décocher</button><span class="hint" id="rg-count" aria-live="polite"></span></p>' +
        '<div class="scroll"><table><caption class="sr">Règlements à enregistrer</caption><thead><tr><th scope="col">Payé</th><th scope="col">Consommateur</th><th scope="col" class="n">Dû</th><th scope="col" class="n">Montant reçu (€)</th></tr></thead><tbody>' +
        (due.map(function (x) { return '<tr><td><input type="checkbox" data-rg-sel value="' + x.id + '"' + (a.sel[x.id] ? ' checked' : '') + ' aria-label="Inclure ' + esc(x.nom) + '"></td><th scope="row">' + esc(x.nom || '(sans nom)') + '</th><td class="n">' + C.eur(x.soldeCents) + '</td><td class="n"><input data-rg-amt="' + x.id + '" inputmode="decimal" value="' + esc(a.amts[x.id] == null ? '' : a.amts[x.id]) + '" style="width:6.5rem;text-align:right" aria-label="Montant reçu de ' + esc(x.nom) + '"></td></tr>'; }).join('') || '<tr><td colspan="4" class="hint" style="text-align:center">Personne ne doit rien.</td></tr>') + '</tbody></table></div>'
        : (o ? '<p class="hint">Solde actuel : ' + (o.soldeCents < 0 ? 'avoir ' + esc(C.eur(-o.soldeCents)) : esc(C.eur(o.soldeCents)) + ' dû') + '.</p>' : '')) +
      '<p><button type="button" class="btn" data-act="rg-save">Enregistrer</button> <button type="button" class="btn sec" data-act="close">Fermer</button></p>');
    rgSummary();
  }
  async function rgSave() {
    var a = S.rg; if (!a) return;
    readRg(); a.ok = ''; var day = C.utcDay(a.date), acts = [], label = '';
    if (!day) a.err = 'Indiquez la date du règlement.';
    else if (a.mode === 'batch') {
      var p = rgPicked(), bad = p.filter(function (x) { return !(x.amt > 0); })[0];
      a.err = !p.length ? 'Cochez au moins une personne.' : bad ? 'Montant invalide pour ' + (bad.o.nom || '(sans nom)') + ' : indiquez un montant supérieur à 0 ou décochez la ligne.' : '';
      if (!a.err) { acts = p.map(function (x) { return ['AddRecord', T.REGLEMENTS, null, { Date: day, Consommateur: x.o.id, Montant: x.amt, Observations: a.obs }]; }); label = p.length + ' règlements enregistrés (' + C.eur(p.reduce(function (s, x) { return s + C.cents(x.amt); }, 0)) + ').'; }
    } else {
      var amt = C.parseAmount(a.amt);
      a.err = !a.id ? 'Choisissez le consommateur.' : !(amt > 0) ? 'Indiquez un montant supérieur à 0.' : '';
      if (!a.err) { var o = bal(a.id); acts = [['AddRecord', T.REGLEMENTS, null, { Date: day, Consommateur: a.id, Montant: amt, Observations: a.obs }]]; label = 'Règlement de ' + C.eur(C.cents(amt)) + ' enregistré pour ' + (o ? o.nom : '') + '.'; }
    }
    if (a.err) return renderRg();
    var r = await write(acts);
    if (r && S.rg) { a.ok = label; a.id = 0; a.amt = ''; a.obs = ''; if (a.mode === 'batch') rgInitBatch(a); }
    renderRg(); var f = $(a.mode === 'batch' ? 'rg-date' : 'rg-who'); if (f) f.focus();
  }

  function exportCsv() {
    var head = ['Consommateur', 'Courriel'].concat(S.types.map(function (t) { return t.libelle + ' (qté)'; })).concat(['Dû (€)', 'Réglé (€)', 'Solde (€)']);
    function m(c) { return (c / 100).toFixed(2).replace('.', ','); }
    var body = visibleRows().map(function (o) { return [o.nom, o.email].concat(S.types.map(function (t) { return String(o.qty[t.colonne]).replace('.', ','); })).concat([m(o.duCents), m(o.paidCents), m(o.soldeCents)]); });
    download('Consommations_' + localIso() + '.csv', C.csv(head, body));
  }

  /* ---------- Back office ---------- */
  function draftCfg() { return S.draft || { titulaire: S.cfg.titulaire, iban: S.cfg.iban, numero: S.cfg.numero, qr: S.cfg.qr, lien: S.cfg.lien, gestionnaire: S.cfg.gestionnaire }; }
  function ibanHint(v) { return !v ? '' : C.ibanOk(v) ? 'IBAN valide.' : 'Cet IBAN semble invalide (clé de contrôle).'; }
  function viewBO() {
    var d = draftCfg(), ok = hasTables();
    function f(key, label, ph, extra) { return '<div class="field"><label for="cfg-' + key + '">' + label + '</label><input id="cfg-' + key + '" data-cfg="' + key + '" value="' + esc(d[key]) + '" autocomplete="off" placeholder="' + esc(ph || '') + '">' + (extra || '') + '</div>'; }
    var st = '<table><caption class="sr">État des tables</caption><thead><tr><th>Table</th><th>Rôle</th><th>État</th></tr></thead><tbody>' + S.schema.map(function (s) {
      return '<tr><td><code>' + esc(s.id) + '</code></td><td>' + (s.kind === 'reference' ? 'Référence (gestionnaire)' : 'Saisie') + '</td><td>' + (s.ok ? '<span class="tag ok">Présente</span>' : !s.exists ? '<span class="tag due">Manquante</span>' : '<span class="tag due">Colonnes manquantes : ' + esc(s.missing.map(function (c) { return c.id; }).join(', ')) + '</span>') + '</td></tr>';
    }).join('') + '</tbody></table>';
    return '<div class="alert">Les modifications de cette page sont réservées au gestionnaire par les <strong>permissions avancées</strong> de Grist (voir le README). Ce widget n’en est pas le garde-fou.</div>' + deniedBanner() +
      '<section class="card"><h2>1. Installation</h2><p class="hint">Crée les tables manquantes (et leurs colonnes) dans ce document. Sans danger si elles existent déjà : rien n’est supprimé ni écrasé.</p>' + st +
      '<p><button type="button" class="btn" data-act="create">Créer / compléter les tables</button></p></section>' +
      '<section class="card"><h2>2. Règlement</h2><p class="hint">Stocké dans la table <code>' + T.CONFIG + '</code>. Le QR est un virement SEPA (norme EPC) lu par les applications bancaires ; Wero ne publie pas de format ouvert : collez, si vous le souhaitez, le contenu du QR « Recevoir » de l’application Wero.</p>' +
      '<div class="grid">' + f('titulaire', 'Nom du titulaire') + f('iban', 'IBAN', 'FR76 …', '<div class="hint" id="iban-hint">' + esc(ibanHint(d.iban)) + '</div>') + f('numero', 'Numéro Wero', '06 12 34 56 78') + f('qr', 'Contenu du QR (facultatif)', 'Vide : virement SEPA') + '</div>' +
      '<h2>3. Formulaire externe et gestionnaire</h2><div class="grid">' + f('lien', 'Lien du formulaire Grist', 'https://docs.getgrist.com/forms/…') + f('gestionnaire', 'Courriel du gestionnaire', 'prenom.nom@exemple.fr', '<div class="hint">Sert aux permissions avancées (identique au compte Grist, casse comprise).</div>') + '</div>' +
      '<p><button type="button" class="btn" data-act="save-cfg"' + (ok ? '' : ' disabled') + '>Enregistrer</button>' + (ok ? '' : ' <span class="hint">Créez d’abord les tables.</span>') + '</p>' + (S.cfg.many ? '<div class="alert warn">La table de configuration contient plusieurs lignes : seule la première est utilisée.</div>' : '') + '</section>' +
      '<section class="card"><h2>4. Consommateurs</h2>' + (ok ? consoBO() : '<p class="hint">Créez d’abord les tables.</p>') + '</section>' +
      '<section class="card"><h2>5. Types de consommation et tarifs</h2>' + (ok ? typesBO() : '<p class="hint">Créez d’abord les tables.</p>') + '</section>';
  }
  function consoBO() {
    var l = S.consommateurs.slice().sort(function (a, b) { return String(a.Nom).localeCompare(String(b.Nom), 'fr', { sensitivity: 'base' }); });
    return '<p class="hint">Une personne = un consommateur. Désactivez plutôt que supprimer : l’historique est conservé et la personne disparaît de la liste du formulaire.</p>' +
      '<div class="toolbar"><input id="new-nom" placeholder="Nom Prénom" aria-label="Nom du nouveau consommateur"><input id="new-mail" type="email" placeholder="Courriel (facultatif)" aria-label="Courriel du nouveau consommateur"><button type="button" class="btn" data-act="add-cons">Ajouter</button></div>' +
      '<details><summary>Ajouter plusieurs consommateurs</summary><label for="bulk">Un par ligne : <code>Nom Prénom</code> ou <code>Nom Prénom ; courriel</code></label><textarea id="bulk" rows="5" style="width:100%"></textarea><p><button type="button" class="btn sec" data-act="bulk-cons">Importer</button></p></details>' +
      '<div class="scroll"><table><caption class="sr">Consommateurs</caption><thead><tr><th>Nom</th><th>Courriel</th><th>Actif</th><th></th></tr></thead><tbody>' + (l.map(function (r) {
        return '<tr><td><input data-cs="Nom" data-id="' + r.id + '" value="' + esc(r.Nom) + '" aria-label="Nom"></td><td><input data-cs="Email" data-id="' + r.id + '" value="' + esc(r.Email) + '" aria-label="Courriel"></td><td><input type="checkbox" data-cs="Actif" data-id="' + r.id + '"' + (r.Actif !== false && r.Actif !== 0 ? ' checked' : '') + ' aria-label="Actif"></td><td><button type="button" class="btn sec sm" data-act="del-cons" data-id="' + r.id + '">Supprimer</button></td></tr>';
      }).join('') || '<tr><td colspan="4" class="hint">Aucun consommateur.</td></tr>') + '</tbody></table></div>';
  }
  function typesBO() {
    return '<p class="hint">Une colonne par type dans <code>' + T.CONSOMMATIONS + '</code> : c’est elle que le formulaire propose. <strong>Le tarif s’applique à tout l’historique</strong> : pour un changement de prix à partir d’une date, archivez le type et créez-en un nouveau.</p>' +
      '<div class="scroll"><table><caption class="sr">Types et tarifs</caption><thead><tr><th>Libellé</th><th>Colonne</th><th>Tarif (€)</th><th>Actif</th></tr></thead><tbody>' + (S.types.map(function (t) {
        return '<tr><td><input data-ty="Libelle" data-id="' + t.id + '" value="' + esc(t.libelle) + '" aria-label="Libellé"></td><td><code>' + esc(t.colonne) + '</code></td><td><input data-ty="Tarif" data-id="' + t.id + '" inputmode="decimal" value="' + esc(String(t.prix).replace('.', ',')) + '" style="width:6rem" aria-label="Tarif de ' + esc(t.libelle) + '"></td><td><input type="checkbox" data-ty="Actif" data-id="' + t.id + '"' + (t.actif ? ' checked' : '') + ' aria-label="Actif"></td></tr>';
      }).join('') || '<tr><td colspan="4" class="hint">Aucun type.</td></tr>') + '</tbody></table></div>' +
      '<div class="toolbar"><input id="new-ty" placeholder="Nouveau type (ex. Gâteau)" aria-label="Libellé du nouveau type"><input id="new-prix" inputmode="decimal" placeholder="Tarif (€)" style="width:7rem" aria-label="Tarif du nouveau type"><button type="button" class="btn" data-act="add-type">Ajouter le type</button></div>';
  }

  /* Création / complétion des tables : idempotente, en 4 temps (références, amorçage, tables avec références, affichage des noms). */
  async function createTables() {
    S.busy = true;
    try {
      await load();
      var st = C.schemaStatus(S.names, S.cols, S.types), A = [], seedTypes = false, seedCfg = false;
      st.forEach(function (s) {
        var def = C.defOf(s.id); if (def.ref) return;
        if (!s.exists) { A.push(C.addTableAction(def, [])); if (s.id === T.TYPES) seedTypes = true; if (s.id === T.CONFIG) seedCfg = true; }
        else if (s.missing.length) A = A.concat(C.addColumnActions(def, s.missing));
      });
      if (A.length) await G().applyUserActions(A);
      var B = [];
      if (seedTypes) {
        var taken = [];
        C.DEFAULT_TYPES.forEach(function (t) { var id = C.uniqueColId(t.libelle, taken); taken.push(id); B.push(['AddRecord', T.TYPES, null, { Libelle: t.libelle, Colonne: id, Tarif: t.tarif, Actif: true }]); });
      }
      if (seedCfg) B.push(['AddRecord', T.CONFIG, null, {}]);
      if (B.length) await G().applyUserActions(B);
      await load();
      var D = [];
      C.schemaStatus(S.names, S.cols, S.types).forEach(function (s) {
        var def = C.defOf(s.id); if (!def.ref) return;
        if (!s.exists) D.push(C.addTableAction(def, S.types)); else if (s.missing.length) D = D.concat(C.addColumnActions(def, s.missing));
      });
      if (D.length) await G().applyUserActions(D);
      await load();
      var warn = '';
      if (S.meta) { var R = C.refDisplayActions({ tables: S.meta.tables, cols: S.meta.cols }); if (R.length) { try { await G().applyUserActions(R); } catch (e) { warn = ' Les noms n’ont pas pu être affichés dans les listes du formulaire (' + errText(e) + ') : réglez « Afficher la colonne = Nom » à la main (README).'; } } }
      await load();
      toast(warn ? 'error' : 'ok', (A.length || B.length || D.length ? 'Tables créées / complétées.' : 'Tout est déjà en place.') + warn);
    } catch (e) { toast('error', 'Création impossible : ' + errText(e)); try { await load(); } catch (e2) {} }
    finally { S.busy = false; render(); }
  }

  async function saveCfg() {
    var d = draftCfg(), err = '';
    if (d.iban && !C.ibanOk(d.iban)) err = 'IBAN invalide (clé de contrôle) : corrigez-le ou videz le champ.';
    else if (d.lien && !C.isHttpUrl(d.lien)) err = 'Le lien du formulaire doit commencer par https://.';
    else if (d.gestionnaire && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.gestionnaire)) err = 'Courriel du gestionnaire invalide.';
    if (err) return toast('error', err);
    var f = { Titulaire: d.titulaire.trim(), IBAN: d.iban ? C.ibanFmt(d.iban) : '', Numero_Wero: d.numero.trim(), QR_Contenu: d.qr.trim(), Lien_formulaire: d.lien.trim(), Email_gestionnaire: d.gestionnaire.trim() };
    var r = await write([S.cfg.id ? ['UpdateRecord', T.CONFIG, S.cfg.id, f] : ['AddRecord', T.CONFIG, null, f]], 'Réglages enregistrés.');
    if (r) S.draft = null; render();
  }

  function dupName(nom, exceptId) { var n = C.norm(nom); return S.consommateurs.some(function (r) { return r.id !== exceptId && C.norm(r.Nom) === n; }); }
  async function addCons() {
    var nom = $('new-nom').value.trim(), mail = $('new-mail').value.trim();
    if (!nom) return toast('error', 'Indiquez le nom.');
    if (dupName(nom)) return toast('error', 'Ce nom existe déjà : deux personnes de même nom seraient indiscernables dans le formulaire (ajoutez un repère, ex. « Martin Léa (B) »).');
    await write([['AddRecord', T.CONSOMMATEURS, null, { Nom: nom, Email: mail, Actif: true }]], 'Consommateur ajouté.');
  }
  async function bulkCons() {
    var seen = {}, acts = [], skipped = 0;
    S.consommateurs.forEach(function (r) { seen[C.norm(r.Nom)] = 1; });
    $('bulk').value.split(/\r?\n/).forEach(function (line) {
      var p = line.split(';'), nom = (p[0] || '').trim(), mail = (p[1] || '').trim(); if (!nom) return;
      if (seen[C.norm(nom)]) { skipped++; return; } seen[C.norm(nom)] = 1;
      acts.push(['AddRecord', T.CONSOMMATEURS, null, { Nom: nom, Email: mail, Actif: true }]);
    });
    if (!acts.length) return toast('error', skipped ? 'Tous ces noms existent déjà.' : 'Rien à importer.');
    await write(acts, acts.length + ' consommateur(s) ajouté(s)' + (skipped ? ', ' + skipped + ' doublon(s) ignoré(s)' : '') + '.');
  }
  async function delCons(id) {
    var used = S.consommations.some(function (r) { return Number(r.Consommateur) === id; }) || S.reglements.some(function (r) { return Number(r.Consommateur) === id; });
    if (used) return toast('error', 'Cette personne a des consommations ou des règlements : désactivez-la plutôt (case « Actif »).');
    await write([['RemoveRecord', T.CONSOMMATEURS, id]], 'Consommateur supprimé.');
  }
  async function editCons(el) {
    var id = Number(el.getAttribute('data-id')), k = el.getAttribute('data-cs'), v = k === 'Actif' ? el.checked : el.value.trim();
    if (k === 'Nom') { if (!v) { toast('error', 'Le nom ne peut pas être vide.'); return refresh(); } if (dupName(v, id)) { toast('error', 'Ce nom existe déjà.'); return refresh(); } }
    await write([['UpdateRecord', T.CONSOMMATEURS, id, (function () { var o = {}; o[k] = v; return o; })()]]);
  }
  async function addType() {
    var lib = $('new-ty').value.trim(), prix = C.parseAmount($('new-prix').value || '0');
    if (!lib) return toast('error', 'Indiquez le libellé.');
    if (!(prix >= 0)) return toast('error', 'Tarif invalide.');
    if (S.types.some(function (t) { return C.norm(t.libelle) === C.norm(lib); })) return toast('error', 'Ce type existe déjà.');
    var taken = (S.cols[T.CONSOMMATIONS] || []).concat(S.types.map(function (t) { return t.colonne; })), id = C.uniqueColId(lib, taken);
    var acts = [], conso = realName(T.CONSOMMATIONS);
    if (conso) {
      S.busy = true;
      try { var r = await G().applyUserActions([['AddColumn', conso, id, C.typeColSpec({ colonne: id, libelle: lib })]]); var rv = r && r.retValues && r.retValues[0]; if (rv && rv.colId) id = rv.colId; }
      catch (e) { S.busy = false; return toast('error', 'Colonne non créée : ' + errText(e)); }
      S.busy = false;
    }
    acts.push(['AddRecord', T.TYPES, null, { Libelle: lib, Colonne: id, Tarif: prix, Actif: true }]);
    await write(acts, 'Type ajouté. Pensez à l’ajouter au formulaire (README).');
  }
  async function editType(el) {
    var id = Number(el.getAttribute('data-id')), k = el.getAttribute('data-ty'), t = S.types.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    var f = {}, extra = [];
    if (k === 'Actif') f.Actif = el.checked;
    else if (k === 'Tarif') { var p = C.parseAmount(el.value); if (!(p >= 0)) { toast('error', 'Tarif invalide.'); return refresh(); } f.Tarif = p; }
    else { var v = el.value.trim(); if (!v) { toast('error', 'Le libellé ne peut pas être vide.'); return refresh(); } f.Libelle = v;
      if (realName(T.CONSOMMATIONS) && (S.cols[T.CONSOMMATIONS] || []).indexOf(t.colonne) !== -1) extra.push(['ModifyColumn', realName(T.CONSOMMATIONS), t.colonne, { label: v }]); } // le libellé du formulaire suit
    await write([['UpdateRecord', T.TYPES, id, f]].concat(extra), k === 'Actif' && !el.checked ? 'Type archivé : retirez aussi son champ du formulaire.' : '');
  }

  /* ---------- Événements ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
    var a = b.getAttribute('data-act'), id = Number(b.getAttribute('data-id'));
    if (b.tagName === 'TR' && e.target.closest('button')) return;                       // un bouton de la ligne a sa propre action
    if (a === 'tab') { S.tab = b.getAttribute('data-tab'); return render(); }
    if (a === 'close') return closeModal();
    if (a === 'detail') return openDetail(id);
    if (a === 'pay') { var o = bal(id); return showPay(o ? 'Régler : ' + o.nom : 'Régler', { amountCents: o && o.soldeCents > 0 ? o.soldeCents : 0, label: o ? 'Consommations ' + o.nom : 'Consommations' }); }
    if (a === 'form-qr') return showFormQr();
    if (a === 'ed-a' || a === 'ed-c' || a === 'ed-p') return openEdit(a.slice(3), id);
    if (a === 'ed-save') return saveEdit();
    if (a === 'ed-cancel') return cancelEdit();
    if (a === 'sk-in' || a === 'sk-inv') return openSk(a === 'sk-in' ? 'in' : 'inv');
    if (a === 'sk-save') return saveSk();
    if (a === 'sk-del') return delStock(id);
    if (a === 'ac-save') return saveAchat();
    if (a === 'ac-del') return delAchat(id);
    if (a === 'ac-export') return exportAchats();
    if (a === 'add-open') return openAdd(id || 0);
    if (a === 'add-save') return addSave();
    if (a === 'am-all' || a === 'am-none') { readAdd(); S.add.sel = a === 'am-all' ? activeIds() : []; return renderAdd(); }
    if (a === 'rg-open') return openRg(id || 0);
    if (a === 'rg-save') return rgSave();
    if (a === 'rg-all' || a === 'rg-none') { readRg(); Object.keys(S.rg.sel).forEach(function (k) { S.rg.sel[k] = a === 'rg-all'; }); return renderRg(); }
    if (a === 'export') return exportCsv();
    if (a === 'create') return createTables();
    if (a === 'save-cfg') return saveCfg();
    if (a === 'add-cons') return addCons();
    if (a === 'bulk-cons') return bulkCons();
    if (a === 'del-cons') return delCons(id);
    if (a === 'add-type') return addType();
    return detailAction(a, b);
  });
  document.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.row')) { e.preventDefault(); openDetail(Number(e.target.getAttribute('data-id'))); } });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (S.rg && t.getAttribute && t.hasAttribute('data-rg-amt')) { readRg(); rgSummary(); return; }
    if (S.add && t.id && /^am-q\d+$/.test(t.id)) { readAdd(); addSummary(); return; }
    if (t.id === 'q') { S.q = t.value; $('suivi-table').innerHTML = tableSuivi(); return; }
    if (t.getAttribute && t.getAttribute('data-cfg')) {
      var d = S.draft = draftCfg(); d[t.getAttribute('data-cfg')] = t.value;
      if (t.getAttribute('data-cfg') === 'iban') $('iban-hint').textContent = ibanHint(t.value);
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'am-mode' && S.add) { readAdd(); S.add.mode = t.value; if (t.value === 'batch' && !S.add.sel) S.add.sel = activeIds(); return renderAdd(); }
    if (t.getAttribute && t.hasAttribute('data-am-sel') && S.add) { readAdd(); return addSummary(); }
    if (t.name === 'rg-mode' && S.rg) { readRg(); S.rg.mode = t.value; if (t.value === 'batch' && !S.rg.sel) rgInitBatch(S.rg); return renderRg(); }
    if (t.getAttribute && t.hasAttribute('data-rg-sel') && S.rg) { readRg(); return rgSummary(); }
    if (t.id === 'rg-who' && S.rg) { var o = bal(Number(t.value)), am = $('rg-amt'); if (am && !am.value.trim() && o && o.soldeCents > 0) am.value = (o.soldeCents / 100).toFixed(2); return; }
    if (t.getAttribute && t.hasAttribute('data-sk-seuil')) return editSeuil(t);
    if (t.id === 'f') { S.f = t.value; $('suivi-table').innerHTML = tableSuivi(); return; }
    if (t.getAttribute && t.getAttribute('data-cs')) return editCons(t);
    if (t.getAttribute && t.getAttribute('data-ty')) return editType(t);
  });
  $('modal').addEventListener('close', function () { S.detail = null; S.add = null; S.rg = null; S.edit = null; S.sk = null; });
  $('refresh').addEventListener('click', function () { refresh(); });

  /* ---------- Démarrage ---------- */
  if (!window.grist || !window.grist.docApi) { $('app').innerHTML = '<div class="alert err">L’API Grist est introuvable : ouvrez ce widget depuis Grist (widget personnalisé), ou ajoutez <code>?demo=1</code> à l’adresse pour l’essayer hors de Grist.</div>'; return; }
  var timer = null;
  // Si le widget est lié à une table (ex. Conso_Consommations), chaque modification recharge l'affichage.
  if (window.grist.onRecords) window.grist.onRecords(function () { clearTimeout(timer); timer = setTimeout(function () { if (!S.busy) refresh(); }, 400); });
  window.grist.ready({ requiredAccess: 'full' });
  refresh();
  window.__CONSO = { S: S, refresh: refresh };
})();
