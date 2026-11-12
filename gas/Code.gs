/**
 * 応援管理・請求書 ― Google スプレッドシート連携用スクリプト
 *
 * 使い方：
 *   1. 下の「合言葉」を自分だけが分かる文字に書き換える（アプリにも同じものを入力します）
 *   2. 保存して「デプロイ → 新しいデプロイ → ウェブアプリ」で公開
 *      （次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員）
 */
const PASSWORD = 'ここを合言葉に変更';

// ===== シートの列（左から順に並びます） =====
const SHEETS = {
  records: {
    name: '記録',
    cols: [
      ['id', 'ID'], ['date', '日付'], ['clientId', '応援先ID'], ['clientName', '応援先'],
      ['site', '現場名'], ['work', '作業内容'], ['workers', '人工'], ['unitPrice', '単価'],
      ['otHours', '残業時間'], ['otRate', '残業単価'], ['expense', '経費'], ['expenseNote', '経費内容'],
      ['amount', '金額(税抜)'], ['members', '作業員'], ['note', '備考'], ['billed', '請求番号'], ['updatedAt', '更新日時'],
    ],
    text: ['id', 'date', 'clientId', 'clientName', 'site', 'work', 'expenseNote', 'members', 'note', 'billed', 'updatedAt'],
  },
  clients: {
    name: '応援先',
    cols: [
      ['id', 'ID'], ['name', '会社名'], ['honor', '敬称'], ['closing', '締め日'], ['unitPrice', '標準単価'],
      ['otRate', '標準残業単価'], ['payTerms', '支払条件'], ['address', '住所'],
    ],
    text: ['id', 'name', 'honor', 'closing', 'payTerms', 'address'],
  },
};
const COMPANY_SHEET = '自社情報';
const COMPANY_LABELS = {
  name: '会社名', rep: '代表者', regNo: '登録番号', zip: '郵便番号', address: '住所', tel: '電話', fax: 'FAX',
  bank: '振込先', taxRate: '消費税率(%)', rounding: '端数処理', invoiceStyle: '請求書デザイン',
};
const NUM_KEYS = ['workers', 'unitPrice', 'otHours', 'otRate', 'expense', 'amount'];

// ===== 受付 =====
function doGet(e) {
  return handle(function () {
    checkPassword(e.parameter.key);
    return { ok: true, data: loadAll() };
  });
}

function doPost(e) {
  return handle(function () {
    const body = JSON.parse(e.postData.contents);
    checkPassword(body.key);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      applyOps(body.ops || []);
      return { ok: true, data: loadAll() };
    } finally {
      lock.releaseLock();
    }
  });
}

function handle(fn) {
  let out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkPassword(key) {
  if (PASSWORD === 'ここを合言葉に変更') throw new Error('スクリプトの合言葉（PASSWORD）がまだ設定されていません');
  if (String(key || '') !== PASSWORD) throw new Error('合言葉が違います');
}

// ===== 読み書き =====
function loadAll() {
  return { company: readCompany(), clients: readTable('clients'), records: readTable('records') };
}

function applyOps(ops) {
  const recs = toMap(readTable('records'));
  const clis = toMap(readTable('clients'));
  let company = null;
  let touchedR = false, touchedC = false;
  ops.forEach(function (o) {
    switch (o.op) {
      case 'upsertRecord': recs[o.data.id] = o.data; touchedR = true; break;
      case 'deleteRecord': delete recs[o.id]; touchedR = true; break;
      case 'upsertClient': clis[o.data.id] = o.data; touchedC = true; touchedR = true; break;
      case 'deleteClient': delete clis[o.id]; touchedC = true; break;
      case 'setCompany': company = o.data; break;
      case 'replaceAll':
        Object.keys(recs).forEach(function (k) { delete recs[k]; });
        Object.keys(clis).forEach(function (k) { delete clis[k]; });
        (o.data.records || []).forEach(function (r) { recs[r.id] = r; });
        (o.data.clients || []).forEach(function (c) { clis[c.id] = c; });
        company = o.data.company || {};
        touchedR = touchedC = true;
        break;
      default: throw new Error('不明な操作: ' + o.op);
    }
  });
  if (touchedC) writeTable('clients', values(clis));
  if (touchedR) {
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    const list = values(recs).map(function (r) {
      const c = clis[r.clientId];
      const out = Object.assign({}, r);
      out.clientName = c ? c.name : '';
      out.amount = num(r.workers) * num(r.unitPrice) + num(r.otHours) * num(r.otRate) + num(r.expense);
      if (!out.updatedAt) out.updatedAt = now;
      return out;
    });
    list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    writeTable('records', list);
  }
  if (company) writeCompany(company);
}

function sheetFor(kind) {
  const def = SHEETS[kind];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.name);
  if (!sh) sh = ss.insertSheet(def.name);
  const labels = def.cols.map(function (c) { return c[1]; });
  const head = sh.getRange(1, 1, 1, labels.length).getValues()[0];
  if (head.join('\t') !== labels.join('\t')) {
    sh.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold');
    sh.setFrozenRows(1);
    def.cols.forEach(function (c, i) {
      if (def.text.indexOf(c[0]) >= 0) sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    });
  }
  return sh;
}

function readTable(kind) {
  const def = SHEETS[kind];
  const sh = sheetFor(kind);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, last - 1, def.cols.length).getValues()
    .filter(function (row) { return row[0] !== ''; })
    .map(function (row) {
      const o = {};
      def.cols.forEach(function (c, i) {
        let v = row[i];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, c[0] === 'updatedAt' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
        if (NUM_KEYS.indexOf(c[0]) >= 0) v = num(v);
        else v = v === null || v === undefined ? '' : String(v);
        o[c[0]] = v;
      });
      return o;
    });
}

function writeTable(kind, list) {
  const def = SHEETS[kind];
  const sh = sheetFor(kind);
  const n = def.cols.length;
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, n).clearContent();
  if (!list.length) return;
  const rows = list.map(function (o) {
    return def.cols.map(function (c) {
      const v = o[c[0]];
      if (NUM_KEYS.indexOf(c[0]) >= 0) return num(v);
      return v === null || v === undefined ? '' : String(v);
    });
  });
  sh.getRange(2, 1, rows.length, n).setValues(rows);
}

function readCompany() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(COMPANY_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (row) {
    if (row[0] !== '') out[String(row[0])] = row[1] === null ? '' : String(row[1]);
  });
  return out;
}

function writeCompany(company) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(COMPANY_SHEET);
  if (!sh) sh = ss.insertSheet(COMPANY_SHEET);
  sh.clearContents();
  const keys = Object.keys(company);
  const rows = [['キー', '値', '項目']].concat(keys.map(function (k) {
    return [k, company[k] === null || company[k] === undefined ? '' : String(company[k]), COMPANY_LABELS[k] || ''];
  }));
  sh.getRange(1, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
  sh.setFrozenRows(1);
}

function toMap(list) { const m = {}; list.forEach(function (o) { m[o.id] = o; }); return m; }
function values(m) { return Object.keys(m).map(function (k) { return m[k]; }); }
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
