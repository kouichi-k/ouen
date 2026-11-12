'use strict';

// ===== データ保存 =====
const KEY = 'ouen-data-v1';
const empty = () => ({ company: { taxRate: 10, rounding: 'floor' }, clients: [], records: [] });
let db = load();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.records)) return Object.assign(empty(), d);
  } catch (e) { /* 読めない場合は空で開始 */ }
  return empty();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { alert('保存できませんでした（ブラウザの保存領域を確認してください）'); }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ===== ユーティリティ =====
const $ = (s) => document.querySelector(s);
const yen = (n) => Math.round(n || 0).toLocaleString('ja-JP');
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const thisMonth = () => today().slice(0, 7);
const WEEK = '日月火水木金土';
function jpDate(s, withWeek) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const w = withWeek ? `(${WEEK[new Date(y, m - 1, d).getDay()]})` : '';
  return `${m}/${d}${w}`;
}
function jpFullDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}
const clientById = (id) => db.clients.find((c) => c.id === id);
const clientName = (id) => clientById(id)?.name || '（削除された応援先）';

function amountOf(r) {
  return num(r.workers) * num(r.unitPrice) + num(r.otHours) * num(r.otRate) + num(r.expense);
}
function roundTax(v) {
  const m = db.company.rounding || 'floor';
  return Math[m](v);
}

// 締め日から請求期間を出す（closing=0 は末締め）
function periodOf(month, closing) {
  const [y, m] = month.split('-').map(Number);
  const c = Number(closing) || 0;
  if (!c) return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
  return { from: ymd(new Date(y, m - 2, c + 1)), to: ymd(new Date(y, m - 1, c)) };
}

// ===== タブ =====
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  if (name === 'list') renderList();
  if (name === 'invoice') renderInvoice();
  if (name === 'entry') renderRecent();
  window.scrollTo(0, 0);
}

function fillClientSelect(sel, withAll) {
  const cur = sel.value;
  sel.innerHTML = (withAll ? '<option value="">すべて</option>' : '') +
    db.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
function refreshSelects() {
  fillClientSelect($('#entry-form').clientId, false);
  fillClientSelect($('#list-client'), true);
  fillClientSelect($('#inv-client'), false);
  const sites = [...new Set(db.records.map((r) => r.site).filter(Boolean))];
  $('#site-list').innerHTML = sites.map((s) => `<option value="${esc(s)}">`).join('');
}

// ===== 記録入力 =====
const ef = $('#entry-form');
let entryDirty = false; // 入力途中かどうか（同期で上書きしないため）
function resetEntry() {
  entryDirty = false;
  ef.reset();
  ef.id.value = '';
  ef.date.value = today();
  const last = db.records[db.records.length - 1];
  if (last && clientById(last.clientId)) ef.clientId.value = last.clientId;
  applyClientDefaults();
  $('#entry-title').textContent = '応援記録の入力';
  $('#entry-cancel').classList.add('hidden');
  updateEntryAmount();
}
function applyClientDefaults() {
  const c = clientById(ef.clientId.value);
  ef.unitPrice.value = c ? c.unitPrice || 0 : 0;
  ef.otRate.value = c ? c.otRate || 0 : 0;
}
function updateEntryAmount() {
  $('#entry-amount').textContent = yen(amountOf(Object.fromEntries(new FormData(ef))));
}
ef.clientId.addEventListener('change', () => { if (!ef.id.value) applyClientDefaults(); updateEntryAmount(); });
ef.addEventListener('input', () => { entryDirty = true; updateEntryAmount(); });
ef.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!db.clients.length) { alert('先に「設定」で応援先を登録してください'); showTab('settings'); return; }
  const f = Object.fromEntries(new FormData(ef));
  const rec = {
    id: f.id || uid(), date: f.date, clientId: f.clientId, site: f.site.trim(), work: f.work.trim(),
    workers: num(f.workers), unitPrice: num(f.unitPrice), otHours: num(f.otHours), otRate: num(f.otRate),
    expense: num(f.expense), expenseNote: f.expenseNote.trim(), members: f.members.trim(), note: f.note.trim(),
  };
  const i = db.records.findIndex((r) => r.id === rec.id);
  if (i >= 0) { rec.billed = db.records[i].billed; db.records[i] = rec; } else db.records.push(rec);
  commit([{ op: 'upsertRecord', data: rec }]); refreshSelects();
  toast(i >= 0 ? '更新しました' : '保存しました');
  const wasEdit = i >= 0;
  resetEntry(); renderRecent();
  if (wasEdit) showTab('list');
});
$('#entry-cancel').addEventListener('click', () => { resetEntry(); showTab('list'); });

function editRecord(id) {
  const r = db.records.find((x) => x.id === id); if (!r) return;
  showTab('entry');
  for (const k of ['id', 'date', 'clientId', 'site', 'work', 'workers', 'unitPrice', 'otHours', 'otRate', 'expense', 'expenseNote', 'members', 'note']) {
    ef[k].value = r[k] ?? '';
  }
  $('#entry-title').textContent = '応援記録の編集';
  $('#entry-cancel').classList.remove('hidden');
  updateEntryAmount();
}
function copyRecord(id) {
  const r = db.records.find((x) => x.id === id); if (!r) return;
  editRecord(id);
  ef.id.value = ''; ef.date.value = today();
  $('#entry-title').textContent = '応援記録の入力（コピー）';
  updateEntryAmount();
}
function deleteRecord(id) {
  const r = db.records.find((x) => x.id === id); if (!r) return;
  if (!confirm(`${jpDate(r.date)} ${clientName(r.clientId)} の記録を削除しますか？`)) return;
  db.records = db.records.filter((x) => x.id !== id);
  commit([{ op: 'deleteRecord', id }]); renderList(); renderRecent(); toast('削除しました');
}

