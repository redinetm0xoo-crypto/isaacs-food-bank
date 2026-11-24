// Food Bank Manager – Friends of Isaac's Food Bank
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot,
  writeBatch, increment, serverTimestamp, query, orderBy, limit, startAfter, getDocs, getDoc, setDoc, addDoc, deleteDoc, updateDoc, where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { FIREBASE_CONFIG } from './firebase-config.js?v=1.2';
import { APP_VERSION, VERSION_HISTORY, DEFAULT_LOCATIONS, TYPES, OUT_REASONS } from './data.js?v=1.2';

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${+d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${y}`; };
const num = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'loc';
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms); }
let modalLocked = false;
function modal(html, { locked = false } = {}) { modalLocked = locked; $('#modalX').hidden = locked; $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); return $('#modalBody'); }
function closeModal() { modalLocked = false; $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }
$('#modalX').onclick = closeModal;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && !modalLocked) closeModal(); });

// ---------- state ----------
const S = {
  items: {},        // name -> {a:true}
  locs: {},         // name -> {kind, site, addr, a, o}
  stock: {},        // loc -> {item: qty}
  donors: {},       // name -> count
  ready: { items: false, locs: false, stock: false },
  view: { loc: 'all', q: '', hideZero: true, sort: 'item', dir: 1 },
  name: localStorage.getItem('fbm.name') || '',
  role: localStorage.getItem('fbm.role') || '',   // 'simon' | 'mgr' (temporary until logins)
  bank: localStorage.getItem('fbm.bank') || '',   // food bank manager's default food bank
  lists: [],
  users: {},       // uid -> {name, role, bank, first, seen}
  emergency: [],   // [{name, role, phone, email, notes}]
  showDone: localStorage.getItem('fbm.showDone') !== '0',
};
const itemNames = () => Object.keys(S.items).filter(n => S.items[n].a !== false).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
const kindOrder = { store: 0, bank: 1, other: 2, donation: 3 };
const locNames = (all = false) => Object.keys(S.locs).filter(n => all || S.locs[n].a !== false)
  .sort((a, b) => (kindOrder[S.locs[a].kind] ?? 3) - (kindOrder[S.locs[b].kind] ?? 3) || (S.locs[a].o ?? 99) - (S.locs[b].o ?? 99) || a.localeCompare(b));
const qty = (loc, item) => num(S.stock[loc]?.[item] || 0);
const storeNames = () => locNames().filter(n => S.locs[n].kind === 'store');
const bankNames = () => locNames().filter(n => S.locs[n].kind === 'bank');
const locLabel = n => S.locs[n]?.site && S.locs[n].site.toLowerCase() !== n.toLowerCase() ? `${n} – ${S.locs[n].site}` : n;

// ---------- firebase ----------
$('#ver').textContent = APP_VERSION;
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
let uid = null;

function setConn() {
  const c = $('#conn');
  if (!navigator.onLine) { c.textContent = 'Offline – changes will sync'; c.className = 'conn off'; }
  else if (!uid) { c.textContent = 'Connecting…'; c.className = 'conn'; }
  else { c.textContent = 'Online'; c.className = 'conn'; }
}
addEventListener('online', setConn); addEventListener('offline', setConn);
setConn();
onAuthStateChanged(auth, u => { uid = u?.uid || null; setConn(); if (u) startListeners(); });
signInAnonymously(auth).catch(e => { $('#conn').textContent = 'Sign-in failed'; $('#conn').className = 'conn off'; console.error(e); });

let listening = false;
function startListeners() {
  if (listening) return; listening = true;
  onSnapshot(doc(db, 'config', 'items'), s => { S.items = s.data()?.i || {}; S.ready.items = true; refresh(); });
  onSnapshot(doc(db, 'config', 'locations'), s => { S.locs = s.data()?.l || {}; S.ready.locs = true; refresh(); });
  onSnapshot(doc(db, 'config', 'donors'), s => { S.donors = s.data()?.d || {}; refreshDonors(); });
  onSnapshot(collection(db, 'users'), qs => { const u = {}; qs.forEach(d => { u[d.id] = d.data(); }); S.users = u; if (current === 'setup') renderSetup(); });
  onSnapshot(doc(db, 'config', 'emergency'), s => { S.emergency = s.data()?.c || []; renderEmergency(); if (current === 'setup') renderSetup(); });
  onSnapshot(collection(db, 'lists'), qs => { S.lists = qs.docs.map(d => ({ id: d.id, ...d.data() })); S.ready.lists = true; renderBank(); renderRequests(); renderMyTakes(); });
  onSnapshot(collection(db, 'stock'), qs => { const st = {}; qs.forEach(d => { const v = d.data(); st[v.loc] = v.q || {}; }); S.stock = st; S.ready.stock = true; refresh(); });
}

// ---------- booking ----------
// lines: [{l: location, i: item, q: signed quantity}]
function addMovement(b, { type, note, date, lines, extra = {} }) {
  lines = lines.filter(x => x.q);
  if (!lines.length) throw new Error('Nothing to book.');
  const mref = doc(collection(db, 'movements'));
  b.set(mref, { date, type, note: note || '', lines, locs: [...new Set(lines.map(x => x.l))], by: S.name || '', uid, created: serverTimestamp(), ...extra });
  applyStock(b, lines, 1);
  // new items go into the item list automatically
  const newItems = [...new Set(lines.map(x => x.i))].filter(i => !S.items[i]);
  if (newItems.length) b.set(doc(db, 'config', 'items'), { i: Object.fromEntries(newItems.map(n => [n, { a: true }])) }, { merge: true });
  return mref.id;
}
// one booking, plus anything else that must be saved in the same write (also(batch, id))
async function book(m, also) { const b = writeBatch(db); const id = addMovement(b, m); if (also) also(b, id); await b.commit(); return id; }
function applyStock(b, lines, sign) {
  const per = {};
  for (const x of lines) { (per[x.l] ||= {}); per[x.l][x.i] = (per[x.l][x.i] || 0) + sign * x.q; }
  for (const [loc, m] of Object.entries(per)) {
    const q = {}; for (const [i, v] of Object.entries(m)) if (v) q[i] = increment(num(v));
    b.set(doc(db, 'stock', slug(loc)), { loc, q }, { merge: true });
  }
}
async function voidMovement(id, data) {
  // check it hasn't already been undone (the rules refuse a second undo too)
  const cur = await getDoc(doc(db, 'movements', id));
  if (cur.data()?.voided) throw new Error('this booking has already been undone');
  const b = writeBatch(db);
  b.set(doc(db, 'movements', id), { voided: true, voidedBy: S.name || '', voidedAt: serverTimestamp() }, { merge: true });
  applyStock(b, data.lines, -1);
  await b.commit();
}

// ---------- tabs ----------
let current = '';
$('#tabs').addEventListener('click', e => { const t = e.target.closest('button')?.dataset.tab; if (t) showTab(t); });
const viewOf = () => S.role === 'mgr' ? 'mgr' : 'simon';
const tabIn = (t) => { const v = $(`#tabs button[data-tab="${t}"]`)?.dataset.view; return v === 'both' || v === viewOf(); };
function applyView() {
  document.querySelectorAll('#tabs button').forEach(b => { b.hidden = !(b.dataset.view === 'both' || b.dataset.view === viewOf()); });
  // manager: stock take and history start on their own food bank
  if (S.role === 'mgr' && S.bank) { const tk = $('#tkLoc'); if (tk) { tk.dataset.def = S.bank; tk.value = S.bank; } H.f.loc = S.bank; }
  updateBankBar();
  $('#btnView').textContent = 'Switch view: ' + (S.role === 'mgr' ? 'Food Bank Manager' : 'Simon');
  showTab(viewOf() === 'mgr' ? 'bank' : 'stock');
  showWho();
}
$('#btnView').onclick = () => chooseRole();
function showTab(t) {
  if (!tabIn(t)) t = viewOf() === 'mgr' ? 'bank' : 'stock';
  current = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
  if (t === 'history') loadHistory(true);
  if (t === 'take') renderTakeTable();
  if (t === 'setup') renderSetup();
  if (t === 'bank') renderBank();
  if (t === 'requests') renderRequests();
  if (t === 'report') renderReport();
  if (t === 'emergency') renderEmergency();
  scrollTo({ top: 0 });
}
function refresh() {
  if (!(S.ready.items && S.ready.locs && S.ready.stock)) { $('#tab-stock').innerHTML = '<p class="muted">Loading stock…</p>'; return; }
  fillItemList(); fillLocSelects(); renderStock(); renderLinesAvail();
  if (current === 'take') renderTakeTable();
  if (current === 'setup') renderSetup();
  renderBank(); renderRequests();
  if (!refresh.once) { refresh.once = true; firstReady(); }
}
function firstReady() {
  // the "Donation" stock location for direct donations
  if (!S.locs['Donation']) setDoc(doc(db, 'config', 'locations'), { l: { Donation: { kind: 'donation', site: 'Direct donations to food banks', addr: '', a: true, o: 90 } } }, { merge: true });
  if (!S.role) chooseRole();
  else { applyView(); if (S.role === 'mgr' && (!S.name || !S.bank)) askName(true); else recordUser(); }
}
// keep a record of everyone who has entered a name (shown in Setup › Users)
async function recordUser() {
  if (!uid || !S.name) return;
  try {
    const ref = doc(db, 'users', uid); const cur = await getDoc(ref);
    await setDoc(ref, { name: S.name, role: S.role || '', bank: S.role === 'mgr' ? (S.bank || '') : '', seen: serverTimestamp(), ...(cur.exists() ? {} : { first: serverTimestamp() }) }, { merge: true });
  } catch (e) { console.warn('user record', e); }
}
function updateBankBar() {
  const bar = $('#bankBar');
  if (S.role !== 'mgr') { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `Your food bank: ${S.bank ? esc(locLabel(S.bank)) : '<i>not chosen</i>'} <button class="link" id="bankChange">Change</button>`;
  $('#bankChange').onclick = () => askName(true);
}
function fillItemList() {
  let dl = $('#itemsList'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'itemsList'; document.body.append(dl); }
  dl.innerHTML = itemNames().map(n => `<option value="${esc(n)}">`).join('');
}
function refreshDonors() {
  let dl = $('#donorList'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'donorList'; document.body.append(dl); }
  dl.innerHTML = Object.entries(S.donors).sort((a, b) => b[1] - a[1]).slice(0, 400).map(([n]) => `<option value="${esc(n)}">`).join('');
}
function locOptions(sel, filter = () => true) { return locNames().filter(filter).map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(locLabel(n))}</option>`).join(''); }
function fillLocSelects() {
  document.querySelectorAll('select[data-locs]').forEach(s => {
    const v = s.value || s.dataset.def; const f = s.dataset.locs;
    s.innerHTML = locOptions(v, n => f === 'all' || (f === 'banks' ? S.locs[n].kind !== 'store' : true));
    if (!s.value && s.options.length) s.selectedIndex = 0;
  });
}

// ---------- who is using the app (temporary until logins) ----------
function showWho() {
  $('#who').textContent = S.role === 'mgr' ? `${S.name || 'Food Bank Manager'}${S.bank ? ' – ' + locLabel(S.bank) : ''}` : S.role === 'simon' ? `Simon's view${S.name && S.name !== 'Simon' ? ' – ' + S.name : ''}` : "Friends of Isaac's Food Bank";
}
function setName(n) { S.name = n; localStorage.setItem('fbm.name', n); showWho(); }
function chooseRole() {
  const m = modal(`<h2>Who is using the app?</h2><p class="muted">For testing only – this will be replaced by logins.</p>
    <div class="rolepick"><button data-r="simon">Simon<small>Stock, requests from food banks, bookings</small></button><button data-r="mgr">Food Bank Manager<small>Shopping lists and donations</small></button></div>`, { locked: true });
  $('.rolepick', m).onclick = e => {
    const r = e.target.closest('button')?.dataset.r; if (!r) return;
    S.role = r; localStorage.setItem('fbm.role', r);
    if (r === 'simon') { setName('Simon'); closeModal(); applyView(); recordUser(); }
    else { applyView(); askName(true); }
  };
}
function askName(force) {
  if (S.name && !force) return;
  const mgr = S.role === 'mgr';
  const banks = bankNames();
  if (mgr && !banks.includes(S.bank)) S.bank = banks.find(b => S.name && S.locs[b].person === S.name) || banks[0] || '';
  const m = modal(`<h2>Your name</h2><p>Your name is saved on everything you do in the app, so others can see who did what. It is kept on this device.</p>
    <label>Name<input id="nm" value="${esc(mgr && S.name === 'Simon' ? '' : S.name)}" placeholder="e.g. Dave"></label>
    ${mgr ? `<label style="margin-top:10px">Your food bank<select id="nmBank">${banks.map(n => `<option value="${esc(n)}" ${n === S.bank ? 'selected' : ''}>${esc(locLabel(n))}</option>`).join('')}</select></label>` : ''}
    <p><button class="btn" id="nmSave">Save</button></p>`, { locked: mgr && (!S.name || S.name === 'Simon') });
  $('#nm', m).focus();
  $('#nmSave', m).onclick = () => {
    const n = norm($('#nm', m).value); if (mgr && !n) return toast('Please enter your name');
    setName(n);
    if (mgr) { S.bank = $('#nmBank', m).value; localStorage.setItem('fbm.bank', S.bank); }
    showWho(); closeModal(); applyView(); renderBank(true); recordUser();
  };
}
showWho();

// ---------- Stock tab ----------
function renderStock() {
  const el = $('#tab-stock');
  const locs = storeNames();   // storage only – food banks are not shown here
  const v = S.view;
  if (v.loc !== 'all' && !S.locs[v.loc]) v.loc = 'all';
  const tot = l => Object.values(S.stock[l] || {}).reduce((a, b) => a + num(b), 0);
  const allItems = [...new Set([...itemNames(), ...locs.flatMap(l => Object.keys(S.stock[l] || {}))])].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const cols = v.loc === 'all' ? locs : [v.loc];
  const q = v.q.toLowerCase();
  const rows = allItems.filter(i => (!q || i.toLowerCase().includes(q)) && (!v.hideZero || cols.some(l => qty(l, i) !== 0)));
  // sorting: by item name, a location's quantity or the total
  if (v.sort !== 'item' && v.sort !== 'total' && !cols.includes(v.sort)) v.sort = 'item';
  const sortVal = i => v.sort === 'total' ? cols.reduce((a, l) => a + qty(l, i), 0) : qty(v.sort, i);
  if (v.sort === 'item') { if (v.dir < 0) rows.reverse(); }
  else rows.sort((a, b) => (sortVal(a) - sortVal(b)) * v.dir || a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const arrows = k => `<button class="sort ${v.sort === k && v.dir === 1 ? 'on' : ''}" data-sort="${esc(k)}" data-dir="1" title="${k === 'item' ? 'A to Z' : 'Lowest first'}">▲</button><button class="sort ${v.sort === k && v.dir === -1 ? 'on' : ''}" data-sort="${esc(k)}" data-dir="-1" title="${k === 'item' ? 'Z to A' : 'Highest first'}">▼</button>`;
  const keep = document.activeElement?.id === 'stockQ' ? document.activeElement.selectionStart : null;
  el.innerHTML = `
    <h2>Stock</h2>
    <div class="stats">
      <div class="stat ${v.loc === 'all' ? 'on' : ''}" data-loc="all"><b>${Math.round(locs.reduce((a, l) => a + tot(l), 0)).toLocaleString()}</b><span>All storage</span></div>
      ${locs.map(l => `<div class="stat ${v.loc === l ? 'on' : ''}" data-loc="${esc(l)}"><b>${Math.round(tot(l)).toLocaleString()}</b><span>${esc(l)}${S.locs[l].site && S.locs[l].site !== l ? `<br><small>${esc(S.locs[l].site)}</small>` : ''}</span></div>`).join('')}
    </div>
    <div class="row noprint">
      <label>Search items<input id="stockQ" value="${esc(v.q)}" placeholder="Type to filter, e.g. beans"></label>
      <label style="flex:0 0 auto"><input type="checkbox" id="hideZero" ${v.hideZero ? 'checked' : ''} style="display:inline;width:auto"> Hide items with no stock</label>
      <button class="btn g sm" id="csv">Download CSV</button>
      <button class="btn y sm" id="addStore">+ Add storage container</button>
    </div>
    <p class="small muted">${rows.length} items shown in storage. Red = below zero (more booked out than booked in – usually a missed booking or a stock take needed). Tap an item for details.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Item ${arrows('item')}</th>${cols.map(l => `<th>${esc(l)} ${arrows(l)}${S.locs[l].site && S.locs[l].site !== l ? `<small>${esc(S.locs[l].site)}</small>` : ''}</th>`).join('')}${cols.length > 1 ? `<th class="tot">Total ${arrows('total')}</th>` : ''}</tr></thead>
      <tbody>${rows.map(i => {
        const vals = cols.map(l => qty(l, i)); const t = vals.reduce((a, b) => a + b, 0);
        return `<tr data-item="${esc(i)}"><td>${esc(i)}</td>${vals.map(x => `<td class="${x < 0 ? 'neg' : x === 0 ? 'zero' : ''}">${x}</td>`).join('')}${cols.length > 1 ? `<td class="tot ${t < 0 ? 'neg' : ''}">${num(t)}</td>` : ''}</tr>`;
      }).join('') || `<tr><td colspan="${cols.length + 2}" class="muted">No items match.</td></tr>`}</tbody>
    </table></div>`;
  $('#addStore', el).onclick = () => {
    const m = modal(`<h2>Add storage container</h2><label>Name<input id="nsN" placeholder="e.g. Container 2"></label><label style="margin-top:10px">Description (optional)<input id="nsS" placeholder="e.g. Blue container behind the hall"></label><p><button class="btn" id="nsSave">Add</button></p>`);
    $('#nsN', m).focus();
    $('#nsSave', m).onclick = () => {
      const n = norm($('#nsN', m).value); if (!n) return;
      if (Object.keys(S.locs).some(x => x.toLowerCase() === n.toLowerCase())) return toast('That name is already used');
      setDoc(doc(db, 'config', 'locations'), { l: { [n]: { kind: 'store', site: norm($('#nsS', m).value), addr: '', a: true, o: 20 } } }, { merge: true }).then(() => { toast('Storage container added'); closeModal(); });
    };
  };
  el.querySelectorAll('.stat').forEach(s => s.onclick = () => { v.loc = s.dataset.loc; renderStock(); });
  const qi = $('#stockQ', el);
  qi.oninput = () => { v.q = qi.value; renderStock(); };
  if (keep !== null) { qi.focus(); qi.setSelectionRange(keep, keep); }
  $('#hideZero', el).onchange = e => { v.hideZero = e.target.checked; renderStock(); };
  $('#csv', el).onclick = () => {
    const lines = [['Item', ...cols, ...(cols.length > 1 ? ['Total'] : [])], ...rows.map(i => { const vals = cols.map(l => qty(l, i)); return [i, ...vals, ...(cols.length > 1 ? [num(vals.reduce((a, b) => a + b, 0))] : [])]; })];
    const csv = lines.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `Stock ${v.loc === 'all' ? 'all locations' : v.loc} ${today()}.csv` });
    a.click();
  };
  el.querySelector('tbody').onclick = e => { const i = e.target.closest('tr')?.dataset.item; if (i) itemModal(i); };
  el.querySelector('thead').onclick = e => { const b = e.target.closest('.sort'); if (!b) return; v.sort = b.dataset.sort; v.dir = +b.dataset.dir; renderStock(); };
}
function itemModal(i) {
  const locs = storeNames(); const t = locs.reduce((a, l) => a + qty(l, i), 0);
  modal(`<h2>${esc(i)}</h2><table>${locs.map(l => `<tr><td>${esc(locLabel(l))}</td><td class="${qty(l, i) < 0 ? 'neg' : ''}">${qty(l, i)}</td></tr>`).join('')}
    <tr><td class="tot">Total</td><td class="tot">${num(t)}</td></tr></table>
    <p class="small muted">To move this item, use Transfer. To correct a count, use Stock Take.</p>`);
}

