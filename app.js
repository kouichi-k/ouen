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
function resetEntry() {
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
ef.addEventListener('input', updateEntryAmount);
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
  save(); refreshSelects();
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
  save(); renderList(); renderRecent(); toast('削除しました');
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
  const minRows = 15;
  const blank = Math.max(0, minRows - lines.length);

  box.innerHTML = `
    <h1>請求書</h1>
    <div class="inv-meta">請求番号：${esc($('#inv-no').value)}<br>請求日：${jpFullDate($('#inv-date').value)}</div>
    <div class="inv-head">
      <div class="inv-to">
        <div class="name">${esc(c.name)}　${esc(c.honor || '御中')}</div>
        ${c.address ? `<div>${esc(c.address)}</div>` : ''}
        <p>下記の通りご請求申し上げます。</p>
        <div>件名：${Number($('#inv-month').value.slice(5))}月分 型枠工事 応援</div>
        <div>期間：${jpFullDate(p.from)} 〜 ${jpFullDate(p.to)}（${days}日・延べ${workers}人工）</div>
        <div class="inv-total"><span>ご請求金額（税込）</span><span><strong>¥${yen(total)}-</strong></span></div>
      </div>
      <div class="inv-from">
        <div class="name">${esc(co.name || '（設定で自社名を入力）')}</div>
        ${co.rep ? `<div>${esc(co.rep)}</div>` : ''}
        ${co.zip ? `<div>〒${esc(co.zip)}</div>` : ''}
        ${co.address ? `<div>${esc(co.address)}</div>` : ''}
        ${co.tel ? `<div>TEL ${esc(co.tel)}</div>` : ''}
        ${co.fax ? `<div>FAX ${esc(co.fax)}</div>` : ''}
        ${co.regNo ? `<div>登録番号 ${esc(co.regNo)}</div>` : ''}
      </div>
    </div>
    <table>
      <thead><tr><th style="width:12%">日付</th><th>内容</th><th style="width:9%">数量</th><th style="width:7%">単位</th><th style="width:13%">単価</th><th style="width:15%">金額</th></tr></thead>
      <tbody>
        ${lines.map((l) => `<tr><td>${jpDate(l.date, true)}</td><td>${esc(l.desc)}</td><td class="num">${l.qty}</td><td>${l.unit}</td><td class="num">${yen(l.price)}</td><td class="num">${yen(l.amt)}</td></tr>`).join('')}
        ${'<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(blank)}
      </tbody>
    </table>
    <table class="inv-sum">
      <tr><td>小計（${rate}%対象）</td><td class="num">${yen(sub)}</td></tr>
      <tr><td>消費税（${rate}%）</td><td class="num">${yen(tax)}</td></tr>
      <tr><td><strong>合計</strong></td><td class="num"><strong>${yen(total)}</strong></td></tr>
    </table>
    <div class="inv-bottom">${c.payTerms ? `お支払条件：${esc(c.payTerms)}\n` : ''}${co.bank ? `お振込先：\n${esc(co.bank)}\n恐れ入りますが、振込手数料は貴社にてご負担願います。` : ''}</div>
  `;
}
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
  save(); toast('請求済みにしました');
});

// ===== 設定 =====
const cf = $('#company-form');
function fillCompany() {
  for (const el of cf.elements) if (el.name) el.value = db.company[el.name] ?? el.value;
}
cf.addEventListener('submit', (e) => {
  e.preventDefault();
  db.company = Object.fromEntries(new FormData(cf));
  save(); toast('自社情報を保存しました');
});

const clf = $('#client-form');
function resetClient() { clf.reset(); clf.id.value = ''; $('#client-cancel').classList.add('hidden'); }
clf.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(clf));
  const c = { ...f, id: f.id || uid(), name: f.name.trim(), unitPrice: num(f.unitPrice), otRate: num(f.otRate) };
  const i = db.clients.findIndex((x) => x.id === c.id);
  if (i >= 0) db.clients[i] = c; else db.clients.push(c);
  save(); resetClient(); renderClients(); refreshSelects();
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
    save(); renderClients(); refreshSelects();
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
    db = Object.assign(empty(), d); save(); init(); toast('復元しました');
  } catch (err) { alert('バックアップファイルを読み込めませんでした'); }
  e.target.value = '';
});

// ===== 起動 =====
function init() {
  refreshSelects(); fillCompany(); renderClients(); resetEntry(); renderRecent();
  $('#list-month').value = thisMonth();
  $('#inv-month').value = thisMonth();
  $('#inv-no').value = '';
  if (!db.clients.length) showTab('settings');
}
init();