function renderRecent() {
  const rs = [...db.records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('#recent').innerHTML = rs.length ? rs.map((r) => `
    <div class="card"><div class="row">
      <div><strong>${jpDate(r.date, true)}</strong> ${esc(clientName(r.clientId))}
        <div class="sub">${esc(r.site)} ${esc(r.work)} ／ ${r.workers}人工</div></div>
      <div>${yen(amountOf(r))}円 <button class="small" data-copy="${r.id}">コピー</button></div>
    </div></div>`).join('') : '<p class="empty">まだ記録がありません</p>';
}
$('#recent').addEventListener('click', (e) => { const id = e.target.dataset.copy; if (id) copyRecord(id); });

// ===== 一覧 =====
function listRecords() {
  const m = $('#list-month').value, c = $('#list-client').value;
  return db.records.filter((r) => (!m || r.date.startsWith(m)) && (!c || r.clientId === c))
    .sort((a, b) => a.date.localeCompare(b.date) || clientName(a.clientId).localeCompare(clientName(b.clientId)));
}
function renderList() {
  const rs = listRecords();
  const byClient = {};
  rs.forEach((r) => {
    const k = clientName(r.clientId);
    byClient[k] = byClient[k] || { days: new Set(), workers: 0, amount: 0 };
    byClient[k].days.add(r.date); byClient[k].workers += num(r.workers); byClient[k].amount += amountOf(r);
  });
  const total = rs.reduce((s, r) => s + amountOf(r), 0);
  $('#list-summary').innerHTML = rs.length
    ? Object.entries(byClient).map(([k, v]) => `<div>${esc(k)}：${v.days.size}日 ／ ${v.workers}人工 ／ ${yen(v.amount)}円（税抜）</div>`).join('') +
      `<div><strong>合計：${yen(total)}円（税抜）</strong></div>`
    : '該当する記録はありません';
  $('#list-table').innerHTML = `<thead><tr><th>日付</th><th>応援先</th><th>現場・作業</th><th class="num">人工</th><th class="num">単価</th><th class="num">残業</th><th class="num">経費</th><th class="num">金額</th><th></th></tr></thead><tbody>` +
    rs.map((r) => `<tr>
      <td>${jpDate(r.date, true)}${r.billed ? '<br><span class="badge">請求済</span>' : ''}</td>
      <td>${esc(clientName(r.clientId))}</td>
      <td>${esc(r.site)}<br>${esc(r.work)}${r.members ? `<br><small>${esc(r.members)}</small>` : ''}${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</td>
      <td class="num">${r.workers}</td><td class="num">${yen(r.unitPrice)}</td>
      <td class="num">${r.otHours ? `${r.otHours}h` : ''}</td><td class="num">${r.expense ? yen(r.expense) : ''}</td>
      <td class="num">${yen(amountOf(r))}</td>
      <td><button class="small" data-edit="${r.id}">編集</button> <button class="small danger" data-del="${r.id}">削除</button></td>
    </tr>`).join('') + '</tbody>';
}
$('#list-month').addEventListener('change', renderList);
$('#list-client').addEventListener('change', renderList);
$('#list-table').addEventListener('click', (e) => {
  if (e.target.dataset.edit) editRecord(e.target.dataset.edit);
  if (e.target.dataset.del) deleteRecord(e.target.dataset.del);
});
$('#list-csv').addEventListener('click', () => {
  const rs = listRecords();
  const head = ['日付', '応援先', '現場名', '作業内容', '人工', '単価', '残業時間', '残業単価', '経費', '経費内容', '金額(税抜)', '作業員', '備考', '請求番号'];
  const rows = rs.map((r) => [r.date, clientName(r.clientId), r.site, r.work, r.workers, r.unitPrice, r.otHours, r.otRate, r.expense, r.expenseNote, amountOf(r), r.members, r.note, r.billed || '']);
  const csv = [head, ...rows].map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(`応援記録_${$('#list-month').value || '全期間'}.csv`, '﻿' + csv, 'text/csv');
});

// ===== 請求書 =====
function invoiceRecords() {
  const c = clientById($('#inv-client').value);
  if (!c) return { c: null, rs: [], p: null };
  const p = periodOf($('#inv-month').value || thisMonth(), c.closing);
  const rs = db.records.filter((r) => r.clientId === c.id && r.date >= p.from && r.date <= p.to)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { c, rs, p };
}
function defaultInvNo() {
  const m = ($('#inv-month').value || thisMonth()).replace('-', '');
  const idx = db.clients.findIndex((c) => c.id === $('#inv-client').value) + 1;
  return `${m}-${pad(idx)}`;
}
function setInvDefaults() {
  const { p } = invoiceRecords();
  $('#inv-no').value = defaultInvNo();
  $('#inv-date').value = p ? p.to : today();
}
function renderInvoice() {
  const box = $('#invoice');
  if (!db.clients.length) { box.innerHTML = '<p class="empty">「設定」で応援先を登録してください</p>'; return; }
  if (!$('#inv-no').value) setInvDefaults();
  const { c, rs, p } = invoiceRecords();
  $('#inv-period').textContent = `対象期間：${jpFullDate(p.from)} 〜 ${jpFullDate(p.to)}（${c.closing && c.closing !== '0' ? c.closing + '日締め' : '末締め'}）／ ${rs.length}件`;
  const co = db.company;
  const rate = num(co.taxRate);

  // 明細行：人工・残業・経費を分けて出す
  const lines = [];
  rs.forEach((r) => {
    const site = r.site ? `${r.site}　` : '';
    if (num(r.workers)) lines.push({ date: r.date, desc: `${site}${r.work}`, qty: r.workers, unit: '人工', price: r.unitPrice, amt: num(r.workers) * num(r.unitPrice) });
    if (num(r.otHours)) lines.push({ date: r.date, desc: `${site}残業`, qty: r.otHours, unit: '時間', price: r.otRate, amt: num(r.otHours) * num(r.otRate) });
    if (num(r.expense)) lines.push({ date: r.date, desc: `${site}${r.expenseNote || '経費'}`, qty: 1, unit: '式', price: r.expense, amt: num(r.expense) });
  });
  const sub = lines.reduce((s, l) => s + l.amt, 0);
  const tax = roundTax(sub * rate / 100);
  const total = sub + tax;
  const workers = rs.reduce((s, r) => s + num(r.workers), 0);
  const days = new Set(rs.map((r) => r.date)).size;

  const style = INVOICE_STYLES[co.invoiceStyle] ? co.invoiceStyle : 'standard';
  $('#inv-style').value = style;
  const d = {
    c, co, p, lines, sub, tax, total, rate, days, workers,
    no: $('#inv-no').value, date: jpFullDate($('#inv-date').value),
    subject: `${Number(($('#inv-month').value || thisMonth()).slice(5))}月分 型枠工事 応援`,
    period: `${jpFullDate(p.from)} 〜 ${jpFullDate(p.to)}`,
    blank: Math.max(0, 12 - lines.length),
  };
  box.className = 'invoice inv-' + style;
  box.innerHTML = INVOICE_STYLES[style].render(d);
}

// ===== 請求書のデザイン（3種類） =====
const fromLines = (co) => [
  co.zip ? `〒${esc(co.zip)}` : '', esc(co.address || ''),
  [co.tel ? `TEL ${esc(co.tel)}` : '', co.fax ? `FAX ${esc(co.fax)}` : ''].filter(Boolean).join('　'),
  co.regNo ? `登録番号 ${esc(co.regNo)}` : '',
].filter(Boolean).map((t) => `<div>${t}</div>`).join('');
// 角印（mm指定 → 請求書の幅760px＝A4の210mm換算）
function sealHtml(co) {
  if (!co.sealImage || co.sealOn === 'off') return '';
  const px = Math.round((num(co.sealSize) || 24) * 760 / 210);
  return `<img class="seal" src="${co.sealImage}" alt="" style="width:${px}px;height:${px}px">`;
}
const lineRows = (d, cols) => d.lines.map((l) => `<tr>${cols(l)}</tr>`).join('');
const bankText = (d) => esc(d.co.bank || '');

const INVOICE_STYLES = {
  // A：すっきりした標準的なデザイン
  standard: {
    label: 'A スタンダード',
    render: (d) => `
      <div class="a-top">
        <h1>請求書</h1>
        <table class="a-meta"><tr><th>請求日</th><td>${d.date}</td></tr><tr><th>請求番号</th><td>${esc(d.no)}</td></tr></table>
      </div>
      <div class="a-parties">
        <div class="a-to">
          <div class="a-toname">${esc(d.c.name)}<span>${esc(d.c.honor || '御中')}</span></div>
          ${d.c.address ? `<div class="a-small">${esc(d.c.address)}</div>` : ''}
          <p>下記の通りご請求申し上げます。</p>
          <dl class="a-dl"><dt>件名</dt><dd>${d.subject}</dd><dt>期間</dt><dd>${d.period}</dd><dt>実績</dt><dd>${d.days}日・延べ ${d.workers} 人工</dd></dl>
        </div>
        <div class="a-from">
          <div class="a-fromname">${esc(d.co.name || '（設定で自社名を入力）')}</div>
          ${d.co.rep ? `<div>${esc(d.co.rep)}</div>` : ''}
          ${fromLines(d.co)}
          ${sealHtml(d.co) || (d.co.sealOn === 'off' ? '' : '<div class="a-seal">印</div>')}
        </div>
      </div>
      <div class="a-total"><span>ご請求金額（税込）</span><strong>¥${yen(d.total)}</strong></div>
      <table class="a-lines">
        <thead><tr><th class="w-date">日付</th><th>内容</th><th class="w-qty">数量</th><th class="w-unit">単位</th><th class="w-price">単価</th><th class="w-amt">金額</th></tr></thead>
        <tbody>
          ${lineRows(d, (l) => `<td>${jpDate(l.date, true)}</td><td>${esc(l.desc)}</td><td class="num">${l.qty}</td><td class="c">${l.unit}</td><td class="num">${yen(l.price)}</td><td class="num">${yen(l.amt)}</td>`)}
          ${'<tr class="blank"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(d.blank)}
        </tbody>
      </table>
      <div class="a-bottom">
        <div class="a-bank">${d.co.bank ? `<div class="a-label">お振込先</div><div class="pre">${bankText(d)}</div>` : ''}${d.c.payTerms ? `<div class="a-label">お支払条件</div><div>${esc(d.c.payTerms)}</div>` : ''}</div>
        <table class="a-sum">
          <tr><th>小計（${d.rate}%対象）</th><td>¥${yen(d.sub)}</td></tr>
          <tr><th>消費税（${d.rate}%）</th><td>¥${yen(d.tax)}</td></tr>
          <tr class="grand"><th>合計</th><td>¥${yen(d.total)}</td></tr>
        </table>
      </div>
      <p class="a-note">恐れ入りますが、振込手数料は貴社にてご負担くださいますようお願い申し上げます。</p>`,
  },

  // B：色を使った見やすいデザイン
  modern: {
    label: 'B モダン',
    render: (d) => `
      <div class="b-band">
        <div><div class="b-en">INVOICE</div><h1>請求書</h1></div>
        <div class="b-meta"><div><span>請求日</span>${d.date}</div><div><span>請求番号</span>${esc(d.no)}</div></div>
      </div>
      <div class="b-cards">
        <div class="b-card">
          <div class="b-label">ご請求先</div>
          <div class="b-toname">${esc(d.c.name)} ${esc(d.c.honor || '御中')}</div>
          ${d.c.address ? `<div class="b-small">${esc(d.c.address)}</div>` : ''}
          <div class="b-subject">${d.subject}</div>
          <div class="b-small">${d.period}　${d.days}日・延べ ${d.workers} 人工</div>
        </div>
        <div class="b-card b-fromcard">
          <div class="b-label">ご請求元</div>
          <div class="b-fromname">${esc(d.co.name || '（設定で自社名を入力）')}</div>
          ${d.co.rep ? `<div class="b-small">${esc(d.co.rep)}</div>` : ''}
          <div class="b-small">${fromLines(d.co)}</div>
          ${sealHtml(d.co)}
        </div>
      </div>
      <div class="b-total">
        <div><div class="b-label light">ご請求金額（税込）</div><div class="b-amount">¥${yen(d.total)}</div></div>
        <div class="b-breakdown"><div>小計 ¥${yen(d.sub)}</div><div>消費税 ¥${yen(d.tax)}</div></div>
      </div>
      <table class="b-lines">
        <thead><tr><th class="w-date">日付</th><th>内容</th><th class="w-qty num">数量</th><th class="w-price num">単価</th><th class="w-amt num">金額</th></tr></thead>
        <tbody>${lineRows(d, (l) => `<td>${jpDate(l.date, true)}</td><td>${esc(l.desc)}</td><td class="num">${l.qty}<small>${l.unit}</small></td><td class="num">${yen(l.price)}</td><td class="num">${yen(l.amt)}</td>`)}</tbody>
      </table>
      <div class="b-sumwrap"><table class="b-sum">
        <tr><th>小計（${d.rate}%対象）</th><td>¥${yen(d.sub)}</td></tr>
        <tr><th>消費税（${d.rate}%）</th><td>¥${yen(d.tax)}</td></tr>
        <tr class="grand"><th>合計</th><td>¥${yen(d.total)}</td></tr>
      </table></div>
      <div class="b-foot">
        ${d.co.bank ? `<div><div class="b-label">お振込先</div><div class="pre">${bankText(d)}</div></div>` : ''}
        <div>${d.c.payTerms ? `<div class="b-label">お支払条件</div><div>${esc(d.c.payTerms)}</div>` : ''}<div class="b-small">振込手数料は貴社にてご負担願います。</div></div>
      </div>`,
  },

  // C：明朝体・罫線の伝統的なデザイン
  classic: {
    label: 'C 和風・伝統',
    render: (d) => `
      <div class="c-meta">No. ${esc(d.no)}<br>${d.date}</div>
      <h1>御 請 求 書</h1>
      <div class="c-parties">
        <div class="c-to">
          <div class="c-toname">${esc(d.c.name)}　${esc(d.c.honor || '御中')}</div>
          <p>毎度格別のお引き立てを賜り厚く御礼申し上げます。<br>下記の通り御請求申し上げます。</p>
          <table class="c-info"><tr><th>件　名</th><td>${d.subject}</td></tr><tr><th>期　間</th><td>${d.period}</td></tr><tr><th>実　績</th><td>${d.days}日　延べ ${d.workers} 人工</td></tr></table>
        </div>
        <div class="c-from">
          <div class="c-fromname">${esc(d.co.name || '（設定で自社名を入力）')}</div>
          ${d.co.rep ? `<div>${esc(d.co.rep)}</div>` : ''}
          ${fromLines(d.co)}
          ${sealHtml(d.co)}
          <table class="c-stamps"><tr><th>担当</th><th>確認</th></tr><tr><td></td><td></td></tr></table>
        </div>
      </div>
      <div class="c-total"><span>御請求金額</span><strong>金 ${yen(d.total)} 円也</strong><small>（消費税込）</small></div>
      <table class="c-lines">
        <thead><tr><th class="w-date">月日</th><th>摘　要</th><th class="w-qty">数量</th><th class="w-unit">単位</th><th class="w-price">単　価</th><th class="w-amt">金　額</th></tr></thead>
        <tbody>
          ${lineRows(d, (l) => `<td class="c">${jpDate(l.date)}</td><td>${esc(l.desc)}</td><td class="num">${l.qty}</td><td class="c">${l.unit}</td><td class="num">${yen(l.price)}</td><td class="num">${yen(l.amt)}</td>`)}
          ${'<tr class="blank"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(d.blank)}
        </tbody>
        <tfoot>
          <tr><td colspan="4" rowspan="3" class="c-bank">${d.co.bank ? `【御振込先】<div class="pre">${bankText(d)}</div>` : ''}${d.c.payTerms ? `【御支払条件】${esc(d.c.payTerms)}` : ''}</td><th>小計（${d.rate}%対象）</th><td class="num">${yen(d.sub)}</td></tr>
          <tr><th>消費税（${d.rate}%）</th><td class="num">${yen(d.tax)}</td></tr>
          <tr class="grand"><th>合　計</th><td class="num">${yen(d.total)}</td></tr>
        </tfoot>
      </table>
      <p class="c-note">※振込手数料は貴社にて御負担下さいますよう御願い申し上げます。</p>`,
  },
};
$('#inv-style').innerHTML = Object.entries(INVOICE_STYLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('#inv-style').addEventListener('change', () => {
  db.company.invoiceStyle = $('#inv-style').value;
  commit([{ op: 'setCompany', data: db.company }]);
  renderInvoice();
});
['#inv-month', '#inv-client'].forEach((s) => $(s).addEventListener('change', () => { setInvDefaults(); renderInvoice(); }));
['#inv-date', '#inv-no'].forEach((s) => $(s).addEventListener('input', renderInvoice));
$('#inv-print').addEventListener('click', () => {
  const { c, p } = invoiceRecords();
  const old = document.title;
  if (c) document.title = `請求書_${c.name}_${p.to.slice(0, 7)}`;
  window.print();
  document.title = old;
});
$('#inv-mark').addEventListener('click', () => {
  const { rs } = invoiceRecords();
  if (!rs.length) { toast('対象の記録がありません'); return; }
  const no = $('#inv-no').value;
  if (!confirm(`${rs.length}件の記録を請求番号「${no}」で請求済みにしますか？`)) return;
  rs.forEach((r) => { r.billed = no; });
  commit(rs.map((r) => ({ op: 'upsertRecord', data: r }))); renderInvoice(); toast('請求済みにしました');
});

// ===== 設定 =====
const cf = $('#company-form');
function fillCompany() {
  for (const el of cf.elements) if (el.name) el.value = db.company[el.name] ?? el.value;
  renderSealPreview();
}
function renderSealPreview() {
  const src = db.company.sealImage;
  $('#seal-preview').innerHTML = src ? `<img src="${src}" alt="登録した角印">` : '<span>未登録</span>';
  $('#seal-clear').classList.toggle('hidden', !src);
}
function saveSeal(dataUrl) {
  db.company.sealImage = dataUrl;
  cf.sealImage.value = dataUrl;
  commit([{ op: 'setCompany', data: db.company }]);
  renderSealPreview();
}

// 写真の印影を「背景透明・朱色・余白なし」の画像にする
async function makeSealImage(file) {
  const img = await new Promise((ok, ng) => {
    const im = new Image(); im.onload = () => ok(im); im.onerror = () => ng(new Error('画像を読み込めませんでした'));
    im.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, 700 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  const px = g.getImageData(0, 0, w, h); const a = px.data;
  const n = w * h;
  // 赤み（R が G・B よりどれだけ強いか）で印を探す。影や紙の色むらに強い
  const red = new Int16Array(n);
  for (let i = 0; i < n; i++) red[i] = a[i * 4] - (a[i * 4 + 1] + a[i * 4 + 2]) / 2;
  const redCount = red.reduce((k, v) => k + (v > 60 ? 1 : 0), 0);
  let strength;
  if (redCount > n * 0.002) {
    const peak = Array.from(red).sort((x, y) => x - y)[Math.floor(n * 0.998)];
    const lo = 28, hi = Math.max(lo + 30, peak * 0.65);
    strength = (i) => (red[i] - lo) / (hi - lo);
  } else {
    // 赤くない印（黒・青など）：周りの明るさとの差で判定（影があっても大丈夫なように場所ごとに比べる）
    const small = document.createElement('canvas'); small.width = 24; small.height = 24;
    small.getContext('2d').drawImage(cv, 0, 0, 24, 24);
    const big = document.createElement('canvas'); big.width = w; big.height = h;
    const bg2 = big.getContext('2d'); bg2.imageSmoothingEnabled = true; bg2.filter = 'blur(8px)'; bg2.drawImage(small, 0, 0, w, h);
    const bgd = bg2.getImageData(0, 0, w, h).data;
    strength = (i) => {
      const l = a[i * 4] * 0.3 + a[i * 4 + 1] * 0.59 + a[i * 4 + 2] * 0.11;
      const bl = bgd[i * 4] * 0.3 + bgd[i * 4 + 1] * 0.59 + bgd[i * 4 + 2] * 0.11;
      return (bl - l - 25) / 60;
    };
  }
  const rowCnt = new Uint32Array(h), colCnt = new Uint32Array(w);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, strength(i)));
    // 濃さを段階的にそろえて、画像を小さく保存できるようにする
    let alpha = Math.round(t * (a[i * 4 + 3] / 255) * 8) * 32; if (alpha > 255) alpha = 255;
    a[i * 4] = 205; a[i * 4 + 1] = 32; a[i * 4 + 2] = 38; a[i * 4 + 3] = alpha;
    if (alpha > 90) { rowCnt[(i / w) | 0]++; colCnt[i % w]++; }
  }
  // ゴミ（点）を無視して、印のある範囲を求める
  const minHit = Math.max(2, Math.round(Math.min(w, h) * 0.004));
  let minX = colCnt.findIndex((v) => v >= minHit), maxX = w - 1 - Array.from(colCnt).reverse().findIndex((v) => v >= minHit);
  let minY = rowCnt.findIndex((v) => v >= minHit), maxY = h - 1 - Array.from(rowCnt).reverse().findIndex((v) => v >= minHit);
  if (minX < 0 || minY < 0) maxX = -1;
  if (maxX >= 0) {
    // 範囲の外は完全に透明にする
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < minX || x > maxX || y < minY || y > maxY) a[(y * w + x) * 4 + 3] = 0;
  }
  if (maxX < 0) throw new Error('印が見つかりませんでした。白い紙に押した印を明るい場所で撮ってください');
  g.putImageData(px, 0, 0);

  // 傾きを自動で直す：印の枠や文字の線が縦横にそろう角度（±10°）を探す
  const pts = [];
  const step = Math.max(1, Math.round(Math.sqrt(((maxX - minX + 1) * (maxY - minY + 1)) / 60000)));
  for (let y = minY; y <= maxY; y += step) for (let x = minX; x <= maxX; x += step) if (a[(y * w + x) * 4 + 3] >= 128) pts.push(x, y);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const scoreAt = (deg) => {
    const r = deg * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
    const off = Math.ceil(Math.hypot(w, h)), hx = new Uint32Array(off * 2), hy = new Uint32Array(off * 2);
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - cx, dy = pts[i + 1] - cy;
      hx[(Math.round((dx * co + dy * si) / step) + off) | 0]++; hy[(Math.round((-dx * si + dy * co) / step) + off) | 0]++;
    }
    let sc = 0; for (let i = 0; i < hx.length; i++) sc += hx[i] * hx[i] + hy[i] * hy[i];
    return sc;
  };
  let best = 0, bestScore = scoreAt(0);
  for (let d = -10; d <= 10; d += 0.5) { const sc = scoreAt(d); if (sc > bestScore) { bestScore = sc; best = d; } }
  for (let d = best - 0.5; d <= best + 0.5; d += 0.1) { const sc = scoreAt(d); if (sc > bestScore) { bestScore = sc; best = d; } }
  let src = cv;
  if (Math.abs(best) >= 0.2) {
    src = document.createElement('canvas'); src.width = w; src.height = h;
    const sg = src.getContext('2d');
    sg.translate(cx, cy); sg.rotate(-best * Math.PI / 180); sg.translate(-cx, -cy); sg.drawImage(cv, 0, 0);
    // 回したあとの範囲を求め直す
    const rd = sg.getImageData(0, 0, w, h).data;
    const rc = new Uint32Array(h), cc = new Uint32Array(w);
    for (let i = 0; i < n; i++) if (rd[i * 4 + 3] > 90) { rc[(i / w) | 0]++; cc[i % w]++; }
    minX = cc.findIndex((v) => v >= minHit); maxX = w - 1 - Array.from(cc).reverse().findIndex((v) => v >= minHit);
    minY = rc.findIndex((v) => v >= minHit); maxY = h - 1 - Array.from(rc).reverse().findIndex((v) => v >= minHit);
  }
  makeSealImage.lastAngle = best;

  // 余白を詰めて正方形に配置（スプレッドシートに保存できる大きさまで縮める）
  const bw = maxX - minX + 1, bh = maxY - minY + 1, side = Math.max(bw, bh);
  for (const size of [300, 240, 190, 150]) {
    const out = document.createElement('canvas'); out.width = out.height = size;
    const k = (size * 0.96) / side;
    out.getContext('2d').drawImage(src, minX, minY, bw, bh, (size - bw * k) / 2, (size - bh * k) / 2, bw * k, bh * k);
    const og = out.getContext('2d'); const od = og.getImageData(0, 0, size, size);
    for (let i = 3; i < od.data.length; i += 4) { const v = od.data[i]; od.data[i] = v < 40 ? 0 : Math.min(255, Math.round(v / 64) * 64); }
    og.putImageData(od, 0, 0);
    const url = out.toDataURL('image/png');
    if (url.length < 45000) return url;
  }
  throw new Error('画像が細かすぎて保存できません。印のまわりだけに切り抜いてから選んでください');
}
$('#seal-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { saveSeal(await makeSealImage(f)); toast('角印を登録しました'); }
  catch (err) { alert(err.message); }
});
$('#seal-clear').addEventListener('click', () => {
  if (!confirm('登録した角印の画像を削除しますか？')) return;
  saveSeal(''); toast('角印を削除しました');
});
cf.addEventListener('submit', (e) => {
  e.preventDefault();
  db.company = Object.assign({}, db.company, Object.fromEntries(new FormData(cf)));
  commit([{ op: 'setCompany', data: db.company }]); renderInvoice(); toast('自社情報を保存しました');
});