// ---------- line editor (shared by Book In / Transfer / Book Out) ----------
const editors = [];
function lineEditor(host, { availLoc, label = 'Quantity' } = {}) {
  const ed = { lines: [], availLoc, host };
  host.innerHTML = `<div class="adder"><input list="itemsList" class="it" placeholder="Item – start typing"><input type="number" class="qt" placeholder="${label}" min="0" step="1" inputmode="numeric"><button class="btn y sm add" type="button">Add</button></div>
    <div class="lines"></div><p class="small muted cnt"></p>`;
  const it = $('.it', host), qt = $('.qt', host);
  const add = () => {
    const name = norm(it.value); const q = num(qt.value);
    if (!name) { it.focus(); return; }
    if (!q || q < 0) { qt.focus(); toast('Enter a quantity'); return; }
    const known = Object.keys(S.items).find(n => n.toLowerCase() === name.toLowerCase());
    const nm = known || name;
    const ex = ed.lines.find(x => x.i === nm); if (ex) ex.q = num(ex.q + q); else ed.lines.push({ i: nm, q, isNew: !known });
    it.value = ''; qt.value = ''; it.focus(); draw();
  };
  $('.add', host).onclick = add;
  it.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); qt.focus(); } });
  qt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  function draw() {
    const L = ed.availLoc?.();
    $('.lines', host).innerHTML = ed.lines.map((x, k) => {
      const av = L ? qty(L, x.i) : null;
      return `<div class="line"><span class="nm">${esc(x.i)}${x.isNew ? ' <span class="pill st">new item</span>' : ''}${av !== null ? ` <span class="av">(${esc(L)} has ${av})</span>` : ''}${av !== null && av < x.q ? ' <span class="warn small">more than in stock</span>' : ''}</span>
        <input type="number" value="${x.q}" data-k="${k}" style="width:80px" min="0"><button class="link" data-del="${k}">remove</button></div>`;
    }).join('');
    $('.cnt', host).textContent = ed.lines.length ? `${ed.lines.length} item${ed.lines.length > 1 ? 's' : ''}, ${num(ed.lines.reduce((a, x) => a + x.q, 0))} units` : 'No items added yet.';
  }
  $('.lines', host).addEventListener('change', e => { const k = e.target.dataset.k; if (k !== undefined) { ed.lines[k].q = num(e.target.value); draw(); } });
  $('.lines', host).addEventListener('click', e => { const k = e.target.dataset.del; if (k !== undefined) { ed.lines.splice(k, 1); draw(); } });
  ed.draw = draw; ed.clear = () => { ed.lines = []; draw(); };
  ed.get = () => ed.lines.filter(x => x.q > 0);
  editors.push(ed); draw();
  return ed;
}
function renderLinesAvail() { editors.forEach(e => e.draw()); }

