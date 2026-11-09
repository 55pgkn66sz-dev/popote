/* Faux Grist en mémoire pour essayer le widget hors de Grist : index.html?demo=1
   Gère listTables / fetchTable / applyUserActions (AddTable, AddColumn, ModifyColumn, AddRecord, UpdateRecord,
   RemoveRecord, SetDisplayFormula) et les tables _grist_Tables / _grist_Tables_column. Ce n'est PAS un test de Grist lui-même. */
(function () {
  var tables = {}, meta = { Tables: [], Cols: [] }, nextTable = 1, nextCol = 1;
  window.__MOCK_LOG = [];
  function addTable(name, cols) {
    if (tables[name]) throw new Error('Table déjà existante : ' + name);
    var tid = nextTable++; tables[name] = { rows: [], next: 1, tid: tid }; meta.Tables.push({ id: tid, tableId: name });
    (cols || []).forEach(function (c) { addCol(name, c.id, c); });
  }
  function addCol(t, id, o) {
    if (!tables[t]) throw new Error('Table inconnue : ' + t);
    if (meta.Cols.some(function (c) { return c.parentId === tables[t].tid && c.colId.toLowerCase() === id.toLowerCase(); })) throw new Error('Colonne déjà existante : ' + t + '.' + id);
    var ref = nextCol++; meta.Cols.push({ id: ref, parentId: tables[t].tid, colId: id, type: o.type, label: o.label || id, visibleCol: 0, widgetOptions: o.widgetOptions || '', formula: o.formula || '' });
    return { colId: id, colRef: ref };
  }
  function colRows(t, id) { return meta.Cols.filter(function (c) { return c.parentId === tables[t].tid && c.colId === id; })[0]; }
  function apply(a) {
    window.__MOCK_LOG.push(a);
    var k = a[0];
    if (k === 'AddTable') { addTable(a[1], a[2]); return null; }
    if (k === 'AddColumn') return addCol(a[1], a[2], a[3]);
    if (k === 'ModifyColumn') { var c = colRows(a[1], a[2]); if (!c) throw new Error('Colonne inconnue'); Object.keys(a[3]).forEach(function (x) { c[x] = a[3][x]; }); return null; }
    if (k === 'SetDisplayFormula') return null;
    if (a[1] === '_grist_Tables_column' && k === 'UpdateRecord') { meta.Cols.forEach(function (c) { if (c.id === a[2]) Object.keys(a[3]).forEach(function (x) { c[x] = a[3][x]; }); }); return null; }
    var t = tables[a[1]]; if (!t) throw new Error('Table inconnue : ' + a[1]);
    if (k === 'AddRecord') { var r = { id: t.next++ }; Object.keys(a[3]).forEach(function (x) { r[x] = a[3][x]; });
      if (a[1] === 'Conso_Consommations' && r.Date == null) r.Date = Math.floor(Date.now() / 86400000) * 86400; // formule de déclenchement TODAY()
      t.rows.push(r); return r.id; }
    if (k === 'UpdateRecord') { var u = t.rows.filter(function (x) { return x.id === a[2]; })[0]; if (!u) throw new Error('Ligne inconnue'); Object.keys(a[3]).forEach(function (x) { u[x] = a[3][x]; }); return null; }
    if (k === 'RemoveRecord') { t.rows = t.rows.filter(function (x) { return x.id !== a[2]; }); return null; }
    throw new Error('Action non gérée par le faux Grist : ' + k);
  }
  function columnar(rows, keys) { var o = { id: rows.map(function (r) { return r.id; }) }; keys.forEach(function (k) { o[k] = rows.map(function (r) { return r[k] === undefined ? null : r[k]; }); }); return o; }
  window.grist = {
    ready: function () {}, onRecords: function () {}, onOptions: function () {},
    docApi: {
      listTables: function () { return Promise.resolve(Object.keys(tables)); },
      fetchTable: function (name) {
        if (name === '_grist_Tables') return Promise.resolve(columnar(meta.Tables, ['tableId']));
        if (name === '_grist_Tables_column') return Promise.resolve(columnar(meta.Cols, ['parentId', 'colId', 'type', 'label', 'visibleCol', 'widgetOptions']));
        var t = tables[name]; if (!t) return Promise.reject(new Error('Table inconnue : ' + name));
        var keys = meta.Cols.filter(function (c) { return c.parentId === t.tid; }).map(function (c) { return c.colId; });
        return Promise.resolve(columnar(t.rows, keys));
      },
      applyUserActions: function (acts) {
        if (window.__MOCK_DENY) return Promise.reject(new Error('Blocked by table read access rules / access denied'));
        try { return Promise.resolve({ retValues: acts.map(apply) }); } catch (e) { return Promise.reject(e); }
      }
    }
  };
  window.__MOCK = { tables: tables, meta: meta };
})();