const clf = $('#client-form');
function resetClient() { clf.reset(); clf.id.value = ''; $('#client-cancel').classList.add('hidden'); }
clf.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(clf));
  const c = { ...f, id: f.id || uid(), name: f.name.trim(), unitPrice: num(f.unitPrice), otRate: num(f.otRate) };
  const i = db.clients.findIndex((x) => x.id === c.id);
  if (i >= 0) db.clients[i] = c; else db.clients.push(c);
  commit([{ op: 'upsertClient', data: c }]); resetClient(); renderClients(); refreshSelects();
  if (!ef.id.value) { if (!ef.clientId.value) ef.clientId.value = c.id; applyClientDefaults(); updateEntryAmount(); }
  toast('応援先を保存しました');
});
$('#client-cancel').addEventListener('click', resetClient);
function renderClients() {
  $('#client-list').innerHTML = db.clients.map((c) => `
    <div class="card"><div class="row">
      <div><strong>${esc(c.name)}</strong>
        <div class="sub">${Number(c.closing) ? c.closing + '日締め' : '末締め'} ／ 単価 ${yen(c.unitPrice)}円 ／ 残業 ${yen(c.otRate)}円/h${c.payTerms ? ' ／ ' + esc(c.payTerms) : ''}</div></div>
      <div><button class="small" data-cedit="${c.id}">編集</button> <button class="small danger" data-cdel="${c.id}">削除</button></div>
    </div></div>`).join('') || '<p class="empty">応援先が未登録です</p>';
}
$('#client-list').addEventListener('click', (e) => {
  const { cedit, cdel } = e.target.dataset;
  if (cedit) {
    const c = clientById(cedit);
    for (const el of clf.elements) if (el.name) el.value = c[el.name] ?? '';
    $('#client-cancel').classList.remove('hidden');
    clf.scrollIntoView({ behavior: 'smooth' });
  }
  if (cdel) {
    const n = db.records.filter((r) => r.clientId === cdel).length;
    if (n) { alert(`この応援先には${n}件の記録があるため削除できません`); return; }
    if (!confirm('削除しますか？')) return;
    db.clients = db.clients.filter((c) => c.id !== cdel);
    commit([{ op: 'deleteClient', id: cdel }]); renderClients(); refreshSelects();
  }
});

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#backup').addEventListener('click', () => download(`応援管理_バックアップ_${today()}.json`, JSON.stringify(db, null, 1), 'application/json'));
$('#restore').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.records) || !Array.isArray(d.clients)) throw new Error();
    if (!confirm(`記録${d.records.length}件・応援先${d.clients.length}件で今のデータを置き換えますか？`)) return;
    db = Object.assign(empty(), d); commit([{ op: 'replaceAll', data: db }]); init(); toast('復元しました');
  } catch (err) { alert('バックアップファイルを読み込めませんでした'); }
  e.target.value = '';
});