// ---------- Book In ----------
function initIn() {
  const el = $('#tab-in');
  el.innerHTML = `<h2>Book In</h2><div class="card">
    <div class="row">
      <label>Type<select id="inType"><option value="donation">Donation</option><option value="purchase">Purchased</option><option value="other">Other</option></select></label>
      <label>Into<select id="inLoc" data-locs="all" data-def="Main Storage"></select></label>
      <label>Date<input type="date" id="inDate" value="${today()}"></label>
    </div>
    <div class="row" style="margin-top:10px"><label>From (donor, shop or event)<input id="inFrom" list="donorList" placeholder="e.g. Morrisons"></label></div>
    <h3>Items</h3><div id="inLines"></div>
    <p><button class="btn" id="inSave">Book in</button></p></div>`;
  const ed = lineEditor($('#inLines', el));
  $('#inSave', el).onclick = async () => {
    const lines = ed.get(); if (!lines.length) return toast('Add at least one item');
    const type = $('#inType', el).value, loc = $('#inLoc', el).value, from = norm($('#inFrom', el).value);
    const note = (type === 'donation' ? 'Donation' : type === 'purchase' ? 'Purchased' : 'Other') + (from ? ' - ' + from : '');
    try {
      $('#inSave', el).disabled = true;
      await book({ type, note, date: $('#inDate', el).value || today(), lines: lines.map(x => ({ l: loc, i: x.i, q: x.q })), extra: from ? { from } : {} });
      if (from) setDoc(doc(db, 'config', 'donors'), { d: { [from]: increment(1) } }, { merge: true });
      toast(`Booked ${lines.length} item(s) into ${loc}`); ed.clear(); $('#inFrom', el).value = '';
    } catch (e) { toast('Not saved: ' + e.message, 5000); } finally { $('#inSave', el).disabled = false; }
  };
}

// ---------- Transfer ----------
function initTransfer() {
  const el = $('#tab-transfer');
  el.innerHTML = `<h2>Transfer</h2><p class="muted">Move stock from Main Storage (or anywhere) to a food bank. It comes off one location and goes on to the other in one go. Then share the list with the food bank.</p><div class="card">
    <div class="row">
      <label>From<select id="trFrom" data-locs="all" data-def="Main Storage"></select></label>
      <label>To<select id="trTo" data-locs="all" data-def="Greenland"></select></label>
      <label>Date<input type="date" id="trDate" value="${today()}"></label>
    </div>
    <div class="row" style="margin-top:10px"><label>Note (optional)<input id="trNote" placeholder="e.g. Weekly delivery"></label></div>
    <h3>Items</h3><div id="trLines"></div>
    <p><button class="btn" id="trSave">Transfer</button></p></div>`;
  const ed = lineEditor($('#trLines', el), { availLoc: () => $('#trFrom', el).value });
  $('#trFrom', el).onchange = () => ed.draw();
  $('#trSave', el).onclick = async () => {
    const lines = ed.get(); if (!lines.length) return toast('Add at least one item');
    const from = $('#trFrom', el).value, to = $('#trTo', el).value;
    if (from === to) return toast('From and To are the same');
    const extraNote = norm($('#trNote', el).value);
    const date = $('#trDate', el).value || today();
    try {
      $('#trSave', el).disabled = true;
      const id = await book({ type: 'transfer', note: 'Stock Transfer' + (extraNote ? ' - ' + extraNote : ''), date, lines: lines.flatMap(x => [{ l: from, i: x.i, q: -x.q }, { l: to, i: x.i, q: x.q }]), extra: { from, to } });
      toast(`Transferred to ${to}`);
      deliveryNote({ date, from, to, note: extraNote, items: lines.map(x => [x.i, x.q]), by: S.name });
      ed.clear(); $('#trNote', el).value = '';
    } catch (e) { toast('Not saved: ' + e.message, 5000); } finally { $('#trSave', el).disabled = false; }
  };
}
function deliveryNote({ date, from, to, note, items, by }) {
  const L = S.locs[to] || {};
  const text = `Isaac's Food Bank – delivery\n${fmtDate(date)}\nFrom: ${from}\nTo: ${locLabel(to)}${L.addr ? '\n' + L.addr : ''}${note ? '\nNote: ' + note : ''}${by ? '\nSent by: ' + by : ''}\n\n` +
    items.map(([i, q]) => `${q} × ${i}`).join('\n') + `\n\n${items.length} item${items.length === 1 ? '' : 's'}, ${num(items.reduce((a, x) => a + x[1], 0))} units`;
  const m = modal(`<h2>Delivery list</h2><pre class="note" id="dn">${esc(text)}</pre>
    <p class="noprint"><button class="btn" id="dnShare">Share</button> <button class="btn g" id="dnCopy">Copy</button> <button class="btn g" id="dnPrint">Print</button></p>`);
  $('#dnShare', m).onclick = async () => { if (navigator.share) { try { await navigator.share({ title: 'Delivery list', text }); } catch { } } else { location.href = 'https://wa.me/?text=' + encodeURIComponent(text); } };
  $('#dnCopy', m).onclick = async () => { await navigator.clipboard.writeText(text); toast('Copied'); };
  $('#dnPrint', m).onclick = () => print();
}

// ---------- Stock Take ----------
const take = { loc: null, counts: {}, showAll: false, q: '' };
function initTake() {
  const el = $('#tab-take');
  el.innerHTML = `<h2>Stock Take</h2><p class="muted" id="tkHelp"></p>
    <div class="card"><div class="row">
      <label>Location<select id="tkLoc" data-locs="all" data-def="Main Storage"></select></label>
      <label>Date<input type="date" id="tkDate" value="${today()}"></label>
      <label>Search<input id="tkQ" placeholder="filter items"></label>
      <label style="flex:0 0 auto"><input type="checkbox" id="tkAll" style="display:inline;width:auto"> Show every item</label>
    </div></div>
    <div id="tkTable"></div>
    <p><button class="btn" id="tkSave">Save stock take</button> <span id="tkSum" class="muted"></span></p>
    <div id="tkMine"></div>`;
  $('#tkLoc', el).onchange = () => { take.counts = {}; renderTakeTable(); };
  $('#tkAll', el).onchange = e => { take.showAll = e.target.checked; renderTakeTable(); };
  $('#tkQ', el).oninput = e => { take.q = e.target.value.toLowerCase(); renderTakeTable(); };
  $('#tkTable', el).addEventListener('input', e => {
    const i = e.target.dataset.i; if (i === undefined) return;
    if (e.target.value === '') delete take.counts[i]; else take.counts[i] = num(e.target.value);
    e.target.closest('tr').classList.toggle('diff', take.counts[i] !== undefined && take.counts[i] !== qty(take.loc, i));
    takeSum();
  });
  $('#tkSave', el).onclick = async () => {
    const loc = take.loc;
    if (S.role === 'mgr') return submitTake(loc);
    // Simon's stock takes are booked straight away – no request
    const lines = Object.entries(take.counts).map(([i, c]) => ({ l: loc, i, q: num(c - qty(loc, i)) })).filter(x => x.q);
    if (!lines.length) return toast('No differences to book');
    if (!confirmBox(`Book ${lines.length} adjustment(s) at ${loc}?`)) return;
    try { $('#tkSave', el).disabled = true; await book({ type: 'stocktake', note: 'Stock Take', date: $('#tkDate', el).value || today(), lines }); take.counts = {}; toast('Stock take saved'); renderTakeTable(); }
    catch (e) { toast('Not saved: ' + e.message, 5000); } finally { $('#tkSave', el).disabled = false; }
  };
}
// food bank manager: the count goes to Simon's Requests for approval
async function submitTake(loc) {
  const counted = Object.entries(take.counts);
  if (!counted.length) return toast('Type in at least one count');
  if (!S.name) return askName(true);
  if (!confirmBox(`Send this stock take of ${loc} (${counted.length} item${counted.length === 1 ? '' : 's'} counted) to Simon for approval?`)) return;
  const btn = $('#tkSave'); btn.disabled = true;
  try {
    await addDoc(collection(db, 'lists'), { kind: 'stocktake', loc, to: loc, from: '', donation: false, donor: '', date: $('#tkDate').value || today(),
      lines: counted.map(([i, c]) => ({ i, q: num(c), book: qty(loc, i) })), status: 'submitted', by: S.name, uid, created: serverTimestamp(), updated: serverTimestamp(), submittedAt: serverTimestamp(), submittedBy: S.name });
    take.counts = {}; renderTakeTable(); toast('Stock take sent to Simon');
  } catch (e) { toast('Not sent: ' + e.message, 5000); } finally { btn.disabled = false; }
}
function renderMyTakes() {
  const box = $('#tkMine'); if (!box) return;
  if (S.role !== 'mgr') { box.innerHTML = ''; return; }
  const mine = S.lists.filter(l => l.kind === 'stocktake' && (l.uid === uid || l.by === S.name)).sort((a, b) => tsMs(b.submittedAt) - tsMs(a.submittedAt)).slice(0, 10);
  box.innerHTML = mine.length ? `<h3>Your stock takes</h3><div class="card">${mine.map(l => `<div class="hist"><div class="h1"><b>${fmtTs(l.submittedAt)}</b><span class="status ${l.status}">${STATUS[l.status]}</span><span>${esc(locLabel(l.loc))}</span></div><div class="small muted">${l.lines.length} item${l.lines.length === 1 ? '' : 's'} counted${l.reason ? ' · ' + esc(l.reason) : ''}</div></div>`).join('')}</div>` : '';
}
function confirmBox(msg) { return window.confirm(msg); }
function renderTakeTable() {
  const el = $('#tab-take'); const sel = $('#tkLoc', el); if (!sel || !sel.value) return;
  const mgr = S.role === 'mgr';
  $('#tkHelp', el).textContent = mgr ? 'Count what is actually there and type the numbers in. Leave a box empty if you didn\'t count it. Press "Send to Simon" – he checks it and the differences are booked when he accepts it.'
    : 'Count what is actually there and type the numbers in. Only items where your count is different are booked, as a "Stock Take" adjustment, straight away. Leave a box empty if you didn\'t count it.';
  $('#tkSave', el).textContent = mgr ? 'Send to Simon' : 'Save stock take';
  renderMyTakes();
  if (take.loc !== sel.value) { take.loc = sel.value; take.counts = {}; }
  const L = take.loc;
  const items = (take.showAll ? itemNames() : Object.keys(S.stock[L] || {}).filter(i => qty(L, i) !== 0).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })))
    .filter(i => !take.q || i.toLowerCase().includes(take.q));
  const focused = document.activeElement?.dataset?.i;
  $('#tkTable', el).innerHTML = `<div class="tablewrap take"><table><thead><tr><th>Item</th><th>App says</th><th>Counted</th><th>Change</th></tr></thead><tbody>
    ${items.map(i => { const c = take.counts[i]; const d = c === undefined ? '' : num(c - qty(L, i));
      return `<tr class="${d ? 'diff' : ''}"><td>${esc(i)}</td><td class="${qty(L, i) < 0 ? 'neg' : ''}">${qty(L, i)}</td><td><input type="number" min="0" inputmode="numeric" data-i="${esc(i)}" value="${c ?? ''}"></td><td>${d === '' ? '' : (d > 0 ? '+' : '') + d}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">No items with stock here. Tick "Show every item" to count everything.</td></tr>'}
  </tbody></table></div>`;
  if (focused) $(`input[data-i="${CSS.escape(focused)}"]`, el)?.focus();
  takeSum();
}
function takeSum() {
  const n = Object.entries(take.counts).filter(([i, c]) => c !== qty(take.loc, i)).length;
  $('#tkSum').textContent = S.role === 'mgr' ? (Object.keys(take.counts).length ? `${Object.keys(take.counts).length} counted, ${n} different from the app` : '') : (n ? `${n} item(s) will be adjusted` : '');
  document.querySelectorAll('#tkTable tr').forEach(tr => { const inp = tr.querySelector('input'); if (!inp) return; const i = inp.dataset.i; const c = take.counts[i]; tr.cells[3].textContent = c === undefined ? '' : ((c - qty(take.loc, i) > 0 ? '+' : '') + num(c - qty(take.loc, i))); });
}

// ---------- Book Out ----------
function initOut() {
  const el = $('#tab-out');
  el.innerHTML = `<h2>Book Out</h2><p class="muted">Take stock off a location: damaged, out of date, short dated, or given out.</p><div class="card">
    <div class="row">
      <label>Reason<select id="outWhy">${OUT_REASONS.map(r => `<option>${r}</option>`).join('')}</select></label>
      <label>From<select id="outLoc" data-locs="all" data-def="Main Storage"></select></label>
      <label>Date<input type="date" id="outDate" value="${today()}"></label>
    </div>
    <div class="row" style="margin-top:10px"><label>Note (optional)<input id="outNote"></label></div>
    <h3>Items</h3><div id="outLines"></div>
    <p><button class="btn r" id="outSave">Book out</button></p></div>`;
  const ed = lineEditor($('#outLines', el), { availLoc: () => $('#outLoc', el).value });
  $('#outLoc', el).onchange = () => ed.draw();
  $('#outSave', el).onclick = async () => {
    const lines = ed.get(); if (!lines.length) return toast('Add at least one item');
    const loc = $('#outLoc', el).value, why = $('#outWhy', el).value, n = norm($('#outNote', el).value);
    try { $('#outSave', el).disabled = true; await book({ type: 'out', note: why + (n ? ' - ' + n : ''), date: $('#outDate', el).value || today(), lines: lines.map(x => ({ l: loc, i: x.i, q: -x.q })) }); toast(`Booked out of ${loc}`); ed.clear(); $('#outNote', el).value = ''; }
    catch (e) { toast('Not saved: ' + e.message, 5000); } finally { $('#outSave', el).disabled = false; }
  };
}

// ---------- History ----------
const H = { docs: [], last: null, done: false, f: { loc: '', type: '', q: '' } };
function initHistory() {
  const el = $('#tab-history');
  el.innerHTML = `<h2>History</h2><div class="card"><div class="row">
    <label>Location<select id="hLoc"><option value="">All</option></select></label>
    <label>Type<select id="hType"><option value="">All</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
    <label>Search (note, item, name)<input id="hQ"></label></div></div>
    <div class="card" id="hList"></div><p><button class="btn g" id="hMore">Load older</button></p>`;
  $('#hLoc', el).onchange = e => { H.f.loc = e.target.value; loadHistory(true); };
  $('#hType', el).onchange = e => { H.f.type = e.target.value; drawHistory(); };
  $('#hQ', el).oninput = e => { H.f.q = e.target.value.toLowerCase(); drawHistory(); };
  $('#hMore', el).onclick = () => loadHistory(false);
  $('#hList', el).onclick = e => { const id = e.target.closest('.hist')?.dataset.id; if (id) movementModal(H.docs.find(d => d.id === id)); };
}
async function loadHistory(reset) {
  const sel = $('#hLoc'); sel.innerHTML = '<option value="">All locations</option>' + locNames(true).map(n => `<option value="${esc(n)}" ${n === H.f.loc ? 'selected' : ''}>${esc(locLabel(n))}</option>`).join('');
  if (reset) { H.docs = []; H.last = null; H.done = false; }
  if (H.done) return;
  $('#hMore').disabled = true;
  try {
    if (H.f.loc) {
      // one location: load its whole history in one go
      const qs = await getDocs(query(collection(db, 'movements'), where('locs', 'array-contains', H.f.loc)));
      H.docs = qs.docs.map(d => ({ id: d.id, ...d.data() })); H.done = true;
    } else {
    const qy = H.last ? query(collection(db, 'movements'), orderBy('date', 'desc'), startAfter(H.last), limit(60)) : query(collection(db, 'movements'), orderBy('date', 'desc'), limit(60));
    const qs = await getDocs(qy);
    qs.forEach(d => H.docs.push({ id: d.id, ...d.data() }));
    H.last = qs.docs[qs.docs.length - 1] || H.last; H.done = qs.size < 60;
    }
  } catch (e) { toast('Could not load history: ' + e.message, 5000); }
  $('#hMore').disabled = H.done; $('#hMore').textContent = H.done ? (H.f.loc ? `All ${H.docs.length} bookings for ${H.f.loc} shown` : 'No older bookings') : 'Load older';
  drawHistory();
}
function drawHistory() {
  const f = H.f;
  const list = H.docs.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.created?.seconds || 0) - (a.created?.seconds || 0))
    .filter(d => (!f.loc || d.locs?.includes(f.loc)) && (!f.type || d.type === f.type) &&
      (!f.q || (d.note + ' ' + (d.by || '') + ' ' + d.lines.map(x => x.i).join(' ')).toLowerCase().includes(f.q)));
  $('#hList').innerHTML = list.map(d => {
    const t = TYPES[d.type] || TYPES.other;
    const where = d.type === 'transfer' ? `${esc(d.from || d.lines.find(x => x.q < 0)?.l || '')} → ${esc(d.to || [...new Set(d.lines.filter(x => x.q > 0).map(x => x.l))].join(', '))}` : esc((d.locs || []).join(', '));
    const units = num(d.lines.filter(x => d.type !== 'transfer' || x.q > 0).reduce((a, x) => a + Math.abs(x.q), 0));
    return `<div class="hist ${d.voided ? 'void' : ''}" data-id="${d.id}"><div class="h1"><b>${fmtDate(d.date)}</b><span class="pill ${t.cls}">${t.label}</span><span>${where}</span></div>
      <div class="small muted">${esc(d.note)} · ${d.type === 'transfer' ? d.lines.filter(x => x.q > 0).length : d.lines.length} lines, ${units} units${d.by ? ' · by ' + esc(d.by) : ''}${d.voided ? ' · UNDONE' : ''}</div></div>`;
  }).join('') || '<p class="muted">Nothing found in the bookings loaded so far. Try "Load older".</p>';
}
function movementModal(d) {
  const t = TYPES[d.type] || TYPES.other;
  const byLoc = {}; d.lines.forEach(x => (byLoc[x.l] ||= []).push(x));
  const m = modal(`<h2>${t.label} – ${fmtDate(d.date)}</h2><p>${esc(d.note)}${d.by ? `<br><span class="muted">By ${esc(d.by)}</span>` : ''}${d.imported ? '<br><span class="muted small">Imported from the spreadsheet</span>' : ''}${d.voided ? `<br><b class="warn">Undone${d.voidedBy ? ' by ' + esc(d.voidedBy) : ''}</b>` : ''}</p>
    ${Object.entries(byLoc).map(([l, xs]) => `<h3>${esc(locLabel(l))}</h3><table>${xs.map(x => `<tr><td>${esc(x.i)}</td><td class="${x.q < 0 ? 'neg' : ''}">${x.q > 0 ? '+' : ''}${x.q}</td></tr>`).join('')}</table>`).join('')}
    <p class="noprint">${d.type === 'transfer' ? '<button class="btn g" id="mDn">Delivery list</button> ' : ''}${d.voided || S.role === 'mgr' ? '' : '<button class="btn r" id="mUndo">Undo this booking</button>'}</p>`);
  if ($('#mDn', m)) $('#mDn', m).onclick = () => {
    const to = d.to || d.lines.find(x => x.q > 0)?.l, from = d.from || d.lines.find(x => x.q < 0)?.l;
    deliveryNote({ date: d.date, from, to, note: d.note.replace(/^Stock Transfer( - )?/, ''), items: d.lines.filter(x => x.q > 0).map(x => [x.i, x.q]), by: d.by });
  };
  if ($('#mUndo', m)) $('#mUndo', m).onclick = async () => {
    if (!confirmBox('Undo this booking? The stock goes back to how it was before it. The booking stays in History, crossed out.')) return;
    if (d.voided) return;
    $('#mUndo', m).disabled = true;
    try { await voidMovement(d.id, d); d.voided = true; d.voidedBy = S.name; toast('Booking undone'); closeModal(); drawHistory(); } catch (e) { toast('Not undone: ' + e.message, 5000); $('#mUndo', m).disabled = false; }
  };
}

// ---------- Setup ----------
const userNames = () => [...new Set(Object.values(S.users).map(u => u.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
function renderSetup() {
  const el = $('#tab-setup');
  if (el.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;   // don't wipe what is being typed
  const people = userNames();
  const users = Object.values(S.users).sort((a, b) => tsMs(b.seen) - tsMs(a.seen));
  const items = Object.keys(S.items).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  el.innerHTML = `<h2>Setup</h2>
    <div class="card"><h3 style="margin-top:0">You</h3><p>${S.name ? `Bookings from this device are saved as <b>${esc(S.name)}</b>.` : 'No name set yet.'} <button class="link" id="stName">Change</button></p></div>
    <div class="card"><h3 style="margin-top:0">Locations</h3>
      <div class="tablewrap"><table><thead><tr><th>Name</th><th>Type</th><th>Food bank / site name</th><th>Address</th><th>Default person</th><th>In use</th></tr></thead><tbody>
      ${locNames(true).map(n => { const L = S.locs[n]; return `<tr data-l="${esc(n)}"><td>${esc(n)}</td>
        <td><select data-f="kind"><option value="store" ${L.kind === 'store' ? 'selected' : ''}>Storage</option><option value="bank" ${L.kind === 'bank' ? 'selected' : ''}>Food bank</option><option value="other" ${L.kind === 'other' ? 'selected' : ''}>Other</option><option value="donation" ${L.kind === 'donation' ? 'selected' : ''}>Direct donations</option></select></td>
        <td><input data-f="site" value="${esc(L.site || '')}"></td><td><input data-f="addr" value="${esc(L.addr || '')}" style="min-width:260px"></td>
        <td><select data-f="person"><option value="">– none –</option>${[...new Set([...people, ...(L.person ? [L.person] : [])])].map(u => `<option ${u === L.person ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-f="a" ${L.a !== false ? 'checked' : ''}></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:10px"><label>New location<input id="newLoc" placeholder="e.g. Bromsgrove"></label><button class="btn sm" id="addLoc">Add location</button></div>
    </div>
    <div class="card"><h3 style="margin-top:0">Users (${people.length})</h3>
      <p class="small muted">Everyone who has entered a name in the app. A new name is added here as soon as it is used. The same person on two devices shows twice.</p>
      <div class="tablewrap" style="max-height:40vh"><table><thead><tr><th>Name</th><th>View</th><th>Food bank</th><th>First used</th><th>Last used</th></tr></thead><tbody>
      ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${u.role === 'mgr' ? 'Food Bank Manager' : u.role === 'simon' ? 'Simon' : '–'}</td><td>${esc(u.bank ? locLabel(u.bank) : '')}</td><td>${u.first ? fmtTs(u.first) : ''}</td><td>${u.seen ? fmtTs(u.seen) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nobody recorded yet.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h3 style="margin-top:0">Emergency contacts</h3>
      <p class="small muted">Shown in everyone's Emergency tab. Changes save when you leave a box.</p>
      <div class="tablewrap"><table><thead><tr><th>Name</th><th>Role / organisation</th><th>Phone</th><th>Email</th><th>Notes</th><th></th></tr></thead><tbody id="ecRows">
      ${S.emergency.map((c, k) => `<tr data-k="${k}">${['name', 'role', 'phone', 'email', 'notes'].map(f => `<td><input data-ec="${f}" value="${esc(c[f] || '')}"></td>`).join('')}<td><button class="link" data-ecdel="${k}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No contacts yet.</td></tr>'}
      </tbody></table></div>
      <p><button class="btn sm" id="ecAdd">+ Add contact</button></p></div>
    <div class="card"><h3 style="margin-top:0">Items (${items.length})</h3>
      <p class="small muted">Untick an item to hide it from the item lists (its stock and history stay). New items can also be typed straight into a booking.</p>
      <div class="row"><label>New item<input id="newItem"></label><button class="btn sm" id="addItem">Add item</button><label>Search<input id="itQ"></label></div>
      <div class="tablewrap" style="max-height:50vh;margin-top:10px"><table><thead><tr><th>Item</th><th>Total stock</th><th>In use</th></tr></thead><tbody id="itRows"></tbody></table></div>
    </div>
    <div class="card"><h3 style="margin-top:0">Backup</h3><p class="small muted">Downloads everything (items, locations, stock and all bookings) as one file.</p><button class="btn g sm" id="bk">Download backup</button></div>`;
  const drawItems = q => { $('#itRows', el).innerHTML = items.filter(i => !q || i.toLowerCase().includes(q)).map(i => { const t = num(locNames(true).reduce((a, l) => a + qty(l, i), 0)); return `<tr><td>${esc(i)}</td><td class="${t < 0 ? 'neg' : ''}">${t}</td><td><input type="checkbox" data-item="${esc(i)}" ${S.items[i].a !== false ? 'checked' : ''}></td></tr>`; }).join(''); };
  drawItems('');
  $('#itQ', el).oninput = e => drawItems(e.target.value.toLowerCase());
  $('#stName', el).onclick = () => askName(true);
  const saveEc = list => setDoc(doc(db, 'config', 'emergency'), { c: list }).then(() => toast('Saved'));
  $('#ecAdd', el).onclick = () => saveEc([...S.emergency, { name: 'New contact', role: '', phone: '', email: '', notes: '' }]);
  $('#ecRows', el).addEventListener('change', e => { const k = e.target.closest('tr')?.dataset.k; const f = e.target.dataset.ec; if (k === undefined || !f) return; const list = S.emergency.map(c => ({ ...c })); list[k][f] = norm(e.target.value); saveEc(list); });
  $('#ecRows', el).addEventListener('click', e => { const k = e.target.dataset.ecdel; if (k === undefined) return; if (!confirmBox(`Delete ${S.emergency[k].name || 'this contact'}?`)) return; saveEc(S.emergency.filter((_, j) => j !== +k)); });
  el.querySelector('tbody').addEventListener('change', e => {
    const tr = e.target.closest('tr'); const n = tr.dataset.l; const f = e.target.dataset.f; if (!n || !f) return;
    const val = f === 'a' ? e.target.checked : (e.target.value ?? '').trim();
    setDoc(doc(db, 'config', 'locations'), { l: { [n]: { [f]: val } } }, { merge: true }).then(() => toast('Saved'));
  });
  $('#addLoc', el).onclick = () => {
    const n = norm($('#newLoc', el).value); if (!n) return;
    if (Object.keys(S.locs).some(x => x.toLowerCase() === n.toLowerCase())) return toast('That location already exists');
    setDoc(doc(db, 'config', 'locations'), { l: { [n]: { kind: 'bank', site: '', addr: '', a: true, o: 50 } } }, { merge: true }).then(() => toast('Location added'));
  };
  $('#addItem', el).onclick = () => {
    const n = norm($('#newItem', el).value); if (!n) return;
    if (Object.keys(S.items).some(x => x.toLowerCase() === n.toLowerCase())) return toast('That item already exists');
    setDoc(doc(db, 'config', 'items'), { i: { [n]: { a: true } } }, { merge: true }).then(() => toast('Item added'));
  };
  $('#itRows', el).addEventListener('change', e => { const i = e.target.dataset.item; if (i) setDoc(doc(db, 'config', 'items'), { i: { [i]: { a: e.target.checked } } }, { merge: true }).then(() => toast('Saved')); });
  $('#bk', el).onclick = async () => {
    toast('Preparing backup…');
    const mv = await getDocs(collection(db, 'movements'));
    const ts = o => JSON.parse(JSON.stringify(o, (k, v) => v && typeof v === 'object' && 'seconds' in v && 'nanoseconds' in v ? new Date(v.seconds * 1000).toISOString() : v));
    const data = { app: 'Food Bank Manager', version: APP_VERSION, exported: new Date().toISOString(), items: S.items, locations: S.locs, donors: S.donors, stock: S.stock, lists: ts(S.lists), users: ts(S.users), emergency: S.emergency, movements: mv.docs.map(d => ({ id: d.id, ...d.data(), created: d.data().created?.toDate?.().toISOString?.() || null, voidedAt: d.data().voidedAt?.toDate?.().toISOString?.() || undefined })) };
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), download: `Food Bank backup ${today()} v${APP_VERSION}.json` });
    a.click();
  };
}

// ---------- Report (both views): what a food bank received, used and has now ----------
const R = { loc: '', from: '', to: '', rows: null, totals: null, busy: false };
function renderReport() {
  const el = $('#tab-report');
  if (!S.ready.locs) return;
  const banks = locNames().filter(n => S.locs[n].kind !== 'donation');
  if (!R.loc || !S.locs[R.loc]) R.loc = (S.role === 'mgr' && S.bank) ? S.bank : (bankNames()[0] || banks[0]);
  if (!R.to) { R.to = today(); const d = new Date(); d.setDate(d.getDate() - 30); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); R.from = d.toISOString().slice(0, 10); }
  el.innerHTML = `<h2>Report</h2><p class="muted">What a food bank received, what went out and what it has now, for the dates you choose. "Given out" comes from stock takes (the count was lower than the app) and Book Out.</p>
    <div class="card"><div class="row">
      <label>Food bank<select id="rpLoc">${banks.map(n => `<option value="${esc(n)}" ${n === R.loc ? 'selected' : ''}>${esc(locLabel(n))}</option>`).join('')}</select></label>
      <label>From<input type="date" id="rpFrom" value="${R.from}"></label><label>To<input type="date" id="rpTo" value="${R.to}"></label>
      <button class="btn" id="rpRun">Show report</button></div></div>
    <div id="rpOut" class="rep"></div>`;
  $('#rpRun', el).onclick = () => { R.loc = $('#rpLoc', el).value; R.from = $('#rpFrom', el).value; R.to = $('#rpTo', el).value; runReport(); };
  $('#rpLoc', el).onchange = () => { R.loc = $('#rpLoc', el).value; runReport(); };
  runReport();
}
async function runReport() {
  const out = $('#rpOut'); if (!out) return;
  if (!R.from || !R.to || R.from > R.to) { out.innerHTML = '<p class="warn">Choose a From date before the To date.</p>'; return; }
  out.innerHTML = '<p class="muted">Working it out…</p>';
  const L = R.loc;
  try {
    const qs = await getDocs(query(collection(db, 'movements'), where('locs', 'array-contains', L)));
    const rows = {}; const T = { rec: 0, don: 0, given: 0, out: 0, sent: 0, plus: 0, n: 0 };
    const row = i => (rows[i] ||= { rec: 0, don: 0, given: 0, out: 0, sent: 0, plus: 0 });
    qs.forEach(d => {
      const m = d.data(); if (m.voided || m.date < R.from || m.date > R.to) return; T.n++;
      for (const x of m.lines) {
        if (x.l !== L) continue; const r = row(x.i), q = x.q;
        const k = m.type === 'transfer' ? (q > 0 ? 'rec' : 'sent') : m.type === 'stocktake' ? (q < 0 ? 'given' : 'plus') : m.type === 'out' ? 'out' : (q > 0 ? 'don' : 'out');
        r[k] += Math.abs(q); T[k] += Math.abs(q);
      }
    });
    const stockNow = S.stock[L] || {};
    const items = [...new Set([...Object.keys(rows), ...Object.keys(stockNow).filter(i => qty(L, i) !== 0)])].sort((a, b) => ((rows[b]?.given || 0) + (rows[b]?.out || 0)) - ((rows[a]?.given || 0) + (rows[a]?.out || 0)) || a.localeCompare(b));
    const nowTot = Object.values(stockNow).reduce((a, b) => a + num(b), 0);
    const c = v => v ? num(v) : '<span class="muted">–</span>';
    out.innerHTML = `<h3>${esc(locLabel(L))} · ${fmtDate(R.from)} to ${fmtDate(R.to)}</h3>
      <div class="stats">
        <div class="stat"><b>${num(T.rec)}</b><span>Received from storage</span></div>
        <div class="stat"><b>${num(T.don)}</b><span>Donations / bought</span></div>
        <div class="stat"><b>${num(T.given)}</b><span>Given out (stock takes)</span></div>
        <div class="stat"><b>${num(T.out)}</b><span>Booked out</span></div>
        <div class="stat"><b>${Math.round(nowTot)}</b><span>In stock now</span></div>
      </div>
      <p class="small muted">${T.n} booking${T.n === 1 ? '' : 's'} in this period${T.sent ? ` · ${num(T.sent)} sent on elsewhere` : ''}${T.plus ? ` · ${num(T.plus)} found in stock takes` : ''}. Units, not weight.</p>
      <div class="tablewrap"><table><thead><tr><th>Item</th><th>Received</th><th>Donated / bought</th><th>Given out</th><th>Booked out</th><th>Sent on</th><th>Found</th><th class="tot">In stock now</th></tr></thead><tbody>
      ${items.map(i => { const r = rows[i] || {}; const n = qty(L, i); return `<tr><td>${esc(i)}</td><td>${c(r.rec)}</td><td>${c(r.don)}</td><td>${c(r.given)}</td><td>${c(r.out)}</td><td>${c(r.sent)}</td><td>${c(r.plus)}</td><td class="tot ${n < 0 ? 'neg' : ''}">${n}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">Nothing booked here in this period.</td></tr>'}
      </tbody></table></div>`;
  } catch (e) { out.innerHTML = `<p class="warn">Could not make the report: ${esc(e.message)}</p>`; }
}

// ---------- Emergency (both views) ----------
function renderEmergency() {
  const el = $('#tab-emergency'); if (!el) return;
  el.innerHTML = `<h2>Emergency</h2>
    ${S.emergency.length ? `<div class="ec">${S.emergency.map(c => `<div class="card"><h3>${esc(c.name)}</h3>${c.role ? `<div class="muted">${esc(c.role)}</div>` : ''}
      ${c.phone ? `<a class="tel" href="tel:${esc(c.phone.replace(/[^0-9+]/g, ''))}">📞 ${esc(c.phone)}</a>` : ''}
      ${c.email ? `<div><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}${c.notes ? `<p class="small">${esc(c.notes)}</p>` : ''}</div>`).join('')}</div>`
    : `<div class="card muted">The emergency contact list hasn't been added yet.${S.role === 'simon' ? ' Add contacts in Setup › Emergency contacts.' : ''}</div>`}
    <p class="small muted">In an emergency where someone is in danger, call 999.</p>`;
}

// ---------- Food Bank Manager view: shopping lists ----------
const LS = { local: {}, timers: {}, saving: {} };   // unsaved local copies of draft lists
const STATUS = { draft: 'Draft', submitted: 'Sent to Simon', accepted: 'Accepted', rejected: 'Not accepted' };
const tsMs = t => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : Date.now());
const fmtTs = t => { const d = new Date(tsMs(t)); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
const listOf = id => LS.local[id] || S.lists.find(l => l.id === id);
function myLists() {
  const order = { draft: 0, submitted: 1, accepted: 2, rejected: 2 };
  return S.lists.filter(l => l.kind !== 'stocktake' && (l.to === S.bank || l.uid === uid) && (S.showDone || l.status === 'draft' || l.status === 'submitted'))
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.status === 'draft' ? tsMs(b.created) - tsMs(a.created) : tsMs(b.decidedAt || b.submittedAt) - tsMs(a.decidedAt || a.submittedAt)));
}
function renderBank(force) {
  const el = $('#tab-bank');
  if (!S.ready.locs || !S.ready.items) { el.innerHTML = '<p class="muted">Loading…</p>'; return; }
  if (!el.dataset.init || force) {
    el.dataset.init = '1';
    el.innerHTML = `<h2>Food Bank</h2><p class="muted">Make a shopping list of what your food bank needs and send it to Simon. Use <b>Donation</b> for things given straight to you that never went through storage. Lists save as you type.</p>
      <p class="noprint"><button class="btn" id="newList">+ New shopping list</button> <button class="btn p" id="newDon">+ New donation list</button> <button class="btn g" id="toggleDone"></button></p>
      <div class="lists" id="listsBox"></div><p class="muted small" id="listsNone"></p>`;
    $('#newList', el).onclick = () => newList(false);
    $('#newDon', el).onclick = () => newList(true);
    $('#toggleDone', el).onclick = () => { S.showDone = !S.showDone; localStorage.setItem('fbm.showDone', S.showDone ? '1' : '0'); renderBank(); };
  }
  $('#toggleDone', el).textContent = S.showDone ? 'Hide completed lists' : 'Show completed lists';
  const box = $('#listsBox', el);
  const lists = myLists();
  const cards = lists.map(l => {
    let c = box.querySelector(`.paper[data-id="${l.id}"]`);
    const typing = c && c.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);
    // keep a card the user is typing in – unless its status changed (e.g. just submitted or decided by Simon)
    const busy = c && c.dataset.status === l.status && (typing || LS.timers[l.id] || LS.saving[l.id]);
    if (!busy) { const n = listCard(listOf(l.id)); if (c) c.replaceWith(n); c = n; }
    return c;
  });
  const same = cards.length === box.children.length && cards.every((c, k) => box.children[k] === c);
  if (!same) box.replaceChildren(...cards);
  const hidden = S.showDone ? 0 : S.lists.filter(l => l.kind !== 'stocktake' && (l.to === S.bank || l.uid === uid) && (l.status === 'accepted' || l.status === 'rejected')).length;
  $('#listsNone', el).textContent = (lists.length ? '' : 'No lists yet – press "New shopping list" to start one. ') + (hidden ? `${hidden} completed list${hidden === 1 ? '' : 's'} hidden.` : '');
}
async function newList(donation) {
  if (!S.name) return askName(true);
  const to = bankNames().includes(S.bank) ? S.bank : bankNames()[0];
  const from = storeNames().includes('Main Storage') ? 'Main Storage' : storeNames()[0];
  try {
    await addDoc(collection(db, 'lists'), { from: donation ? '' : from, to, donation, donor: '', lines: [], status: 'draft', by: S.name, uid, created: serverTimestamp(), updated: serverTimestamp() });
    toast(donation ? 'New donation list' : 'New shopping list');
  } catch (e) { toast('Could not create the list: ' + e.message, 5000); }
}
function listCard(l) {
  const c = document.createElement('div');
  c.className = `paper ${l.donation ? 'don' : ''} ${l.status !== 'draft' ? 'done' : ''}`;
  c.dataset.id = l.id;
  c.dataset.status = l.status;
  const edit = l.status === 'draft';
  const title = l.donation ? 'Donation' : 'Shopping list';
  const head = `<h4>${title}<span class="status ${l.status}">${STATUS[l.status] || l.status}</span></h4>
    <div class="small muted" style="line-height:20px">${esc(l.by || '')}${l.created ? ' · started ' + fmtTs(l.created) : ''}${l.submittedAt ? ' · sent ' + fmtTs(l.submittedAt) : ''}</div>`;
  if (!edit) {
    c.innerHTML = `${head}<div class="ph"><span>${l.donation ? 'Donated by' : 'From'}</span><span>${esc(l.donation ? (l.donor || '–') : l.from)}</span><span>To</span><span>${esc(locLabel(l.to))}</span></div>
      ${(l.status === 'accepted' ? (l.acceptedLines || l.lines) : l.lines).map(x => `<div class="pl"><span class="pn">${esc(x.i)}</span><span class="pq"><b>${x.q}</b></span></div>`).join('')}
      <div class="pfoot small">${l.status === 'accepted' ? `Accepted by ${esc(l.decidedBy || 'Simon')} ${l.decidedAt ? fmtTs(l.decidedAt) : ''}${l.changed ? ' – some quantities were changed' : ''}` : l.status === 'rejected' ? `Not accepted by ${esc(l.decidedBy || 'Simon')}${l.reason ? ': ' + esc(l.reason) : ''}` : 'Waiting for Simon'}</div>`;
    return c;
  }
  const stores = storeNames(), banks = bankNames();
  c.innerHTML = `${head}
    <div class="ph">
      ${l.donation ? `<span>Donated by</span><input data-f="donor" list="donorList" value="${esc(l.donor || '')}" placeholder="optional – who gave it">`
                   : `<span>From</span><select data-f="from">${stores.map(n => `<option value="${esc(n)}" ${n === l.from ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`}
      <span>To</span><select data-f="to">${banks.map(n => `<option value="${esc(n)}" ${n === l.to ? 'selected' : ''}>${esc(locLabel(n))}</option>`).join('')}</select>
    </div>
    <div class="plines"></div>
    <div class="padd noprint"><input list="itemsList" class="it" placeholder="Add an item"><input type="number" class="qt" min="1" step="1" inputmode="numeric" placeholder="Qty"><button class="btn y sm add" type="button">Add</button></div>
    <div class="pfoot noprint"><button class="btn sm sv">Save</button><button class="btn sm g sub">Submit</button><button class="link dl">Delete</button><span class="saved"></span></div>`;
  drawLines(c, l);
  const mut = fn => { const cur = JSON.parse(JSON.stringify(listOf(l.id))); fn(cur); LS.local[l.id] = cur; schedule(l.id); };
  c.addEventListener('change', e => {
    const f = e.target.dataset.f, k = e.target.dataset.k;
    if (f) { mut(x => { x[f] = norm(e.target.value); }); drawLines(c, listOf(l.id)); }
    if (k !== undefined) { const q = num(e.target.value); mut(x => { if (q > 0) x.lines[k].q = q; else x.lines.splice(k, 1); }); drawLines(c, listOf(l.id)); }
  });
  c.addEventListener('input', e => { const k = e.target.dataset.k; if (k !== undefined && num(e.target.value) > 0) mut(x => { x.lines[k].q = num(e.target.value); }); });
  c.addEventListener('click', async e => {
    const t = e.target;
    if (t.dataset.del !== undefined) { mut(x => x.lines.splice(+t.dataset.del, 1)); drawLines(c, listOf(l.id)); }
    else if (t.classList.contains('add')) addLine();
    else if (t.classList.contains('sv')) { await saveList(l.id); toast('List saved'); }
    else if (t.classList.contains('dl')) {
      if (!confirmBox('Delete this list? This cannot be undone.')) return;
      clearTimeout(LS.timers[l.id]); delete LS.timers[l.id]; delete LS.local[l.id];
      try { await deleteDoc(doc(db, 'lists', l.id)); toast('List deleted'); } catch (err) { toast('Not deleted: ' + err.message, 5000); }
    }
    else if (t.classList.contains('sub')) {
      const cur = listOf(l.id);
      if (!cur.lines.length) return toast('Add at least one item first');
      if (!cur.to) return toast('Choose a food bank');
      if (!cur.donation && !cur.from) return toast('Choose where it comes from');
      if (!confirmBox(`Send this ${cur.donation ? 'donation' : 'shopping list'} to Simon? You can't change it after this.`)) return;
      try {
        await saveList(l.id);
        await updateDoc(doc(db, 'lists', l.id), { status: 'submitted', submittedAt: serverTimestamp(), submittedBy: S.name });
        toast('Sent to Simon');
      } catch (err) { toast('Not sent: ' + err.message, 5000); }
    }
  });
  const it = $('.it', c), qt = $('.qt', c);
  function addLine() {
    const name = norm(it.value), q = num(qt.value);
    if (!name) return it.focus();
    if (!(q > 0)) { qt.focus(); return toast('Enter a quantity'); }
    const nm = Object.keys(S.items).find(n => n.toLowerCase() === name.toLowerCase()) || name;
    mut(x => { const ex = x.lines.find(y => y.i === nm); if (ex) ex.q = num(ex.q + q); else x.lines.push({ i: nm, q }); });
    it.value = ''; qt.value = ''; it.focus(); drawLines(c, listOf(l.id));
  }
  it.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); qt.focus(); } });
  qt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } });
  return c;
}
function drawLines(c, l) {
  const box = $('.plines', c); if (!box) return;
  box.innerHTML = l.lines.map((x, k) => {
    const av = !l.donation && l.from ? qty(l.from, x.i) : null;
    return `<div class="pl"><span class="pn" title="${esc(x.i)}">${esc(x.i)}${S.items[x.i] ? '' : ' <span class="pill st">new</span>'}</span>${av !== null ? `<span class="av">${esc(l.from)} has ${av}</span>` : ''}<input type="number" min="0" data-k="${k}" value="${x.q}"><button class="link" data-del="${k}" title="Remove">✕</button></div>`;
  }).join('') || '<div class="pl muted small">No items yet</div>';
}
function schedule(id) {
  const c = document.querySelector(`.paper[data-id="${id}"] .saved`); if (c) c.textContent = 'Not saved yet…';
  clearTimeout(LS.timers[id]);
  LS.timers[id] = setTimeout(() => { delete LS.timers[id]; saveList(id); }, 900);
}
async function saveList(id) {
  clearTimeout(LS.timers[id]); delete LS.timers[id];
  const l = LS.local[id]; if (!l) return;
  const c = document.querySelector(`.paper[data-id="${id}"] .saved`);
  LS.saving[id] = true; if (c) c.textContent = 'Saving…';
  try {
    await updateDoc(doc(db, 'lists', id), { from: l.from || '', to: l.to, donation: !!l.donation, donor: l.donor || '', lines: l.lines, updated: serverTimestamp() });
    if (LS.local[id] === l) delete LS.local[id];
    if (c) c.textContent = navigator.onLine ? 'Saved ✓' : 'Saved on this device – will sync';
  } catch (e) { if (c) c.textContent = 'Not saved: ' + e.message; }
  finally { delete LS.saving[id]; }
}