// ===== 起動 =====
function init() {
  refreshSelects(); fillCompany(); renderClients(); resetEntry(); renderRecent();
  $('#list-month').value = thisMonth();
  $('#inv-month').value = thisMonth();
  $('#inv-no').value = '';
  showTab(!db.clients.length && !syncOn() ? 'settings' : 'entry');
}

// 他の端末の変更を取り込んだ時、入力中の内容は残したまま画面を描き直す
function rerenderAll() {
  refreshSelects(); renderClients(); renderRecent();
  if (!cf.contains(document.activeElement)) fillCompany();
  if (!ef.id.value && !entryDirty) resetEntry();
  if ($('#tab-list').classList.contains('active')) renderList();
  if ($('#tab-invoice').classList.contains('active')) renderInvoice();
}

// ===== Googleスプレッドシート連携 =====
const SYNC_KEY = 'ouen-sync-v1';
const OUTBOX_KEY = 'ouen-outbox-v1';
let sync = readLS(SYNC_KEY, {});           // { url, key, linked }
let outbox = readLS(OUTBOX_KEY, []);       // まだ送れていない変更
let syncState = 'idle';                    // idle | busy | error
let syncError = '';
let flushing = false;

function readLS(k, def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; } }
function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても続行 */ } }
const syncOn = () => !!(sync.url && sync.key && sync.linked);