// ---------- Simon's view: requests from food banks ----------
const reqKind = l => l.kind === 'stocktake' ? 'Stock take' : l.donation ? 'Direct donation' : 'Shopping list';
const reqWhere = l => l.kind === 'stocktake' ? esc(locLabel(l.loc)) : (l.donation ? '' : esc(l.from) + ' → ') + esc(locLabel(l.to));
const reqCls = l => l.kind === 'stocktake' ? 'st' : l.donation ? 'don' : '';
function renderRequests() {
  const el = $('#tab-requests');
  const pending = S.lists.filter(l => l.status === 'submitted').sort((a, b) => tsMs(a.submittedAt) - tsMs(b.submittedAt));
  $('#reqCount').textContent = pending.length || '';
  if (!S.ready.locs || !S.ready.stock) return;
  // don't wipe what Simon is typing – unless that request has just been decided
  const typingIn = el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' ? document.activeElement.closest('.req')?.dataset.id : null;
  if (typingIn && pending.some(l => l.id === typingIn)) { el.dataset.stale = '1'; return; }
  const done = S.lists.filter(l => l.status === 'accepted' || l.status === 'rejected').sort((a, b) => tsMs(b.decidedAt) - tsMs(a.decidedAt)).slice(0, 20);
  el.innerHTML = `<h2>Requests</h2><p class="muted">Shopping lists, donations and stock takes sent by the food banks. Check the figures (change them if you need to), then Accept – that books the stock straight away. Purple = direct donation, yellow = stock take. Tap a decided request to see it in full or reopen it.</p>
    ${pending.map(l => reqCard(l)).join('') || '<div class="card muted">No requests waiting.</div>'}
    ${done.length ? `<h3>Recently decided</h3><div class="card">${done.map(l => { const n = (l.acceptedLines || l.lines).length; return `<div class="hist req ${reqCls(l)}" data-id="${l.id}"><div class="h1"><b>${fmtTs(l.decidedAt)}</b><span class="status ${l.status}">${STATUS[l.status]}</span><span><b>${reqKind(l)}</b> · ${reqWhere(l)}</span></div><div class="small muted">${esc(l.by)} · ${n} item${n === 1 ? '' : 's'}${l.reopened ? ' · reopened ' + l.reopened + '×' : ''}${l.reason ? ' · ' + esc(l.reason) : ''}</div></div>`; }).join('')}</div>` : ''}`;
  el.querySelectorAll('.card.req').forEach(card => {
    const l = S.lists.find(x => x.id === card.dataset.id);
    $('.acc', card).onclick = () => acceptRequest(l, card);
    $('.rej', card).onclick = () => rejectRequest(l, card);
  });
  el.querySelectorAll('.hist.req').forEach(h => h.onclick = () => requestModal(S.lists.find(x => x.id === h.dataset.id)));
}
function reqCard(l) {
  const start = l.acceptedLines && l.reopened ? l.acceptedLines : l.lines;   // a reopened request starts from what was accepted last time
  const val = i => start.find(x => x.i === i)?.q ?? l.lines.find(x => x.i === i)?.q;
  let table;
  if (l.kind === 'stocktake') {
    table = `<thead><tr><th>Item</th><th>App says now</th><th>Counted</th><th>Change</th></tr></thead><tbody>
      ${l.lines.map((x, k) => { const now = qty(l.loc, x.i); const c = val(x.i); const d = num(c - now); return `<tr><td>${esc(x.i)}</td><td class="${now < 0 ? 'neg' : ''}">${now}</td><td><input type="number" min="0" data-k="${k}" value="${c}"></td><td>${d ? (d > 0 ? '+' : '') + d : ''}</td></tr>`; }).join('')}</tbody>`;
  } else {
    table = `<thead><tr><th>Item</th><th>Asked for</th>${l.donation ? '' : `<th>${esc(l.from)} has</th>`}<th>${l.donation ? 'Book in' : 'Send'}</th></tr></thead><tbody>
      ${l.lines.map((x, k) => { const av = l.donation ? null : qty(l.from, x.i); return `<tr><td>${esc(x.i)}</td><td>${x.q}</td>${av === null ? '' : `<td class="${av < x.q ? 'neg' : ''}">${av}</td>`}<td><input type="number" min="0" data-k="${k}" value="${val(x.i)}"></td></tr>`; }).join('')}</tbody>`;
  }
  return `<div class="card req ${reqCls(l)}" data-id="${l.id}">
    <div class="h1"><b>${reqKind(l)}</b> · ${reqWhere(l)}${l.reopened ? ' <span class="status draft">Reopened</span>' : ''}</div>
    <div class="small muted">From ${esc(l.by || '?')}${l.submittedAt ? ', sent ' + fmtTs(l.submittedAt) : ''}${l.donation && l.donor ? ' · donated by ' + esc(l.donor) : ''}${l.kind === 'stocktake' && l.date ? ' · counted ' + fmtDate(l.date) : ''}</div>
    <div class="tablewrap" style="margin-top:8px"><table>${table}</table></div>
    <div class="row" style="margin-top:10px"><label>Note for the food bank (needed if not accepting)<input class="why" placeholder="${l.kind === 'stocktake' ? 'e.g. Please recount the beans' : 'e.g. Out of stock – will send next week'}"></label>
      <button class="btn acc">Accept</button><button class="btn r rej">Don't accept</button></div></div>`;
}
async function acceptRequest(l, card) {
  const lines = l.lines.map((x, k) => ({ i: x.i, q: num($(`input[data-k="${k}"]`, card).value) }));
  const reason = norm($('.why', card).value);
  const date = today();
  const b = writeBatch(db); const ids = [];
  if (l.kind === 'stocktake') {
    // book the differences between the count and what the app says now
    const adj = lines.map(x => ({ l: l.loc, i: x.i, q: num(x.q - qty(l.loc, x.i)) })).filter(x => x.q);
    if (!confirmBox(adj.length ? `Book ${adj.length} stock take adjustment${adj.length === 1 ? '' : 's'} at ${l.loc}?` : `The counts match the app – accept with no changes?`)) return;
    if (adj.length) ids.push(addMovement(b, { type: 'stocktake', note: `Stock Take - counted by ${l.by || '?'}`, date: l.date || date, lines: adj, extra: { listId: l.id, listBy: l.by || '' } }));
    b.update(doc(db, 'lists', l.id), { status: 'accepted', acceptedLines: lines, changed: lines.some((x, k) => x.q !== l.lines[k].q), reason, decidedBy: S.name || 'Simon', decidedAt: serverTimestamp(), movementIds: ids });
    $('.acc', card).disabled = true;
    try { await b.commit(); toast(adj.length ? `Stock take booked at ${l.loc}` : 'Stock take accepted – no changes'); }
    catch (e) { toast('Not accepted: ' + e.message, 5000); $('.acc', card).disabled = false; }
    return;
  }
  const send = lines.filter(x => x.q > 0);
  if (!send.length) return toast('Nothing to accept – all quantities are 0');
  const changed = send.length !== l.lines.length || send.some(x => x.q !== l.lines.find(y => y.i === x.i)?.q);
  const short = l.donation ? [] : send.filter(x => qty(l.from, x.i) < x.q).map(x => x.i);
  if (short.length && !confirmBox(`${l.from} doesn't have enough of: ${short.join(', ')}. Accept anyway? (stock there will go below zero)`)) return;
  $('.acc', card).disabled = true;
  try {
    if (l.donation) {
      // the items come in to the "Donation" location, then go straight out to the food bank
      ids.push(addMovement(b, { type: 'donation', note: `Donation - direct to ${l.to}${l.donor ? ' from ' + l.donor : ''}`, date, lines: send.map(x => ({ l: 'Donation', i: x.i, q: x.q })), extra: { from: l.donor || '', listId: l.id, listBy: l.by || '' } }));
      ids.push(addMovement(b, { type: 'transfer', note: 'Stock Transfer - direct donation', date, lines: send.flatMap(x => [{ l: 'Donation', i: x.i, q: -x.q }, { l: l.to, i: x.i, q: x.q }]), extra: { from: 'Donation', to: l.to, listId: l.id, listBy: l.by || '' } }));
      if (l.donor && !l.reopened) b.set(doc(db, 'config', 'donors'), { d: { [l.donor]: increment(1) } }, { merge: true });
    } else {
      ids.push(addMovement(b, { type: 'transfer', note: `Stock Transfer - shopping list from ${l.by || l.to}`, date, lines: send.flatMap(x => [{ l: l.from, i: x.i, q: -x.q }, { l: l.to, i: x.i, q: x.q }]), extra: { from: l.from, to: l.to, listId: l.id, listBy: l.by || '' } }));
    }
    b.update(doc(db, 'lists', l.id), { status: 'accepted', acceptedLines: send, changed, reason, decidedBy: S.name || 'Simon', decidedAt: serverTimestamp(), movementIds: ids });
    await b.commit();
    toast(l.donation ? `Donation booked in to ${l.to}` : `Transferred to ${l.to}`);
    if (!l.donation) deliveryNote({ date, from: l.from, to: l.to, note: `Shopping list from ${l.by}`, items: send.map(x => [x.i, x.q]), by: S.name });
  } catch (e) { toast('Not accepted: ' + e.message, 5000); $('.acc', card).disabled = false; }
}
async function rejectRequest(l, card) {
  const reason = norm($('.why', card).value);
  if (!reason) { $('.why', card).focus(); return toast('Add a note so the food bank knows why'); }
  try { await updateDoc(doc(db, 'lists', l.id), { status: 'rejected', reason, decidedBy: S.name || 'Simon', decidedAt: serverTimestamp() }); toast('Marked as not accepted'); }
  catch (e) { toast('Not saved: ' + e.message, 5000); }
}
// full details of a decided request, with Reopen (edit and accept again)
function requestModal(l) {
  if (!l) return;
  const acc = l.acceptedLines || [];
  const head = l.kind === 'stocktake' ? '<th>Counted</th><th>Accepted count</th>' : `<th>Asked for</th><th>${l.status === 'accepted' ? (l.donation ? 'Booked in' : 'Sent') : '–'}</th>`;
  const m = modal(`<h2>${reqKind(l)} – <span class="status ${l.status}">${STATUS[l.status]}</span></h2>
    <p>${reqWhere(l)}<br><span class="muted">From ${esc(l.by || '?')}${l.submittedAt ? ', sent ' + fmtTs(l.submittedAt) : ''}${l.donor ? ' · donated by ' + esc(l.donor) : ''}<br>
    ${l.status === 'accepted' ? 'Accepted' : 'Not accepted'} by ${esc(l.decidedBy || 'Simon')} ${l.decidedAt ? fmtTs(l.decidedAt) : ''}${l.reason ? ' – ' + esc(l.reason) : ''}${l.reopened ? `<br>Reopened ${l.reopened}× (last by ${esc(l.reopenedBy || '?')})` : ''}</span></p>
    <table><thead><tr><th>Item</th>${head}</tr></thead><tbody>${l.lines.map(x => { const a = acc.find(y => y.i === x.i); return `<tr><td>${esc(x.i)}</td><td>${x.q}</td><td>${l.status === 'accepted' ? (a ? a.q : 0) : ''}</td></tr>`; }).join('')}</tbody></table>
    <p class="small muted">${l.status === 'accepted' && (l.movementIds || []).length ? 'Reopening undoes the stock booked when it was accepted, then puts it back in Requests so you can change it and accept it again.' : 'Reopening puts it back in Requests so you can change it and accept it.'}</p>
    <p class="noprint"><button class="btn y" id="rqReopen">Reopen to edit</button></p>`);
  $('#rqReopen', m).onclick = async () => {
    if (!confirmBox(l.status === 'accepted' && (l.movementIds || []).length ? 'Reopen this request? The stock booked when it was accepted will be undone first.' : 'Reopen this request?')) return;
    $('#rqReopen', m).disabled = true;
    try {
      const b = writeBatch(db);
      for (const id of (l.status === 'accepted' ? (l.movementIds || []) : [])) {
        const mv = await getDoc(doc(db, 'movements', id));
        if (!mv.exists() || mv.data().voided) continue;   // already undone in History
        b.set(doc(db, 'movements', id), { voided: true, voidedBy: (S.name || 'Simon') + ' (reopened request)', voidedAt: serverTimestamp() }, { merge: true });
        applyStock(b, mv.data().lines, -1);
      }
      b.update(doc(db, 'lists', l.id), { status: 'submitted', reopened: increment(1), reopenedBy: S.name || 'Simon', reopenedAt: serverTimestamp() });
      await b.commit();
      toast('Reopened – it is back in Requests'); closeModal();
    } catch (e) { toast('Not reopened: ' + e.message, 5000); $('#rqReopen', m).disabled = false; }
  };
}

// ---------- footer: suggestions + version history ----------
$('#btnVersions').onclick = () => modal(`<h2>Version history</h2>${VERSION_HISTORY.map(([v, d, xs]) => `<h3>v${v} – ${d}</h3><ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}`);
$('#btnSuggest').onclick = () => {
  const m = modal(`<h2>Suggest a feature</h2><p class="muted">Ideas and problems go to the app's builder.</p><label>Your suggestion<textarea id="sg" rows="8" maxlength="10000"></textarea></label><p class="small muted" id="sgN">Up to 10,000 characters.</p><p><button class="btn" id="sgSend">Send</button></p>`);
  $('#sg', m).oninput = e => { $('#sgN', m).textContent = `${e.target.value.length.toLocaleString()} of 10,000 characters`; };
  $('#sgSend', m).onclick = async () => {
    const t = $('#sg', m).value.trim(); if (!t) return; if (t.length > 10000) return toast(`Too long – ${t.length} characters, the limit is 10,000. Please split it into two.`, 5000);
    try { await addDoc(collection(db, 'suggestions'), { text: t, name: S.name || '', ver: APP_VERSION + ' web', uid, created: serverTimestamp(), status: 'new' }); toast('Thanks – suggestion sent'); closeModal(); }
    catch (e) { toast('Not sent: ' + e.message, 5000); }
  };
};