// データを変更した時はここを通す：端末に保存し、連携中ならスプレッドシートにも送る
function commit(ops) {
  save();
  if (!syncOn()) return;
  outbox.push(...JSON.parse(JSON.stringify(ops)));
  writeLS(OUTBOX_KEY, outbox);
  flush();
}

async function api(method, payload) {
  let res;
  try {
  if (method === 'GET') {
    res = await fetch(`${sync.url}?action=load&key=${encodeURIComponent(sync.key)}`, { redirect: 'follow' });
  } else {
    // text/plain で送ると Google 側で受け取れる（事前確認の通信が不要になる）
    res = await fetch(sync.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: sync.key, ops: payload }) });
  }
  } catch (e) { throw new Error('ネットにつながっていません'); }
  let out;
  try { out = await res.json(); } catch (e) { throw new Error('スプレッドシートから正しい返事がありません。URLとデプロイ設定（アクセスできるユーザー：全員）を確認してください'); }
  if (!out.ok) throw new Error(out.error || '不明なエラー');
  return out.data;
}

function applyServer(d) {
  db = Object.assign(empty(), { company: Object.assign({ taxRate: 10, rounding: 'floor' }, d.company || {}), clients: d.clients || [], records: d.records || [] });
  save(); rerenderAll();
}

async function flush() {
  if (flushing || !syncOn()) return;
  flushing = true; setSync('busy');
  try {
    while (outbox.length) {
      const batch = outbox.slice(0, 300);
      const data = await api('POST', batch);
      outbox.splice(0, batch.length); writeLS(OUTBOX_KEY, outbox);
      if (!outbox.length) applyServer(data);
    }
    setSync('idle');
  } catch (e) {
    setSync('error', e.message);
  } finally { flushing = false; }
}

async function pull() {
  if (!syncOn() || flushing) return;
  if (outbox.length) return flush();
  setSync('busy');
  try { applyServer(await api('GET')); setSync('idle'); } catch (e) { setSync('error', e.message); }
}

function setSync(state, msg) {
  syncState = state; syncError = msg || '';
  const el = $('#sync-state');
  const n = outbox.length;
  let text = '', cls = '';
  if (!syncOn()) { text = 'この端末のみ'; cls = 'local'; }
  else if (state === 'busy') { text = '同期中…'; }
  else if (state === 'error') { text = n ? `未送信 ${n}件` : '同期できません'; cls = 'warn'; }
  else { text = n ? `未送信 ${n}件` : '同期済み'; cls = n ? 'warn' : 'ok'; }
  el.textContent = text; el.className = 'sync ' + cls;
  el.title = syncError;
  renderSyncPanel();
}

function renderSyncPanel() {
  const on = syncOn();
  $('#sync-on').classList.toggle('hidden', !on);
  $('#sync-off').classList.toggle('hidden', on);
  $('#sync-form').classList.toggle('hidden', on);
  if (on) $('#link-text').value = makeConnectLink(sync.url, sync.key);
  if (on) {
    $('#sync-status').textContent = syncState === 'error'
      ? `つながりませんでした：${syncError}${outbox.length ? `（未送信の変更 ${outbox.length}件は、つながった時に送ります）` : ''}`
      : outbox.length ? `未送信の変更が ${outbox.length}件あります` : 'スプレッドシートとつながっています。どの端末で入力しても同じデータになります。';
    $('#sync-status').className = 'hint' + (syncState === 'error' ? ' warn-text' : '');
  }
}