// ---------- one-off import of the spreadsheet data (run by the builder from the browser console) ----------
window.FBM = {
  async importSeed(seed, { force = false } = {}) {
    const meta = await getDoc(doc(db, 'config', 'meta'));
    if (meta.exists() && meta.data().imported && !force) throw new Error('Already imported on ' + meta.data().importedAt);
    const locMap = {};
    seed.locations.forEach((n, k) => { const d = DEFAULT_LOCATIONS.find(x => x.n === n) || { kind: 'other', site: '', addr: '' }; locMap[n] = { kind: d.kind, site: d.site, addr: d.addr, a: true, o: k }; });
    await setDoc(doc(db, 'config', 'locations'), { l: locMap });
    await setDoc(doc(db, 'config', 'items'), { i: Object.fromEntries(seed.items.map(n => [n, { a: true }])) });
    const donors = {};
    seed.movements.forEach(m => { const mm = /^(?:community\s+)?donation\s*-\s*(.+)$/i.exec(m.note); if (mm) donors[mm[1].trim()] = (donors[mm[1].trim()] || 0) + 1; });
    await setDoc(doc(db, 'config', 'donors'), { d: donors });
    let b = writeBatch(db), n = 0, done = 0;
    for (const [loc, q] of Object.entries(seed.stock)) { b.set(doc(db, 'stock', slug(loc)), { loc, q }); n++; }
    for (const m of seed.movements) {
      const lines = m.lines.map(([l, i, q]) => ({ l, i, q }));
      const extra = {};
      if (m.type === 'transfer') { const neg = [...new Set(lines.filter(x => x.q < 0).map(x => x.l))]; const pos = [...new Set(lines.filter(x => x.q > 0).map(x => x.l))]; if (neg.length === 1) extra.from = neg[0]; if (pos.length) extra.to = pos.join(', '); }
      b.set(doc(collection(db, 'movements')), { date: m.date, type: m.type, note: m.note, lines, locs: [...new Set(lines.map(x => x.l))], by: '', imported: true, uid, created: serverTimestamp(), ...extra });
      if (++n >= 400) { await b.commit(); done += n; console.log('import', done); b = writeBatch(db); n = 0; }
    }
    if (n) { await b.commit(); done += n; }
    await setDoc(doc(db, 'config', 'meta'), { imported: true, importedAt: new Date().toISOString(), movements: seed.movements.length, source: 'Inventory Latest.xlsx' });
    return { written: done, movements: seed.movements.length };
  }
};

// ---------- start ----------
initIn(); initTransfer(); initTake(); initOut(); initHistory();
refresh();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