// 接続用リンク：URLと合言葉を1本のリンクにまとめる（# 以降はサーバーに送られない）
function makeConnectLink(url, key) {
  const code = btoa(unescape(encodeURIComponent(JSON.stringify({ u: url, k: key })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#connect=${code}`;
}
function parseConnectLink(text) {
  const m = String(text || '').match(/#connect=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(decodeURIComponent(escape(atob(b + '='.repeat((4 - b.length % 4) % 4)))));
    return o && o.u && o.k ? { url: o.u, key: o.k } : null;
  } catch (e) { return null; }
}

async function connectSync(url, key) {
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) { alert('URLは「https://script.google.com/」で始まり「/exec」で終わるもの（または接続用リンク）を貼り付けてください'); return false; }
  if (!key) { alert('合言葉を入力してください'); return false; }
  const btn = $('#sync-connect'); btn.disabled = true; btn.textContent = '接続中…';
  const prev = sync;
  sync = { url, key, linked: false };
  try {
    const server = await api('GET');
    // 初めてつなぐ時：この端末にしかないデータもスプレッドシートに送る（同じIDはスプレッドシート側を優先）
    const ops = [];
    const sIds = new Set(server.records.map((r) => r.id));
    const cIds = new Set(server.clients.map((c) => c.id));
    db.clients.filter((c) => !cIds.has(c.id)).forEach((c) => { ops.push({ op: 'upsertClient', data: c }); server.clients.push(c); });
    db.records.filter((r) => !sIds.has(r.id)).forEach((r) => { ops.push({ op: 'upsertRecord', data: r }); server.records.push(r); });
    if (!(server.company && server.company.name) && db.company.name) { ops.push({ op: 'setCompany', data: db.company }); server.company = db.company; }
    sync.linked = true; writeLS(SYNC_KEY, sync);
    outbox = ops; writeLS(OUTBOX_KEY, outbox);
    $('#sync-url').value = url; $('#sync-pass').value = key;
    applyServer(server);
    await flush();
    toast('スプレッドシートとつながりました');
    if (db.clients.length) showTab('entry');
    return true;
  } catch (err) {
    sync = prev;
    alert('つながりませんでした：' + err.message);
    return false;
  } finally {
    btn.disabled = false; btn.textContent = '接続する'; setSync(syncState);
  }
}
$('#sync-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('#sync-url').value.trim();
  const link = parseConnectLink(raw);
  if (link) connectSync(link.url, link.key);
  else connectSync(raw, $('#sync-pass').value.trim());
});
// URL欄に接続用リンクを貼り付けたら、合言葉も自動で入れる
$('#sync-url').addEventListener('input', () => {
  const link = parseConnectLink($('#sync-url').value);
  if (link) { $('#sync-url').value = link.url; $('#sync-pass').value = link.key; toast('接続用リンクを読み取りました。「接続する」を押してください'); }
});
$('#link-copy').addEventListener('click', async () => {
  const t = $('#link-text');
  try { await navigator.clipboard.writeText(t.value); toast('接続用リンクをコピーしました'); }
  catch (e) { t.focus(); t.select(); toast('選択しました。コピーしてください'); }
});
$('#sync-now').addEventListener('click', () => pull());
$('#sync-disconnect').addEventListener('click', () => {
  if (outbox.length && !confirm(`まだ送れていない変更が${outbox.length}件あります。連携を解除すると、その変更はスプレッドシートに送られません。解除しますか？`)) return;
  if (!outbox.length && !confirm('この端末のスプレッドシート連携を解除しますか？（データはこの端末とスプレッドシートの両方に残ります）')) return;
  sync = {}; outbox = []; writeLS(SYNC_KEY, sync); writeLS(OUTBOX_KEY, outbox);
  setSync('idle'); toast('連携を解除しました');
});
$('#gas-copy').addEventListener('click', async () => {
  const ta = $('#gas-code');
  try { await navigator.clipboard.writeText(ta.value); toast('コピーしました'); }
  catch (e) { ta.focus(); ta.select(); toast('選択しました。コピーしてください'); }
});
fetch('gas/Code.gs').then((r) => r.ok ? r.text() : Promise.reject()).then((t) => { $('#gas-code').value = t; })
  .catch(() => { $('#gas-code').value = '（読み込めませんでした。GitHub の gas/Code.gs を開いてコピーしてください）'; });

// 画面に戻ってきた時・電波が戻った時・定期的に最新を取り込む
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
window.addEventListener('online', () => pull());
setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 60000);

init();
if (sync.url) { $('#sync-url').value = sync.url; $('#sync-pass').value = sync.key || ''; }
setSync('idle');
const linkInUrl = parseConnectLink(location.hash);
if (linkInUrl) {
  // 接続用リンクから開いた：アドレス欄から合言葉を消してから接続
  history.replaceState(null, '', location.pathname + location.search);
  if (syncOn() && sync.url === linkInUrl.url && sync.key === linkInUrl.key) { toast('すでにつながっています'); pull(); }
  else connectSync(linkInUrl.url, linkInUrl.key);
} else {
  pull();
}
