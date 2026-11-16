/* The dealership screen: the classes two to a row, then a class's cars; typing searches every class. The picked car
   fills the stage; Buy opens checkout. Plain script, no build step: a worked example of building on whip.
   Nothing here decides anything that matters: prices are the server's, and buying sends a model name and a way to
   pay, never an amount. */

const RESOURCE = (typeof GetParentResourceName === 'function') ? GetParentResourceName() : 'whip_dealership';

/* ---- resolution scaling: --res-scale = window height / 1440 (see --ui-scale in the stylesheet) ---- */
(function () {
    function applyScale() {
        document.documentElement.style.setProperty('--res-scale', window.innerHeight / 1440);
    }
    applyScale();
    window.addEventListener('resize', applyScale);
})();

/* NUI callbacks are served from https://<resource>/, the page from https://cfx-nui-<resource>/. */
function nui(name, data) {
    return fetch(`https://${RESOURCE}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(data || {}),
    }).catch(() => {});
}

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

const CLASS_NAMES = {
    0: 'Compacts', 1: 'Sedans', 2: 'SUVs', 3: 'Coupes', 4: 'Muscle', 5: 'Sports Classics',
    6: 'Sports', 7: 'Super', 8: 'Motorcycles', 9: 'Off-road', 10: 'Industrial', 11: 'Utility',
    12: 'Vans', 13: 'Cycles', 14: 'Boats', 15: 'Helicopters', 16: 'Planes', 17: 'Service',
    18: 'Emergency', 19: 'Military', 20: 'Commercial', 22: 'Open Wheel',
};
// One of a class, for a car's own line ("Super", "Sedan").
const CLASS_ONE = {
    0: 'Compact', 1: 'Sedan', 2: 'SUV', 3: 'Coupe', 4: 'Muscle', 5: 'Sports Classic', 6: 'Sports',
    7: 'Super', 8: 'Motorcycle', 9: 'Off-road', 10: 'Industrial', 11: 'Utility', 12: 'Van',
    13: 'Cycle', 14: 'Boat', 15: 'Helicopter', 16: 'Plane', 17: 'Service', 18: 'Emergency',
    19: 'Military', 20: 'Commercial', 22: 'Open Wheel',
};
const className = (c) => CLASS_NAMES[c] || 'Other';
const classOne = (c) => CLASS_ONE[c] || 'Vehicle';

// whip_autos' type order: fast cars first; classes it does not list go on the end.
const CLASS_ORDER = [7, 6, 5, 4, 3, 1, 0, 2, 9, 8, 22, 12, 11, 10, 20, 17, 18, 19, 14, 15, 16];

/* ---- state ---------------------------------------------------------------- */

const state = {
    vehicles: [],      // [ { model, name, class, image, price, stats? } ], from the server
    accounts: [],      // [ { accountId, label, accountNumber, balance } ] the player may pay from
    cash: 0,
    view: 'types',     // 'types', or 'list' (one class's cars)
    cls: null,         // the class on show
    query: '',         // non-empty searches every class
    sort: 'price',     // 'price', 'name' or 'speed'
    picked: null,      // the car on the stage (a vehicles entry)
    typeCursor: -1,    // keyboard place on the classes, kept while a class is open
    searchLit: false,  // on a pad: the D-pad is on the search bar (padPress)
    best: {},          // the best of each stat on the lot, for the bars
    paying: false,     // one order at a time
};

let rows = [];          // the list as drawn: classes (numbers) or cars
let cursor = -1;        // keyboard row in the list
let payTimer = null;

const $ = (id) => document.getElementById(id);

function make(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

/* ---- what is on show ------------------------------------------------------ */

function classOrder() {
    const present = new Set(state.vehicles.map((v) => v.class));
    const known = CLASS_ORDER.filter((c) => present.has(c));
    const rest = [...present].filter((c) => !CLASS_ORDER.includes(c)).sort((a, b) => a - b);
    return known.concat(rest);
}

function sorted(list) {
    const out = list.slice();
    if (state.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (state.sort === 'speed') {
        out.sort((a, b) => ((b.stats && b.stats.speed) || 0) - ((a.stats && a.stats.speed) || 0) || a.price - b.price);
    } else out.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    return out;
}

function shown() {
    const q = state.query.trim().toLowerCase();
    if (q) return sorted(state.vehicles.filter((v) => v.name.toLowerCase().includes(q) || v.model.includes(q)));
    if (state.view === 'list') return sorted(state.vehicles.filter((v) => v.class === state.cls));
    return null;
}

/* ---- drawing -------------------------------------------------------------- */

const GLYPH_KEYS = {
    types: ['<kbd>arrows</kbd> move', '<kbd>enter</kbd> open', 'type to search', '<kbd>esc</kbd> leave'],
    list:  ['<kbd>↑</kbd><kbd>↓</kbd> browse', '<kbd>enter</kbd> buy', '<kbd>esc</kbd> back'],
};

// On a controller: the pad's buttons, whip's own pictures of them (whip_core html/img/pad).
const padImg = (n) => `<img class="pad-g" src="https://cfx-nui-whip_core/html/img/pad/${n}.svg" alt="">`;
const PAD_KEYS = {
    types: [padImg('dpad') + ' move', padImg('a') + ' open', padImg('y') + ' search', padImg('b') + ' leave'],
    list:  [padImg('dpad') + ' browse', padImg('a') + ' buy', padImg('x') + ' sort', padImg('y') + ' search', padImg('b') + ' back'],
    bar:   [padImg('a') + ' type a name', padImg('dpad_down') + ' back to the list', padImg('b') + ' back'],
};
let padOn = false;   // a controller is driving the page (client/main.lua says so)

function renderHint(view) {
    const keys = padOn ? PAD_KEYS : GLYPH_KEYS;
    const set = padOn && state.searchLit ? keys.bar : view === 'types' ? keys.types : keys.list;
    $('hint').innerHTML = set.map((h) => `<span>${h}</span>`).join('');
}

function render() {
    const q = state.query.trim();
    const list = shown();
    const view = q ? 'search' : state.view;

    // ---- the head ----
    $('back').hidden = view === 'types';
    if (view === 'types') {
        $('title').textContent = 'Dealership';
        $('sub').textContent = `${state.vehicles.length} ${state.vehicles.length === 1 ? 'car' : 'cars'} for sale`;
    } else if (view === 'list') {
        $('title').textContent = className(state.cls);
        $('sub').textContent = `${list.length} ${list.length === 1 ? 'car' : 'cars'} · from ${money(list.length ? Math.min(...list.map((v) => v.price)) : 0)}`;
    } else {
        $('title').textContent = 'Search';
        $('sub').textContent = list.length === 1 ? '1 car matches' : `${list.length} cars match`;
    }
    $('cash').textContent = money(state.cash);

    // ---- the sort keys, for a list only ----
    $('sort').hidden = view === 'types';
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.sort === state.sort));

    // ---- the list ----
    const box = $('list');
    const top = box.scrollTop;
    box.innerHTML = '';
    box.classList.toggle('grid', view === 'types');

    if (view === 'types') {
        rows = classOrder();
        cursor = state.typeCursor;
        rows.forEach((cls, i) => {
            const cars = state.vehicles.filter((v) => v.class === cls);
            const t = make('div', 'type');
            t.setAttribute('role', 'option');
            t.append(make('span', 'type-name', className(cls)),
                     make('span', 'type-count', `${cars.length} · from ${money(Math.min(...cars.map((v) => v.price)))}`));
            t.addEventListener('click', () => openClass(cls));
            if (i === cursor && !state.searchLit) t.classList.add('cursor');   // the bar has the D-pad instead
            box.appendChild(t);
        });
    } else if (!list.length) {
        rows = [];
        cursor = -1;
        box.appendChild(make('p', 'empty', 'No car by that name. Part of it is enough — "zen" finds the Zentorno.'));
    } else {
        rows = list;
        cursor = state.picked ? list.indexOf(state.picked) : -1;
        list.forEach((v) => {
            const row = make('div', 'row');
            row.setAttribute('role', 'option');
            if (v === state.picked) { row.classList.add('selected'); row.setAttribute('aria-selected', 'true'); }

            const shot = make('span', 'row-shot');
            const img = make('img');
            img.loading = 'lazy';
            img.alt = '';
            img.src = v.image || '';
            shot.appendChild(img);

            row.append(shot, make('span', 'row-name', v.name));
            if (view === 'search') row.appendChild(make('span', 'row-tag', classOne(v.class)));
            row.appendChild(make('span', 'row-price', money(v.price)));
            row.title = v.model;
            row.addEventListener('click', () => pick(v, false));
            row.addEventListener('dblclick', () => { pick(v, false); openCheckout(); });
            box.appendChild(row);
        });
    }
    box.scrollTop = top;

    $('search').classList.toggle('pad-lit', padOn && state.searchLit);
    renderHint(view);

    renderStage();
}

// The stage: the picked car, or how to start.
function renderStage() {
    const v = state.picked;
    $('stage-empty').hidden = !!v;
    $('car').hidden = !v;
    if (!v) {
        $('stage-empty-note').textContent = `${state.vehicles.length} cars in ${classOrder().length} classes, cheapest ${money(Math.min(...state.vehicles.map((x) => x.price)))}`;
        return;
    }

    const img = $('car-img');
    if (img.dataset.model !== v.model) {
        img.dataset.model = v.model;
        img.src = v.image || '';
        img.alt = v.name;
        img.classList.remove('swap');
        void img.offsetWidth;
        img.classList.add('swap');
    }

    $('car-name').textContent = v.name;
    const seats = v.stats && v.stats.seats;
    $('car-meta').textContent = [classOne(v.class), seats ? `${seats} ${seats === 1 ? 'seat' : 'seats'}` : null]
        .filter(Boolean).join(' · ');
    $('car-price').textContent = money(v.price);
    $('buy').textContent = `Buy — ${money(v.price)}`;
    $('buy').disabled = state.paying;

    // ---- the bars, against the best on the lot ----
    const dl = $('stats');
    dl.innerHTML = '';
    const s = v.stats;
    dl.hidden = !s;
    if (!s) return;
    const best = state.best;
    const rate = (k) => (best[k] ? Math.max(0, Math.min(1, s[k] / best[k])) : 0);
    [
        ['Top speed', 'speed', `${Math.round(s.speed)} km/h`],
        ['Acceleration', 'accel', (rate('accel') * 10).toFixed(1)],
        ['Braking', 'braking', (rate('braking') * 10).toFixed(1)],
        ['Traction', 'traction', (rate('traction') * 10).toFixed(1)],
    ].forEach(([label, key, text]) => {
        const stat = make('div', 'stat');
        const topRow = make('div', 'stat-top');
        topRow.append(make('dt', null, label), make('dd', null, text));
        const bar = make('div', 'bar');
        const fill = make('div', 'bar-fill');
        fill.style.transform = 'scaleX(0)';
        bar.appendChild(fill);
        stat.append(topRow, bar);
        dl.appendChild(stat);
        // A frame later, so the bar grows from its last width rather than appearing full.
        requestAnimationFrame(() => { fill.style.transform = `scaleX(${rate(key)})`; });
    });
}

/* ---- moving around -------------------------------------------------------- */

function pick(v, fromKeys) {
    state.picked = v;
    render();
    if (fromKeys) {
        const row = $('list').children[cursor];
        if (row) row.scrollIntoView({ block: 'nearest' });
    }
}

function openClass(cls) {
    state.typeCursor = classOrder().indexOf(cls);
    state.view = 'list';
    state.cls = cls;
    $('list').scrollTop = 0;
    render();
}

// Back one step: out of a search, then out of a class.
function back() {
    if (state.query.trim()) {
        state.query = '';
        $('search').value = '';
    } else if (state.view === 'list') {
        state.view = 'types';
    } else {
        return false;
    }
    $('list').scrollTop = 0;
    render();
    const t = $('list').children[state.typeCursor];
    if (t) t.scrollIntoView({ block: 'nearest' });
    return true;
}

// One step, stopping at the ends. From no cursor, ↓ goes to the top and ↑ to the bottom.
function stepFrom(from, n, d) {
    if (!n) return -1;
    if (from < 0) return d > 0 ? 0 : n - 1;
    return Math.max(0, Math.min(n - 1, from + d));
}

/* ---- checkout ------------------------------------------------------------- */

function balanceOf(a) { return Number(a && a.balance) || 0; }

function openCheckout() {
    const v = state.picked;
    if (!v || state.paying) return;

    $('co-img').src = v.image || '';
    $('co-name').textContent = v.name;
    $('co-class').textContent = classOne(v.class);
    $('co-price').textContent = money(v.price);
    $('co-total').textContent = money(v.price);
    $('co-cash').textContent = money(state.cash);
    status(null);
    $('accounts').hidden = true;
    $('pay-bank').classList.remove('on');
    refreshTiles();

    $('checkout').hidden = false;
    // The first way that can pay gets the keyboard.
    const first = [$('pay-cash'), $('pay-bank')].find((b) => !b.disabled);
    if (first) first.focus();
}

function closeCheckout() {
    if (state.paying) return;   // an order in flight finishes before the card can go
    $('checkout').hidden = true;
}

// Cash and Bank: what each can do for this price.
function refreshTiles() {
    const v = state.picked;
    if (!v) return;
    const price = v.price;

    const cash = $('pay-cash');
    const cashShort = state.cash < price;
    cash.disabled = state.paying || cashShort;
    cash.classList.toggle('short', cashShort);
    $('pay-cash-note').textContent = cashShort ? `${money(price - state.cash)} short` : 'From your pockets or wallet';

    const bank = $('pay-bank');
    const accts = state.accounts;
    let note, short = false, can = true;
    if (!accts.length) { note = 'No bank account'; can = false; }
    else if (accts.length === 1) {
        const a = accts[0];
        short = balanceOf(a) < price;
        can = !short;
        note = short ? `${money(price - balanceOf(a))} short` : `${a.label} · ${money(balanceOf(a))}`;
    } else {
        can = accts.some((a) => balanceOf(a) >= price);
        short = !can;
        note = can ? `Choose from ${accts.length} accounts` : 'No account has enough';
    }
    bank.disabled = state.paying || !can;
    bank.classList.toggle('short', short);
    $('pay-bank-note').textContent = note;
}

function showAccounts() {
    const list = $('account-list');
    list.innerHTML = '';
    const price = state.picked ? state.picked.price : 0;
    state.accounts.forEach((a) => {
        const b = make('button', 'account');
        b.setAttribute('role', 'option');
        b.disabled = state.paying || balanceOf(a) < price;
        b.append(make('span', 'account-name', a.label),
                 make('span', 'account-num', a.accountNumber || ''),
                 make('span', 'account-bal', money(balanceOf(a))));
        b.addEventListener('click', () => pay('bank', a.accountId));
        list.appendChild(b);
    });
    $('accounts').hidden = false;
    $('pay-bank').classList.add('on');
    const first = list.querySelector('.account:not(:disabled)');
    if (first) first.focus();
}

function status(text, bad) {
    const el = $('co-status');
    el.hidden = !text;
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
}

function pay(method, accountId) {
    const v = state.picked;
    if (!v || state.paying) return;
    // Latch before posting, so a second click can't send a second order.
    state.paying = true;
    refreshTiles();
    document.querySelectorAll('.account').forEach((b) => { b.disabled = true; });
    $('co-keep').disabled = true;
    status('Doing the paperwork…');
    nui('dealershipBuy', { model: v.model, payment: method, accountId: accountId || 0 });
    // The server always answers; if the answer is lost, unlatch after 15 s.
    clearTimeout(payTimer);
    payTimer = setTimeout(() => unlatch('No answer from the dealership. Nothing was charged — try again.'), 15000);
}

function unlatch(reason) {
    clearTimeout(payTimer);
    state.paying = false;
    $('co-keep').disabled = false;
    refreshTiles();
    if (!$('accounts').hidden) showAccounts();
    if (reason) status(reason, true);
    renderStage();
}

/* ---- open and close ------------------------------------------------------- */

function open(data) {
    state.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
    state.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    state.cash = Number(data.cash) || 0;
    state.view = 'types';
    state.cls = null;
    state.query = '';
    state.sort = 'price';
    state.picked = null;
    state.typeCursor = -1;
    state.searchLit = false;
    state.paying = false;
    clearTimeout(payTimer);

    // The best of each stat on the lot, so a bar reads "against everything for sale here".
    state.best = {};
    state.vehicles.forEach((v) => {
        const s = v.stats;
        if (!s) return;
        ['speed', 'accel', 'braking', 'traction'].forEach((k) => {
            if (Number(s[k]) > (state.best[k] || 0)) state.best[k] = Number(s[k]);
        });
    });

    $('search').value = '';
    $('checkout').hidden = true;
    $('co-keep').disabled = false;
    $('car-img').dataset.model = '';
    $('list').scrollTop = 0;
    render();

    const root = $('dealer');
    root.setAttribute('aria-hidden', 'false');
    root.classList.add('open');
}

function close(tellLua) {
    const root = $('dealer');
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    if (document.activeElement) document.activeElement.blur();
    clearTimeout(payTimer);
    state.paying = false;
    if (tellLua !== false) nui('dealershipClose', {});
}

/* ---- input ---------------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
    if (!$('dealer').classList.contains('open')) return;
    const k = e.key;

    // The search box keeps its keys; Escape clears it, then lets go of it. ↓ or Enter go to the results.
    if (e.target === $('search')) {
        if (k === 'Escape') {
            if ($('search').value) { $('search').value = ''; state.query = ''; render(); }
            else $('search').blur();
            e.preventDefault();
        } else if (k === 'ArrowDown' || k === 'Enter') {
            $('search').blur();
            if (rows.length && typeof rows[0] === 'object') pick(rows[0], true);
            e.preventDefault();
        }
        return;
    }

    // Checkout owns the keys while it is up.
    if (!$('checkout').hidden) {
        if (k === 'Escape' || k === 'Backspace') {
            if (!$('accounts').hidden && !state.paying) {
                $('accounts').hidden = true;
                $('pay-bank').classList.remove('on');
                $('pay-bank').focus();
            } else closeCheckout();
            e.preventDefault();
        }
        return;
    }

    const view = state.query.trim() ? 'search' : state.view;

    if (view === 'types') {
        const d = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : k === 'ArrowDown' ? 2 : k === 'ArrowUp' ? -2 : 0;
        if (d) {
            const n = rows.length;
            state.typeCursor = state.typeCursor < 0 ? 0 : Math.max(0, Math.min(n - 1, state.typeCursor + d));
            render();
            const t = $('list').children[state.typeCursor];
            if (t) t.scrollIntoView({ block: 'nearest' });
            e.preventDefault();
            return;
        }
        if (k === 'Enter') {
            const cls = rows[Math.max(0, state.typeCursor)];
            if (cls !== undefined) openClass(cls);
            e.preventDefault();
            return;
        }
        if (k === 'Escape') { close(); e.preventDefault(); return; }
    } else {
        if (k === 'ArrowDown' || k === 'ArrowUp') {
            const i = stepFrom(cursor, rows.length, k === 'ArrowDown' ? 1 : -1);
            if (i >= 0 && rows[i] !== state.picked) pick(rows[i], true);
            e.preventDefault();
            return;
        }
        if (k === 'Enter') { openCheckout(); e.preventDefault(); return; }
        if (k === 'Escape' || k === 'ArrowLeft' || k === 'Backspace') { back(); e.preventDefault(); return; }
    }

    // Typing anywhere starts a search: the key lands in the box.
    if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && k !== ' ') $('search').focus();
});

$('search').addEventListener('input', () => {
    state.query = $('search').value;
    $('list').scrollTop = 0;
    render();
});

document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    $('list').scrollTop = 0;
    render();
}));

$('back').addEventListener('click', back);
$('close').addEventListener('click', () => close());
$('buy').addEventListener('click', openCheckout);
$('co-keep').addEventListener('click', closeCheckout);
$('pay-cash').addEventListener('click', () => pay('cash', 0));
$('pay-bank').addEventListener('click', () => {
    if (state.accounts.length === 1) pay('bank', state.accounts[0].accountId);
    else showAccounts();
});
// Clicking the dim outside the card closes it.
$('checkout').addEventListener('click', (e) => { if (e.target === $('checkout')) closeCheckout(); });

/* ---- a controller ----
   The pad is read in Lua (client/main.lua) and arrives as 'pad' presses, which are the keys above (D-pad or left stick
   the arrows, A Enter, B Esc). Besides: X steps the sort, Y types a search on whip's keyboard (dealershipType), and in
   checkout the D-pad walks the ways to pay and A pays. */

const PAD_KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'Enter', b: 'Escape' };
const SORTS = ['price', 'name', 'speed'];

function key(k) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

/** Checkout's buttons in order: the ways to pay, the accounts (when shown), Keep browsing. */
function checkoutButtons() {
    return [$('pay-cash'), $('pay-bank'), ...$('account-list').querySelectorAll('.account'), $('co-keep')]
        .filter((b) => b && !b.disabled && b.offsetParent !== null);
}

function checkoutPad(cmd) {
    if (cmd === 'b') { key('Escape'); return; }
    const items = checkoutButtons();
    const at = items.indexOf(document.activeElement);
    if (cmd === 'a') {
        if (at >= 0) items[at].click(); else if (items[0]) items[0].focus();
        return;
    }
    const d = (cmd === 'down' || cmd === 'right') ? 1 : (cmd === 'up' || cmd === 'left') ? -1 : 0;
    if (!d || !items.length) return;
    items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + d))].focus();
}

/** The D-pad onto the search bar, or off it. */
function lightSearch(on) {
    state.searchLit = on;
    render();
}

function padPress(cmd) {
    if (!$('dealer').classList.contains('open')) return;
    if (!$('checkout').hidden) { checkoutPad(cmd); return; }
    const view = state.query.trim() ? 'search' : state.view;
    // The search bar is on the D-pad too (Josh, 9 Nov 2026: the D-pad could not reach it): ↑ from the top row
    // lights it, A on it types on whip's keyboard, ↓ or B go back to the list. Y still searches from anywhere.
    if (state.searchLit) {
        if (cmd === 'a') { nui('dealershipType', { value: state.query }); return; }
        if (cmd === 'down' || cmd === 'b') {
            lightSearch(false);
            // ↓ lands on the list: the first class or car, if nothing there had the D-pad yet
            if (cmd === 'down' && view === 'types' && state.typeCursor < 0) { state.typeCursor = 0; render(); }
            else if (cmd === 'down' && view !== 'types' && cursor < 0) key('ArrowDown');
            return;
        }
        if (cmd === 'up' || cmd === 'left' || cmd === 'right') return;
    } else if (cmd === 'up' && (view === 'types' ? state.typeCursor < 2 : cursor <= 0)) {
        lightSearch(true);   // the top row (two classes to a row), or nothing picked yet
        return;
    }
    if (cmd === 'y') { nui('dealershipType', { value: state.query }); return; }
    if (cmd === 'x') {
        if (view === 'types') return;
        state.sort = SORTS[(SORTS.indexOf(state.sort) + 1) % SORTS.length];
        render();
        return;
    }
    if (cmd === 'a' && view !== 'types' && !state.picked) { key('ArrowDown'); return; }
    if (PAD_KEY[cmd]) key(PAD_KEY[cmd]);
}

function setPad(on) {
    padOn = !!on;
    if (!padOn) state.searchLit = false;   // the mouse and keyboard click or type into the box itself
    $('dealer').classList.toggle('pad', padOn);
    $('search').classList.toggle('pad-lit', padOn && state.searchLit);   // here too: this draws no list
    renderHint(state.query.trim() ? 'search' : state.view);
}

/* ---- messages from Lua ---------------------------------------------------- */

window.addEventListener('message', (event) => {
    const d = event.data || {};
    if (d.action === 'dealershipOpen') { open(d.data || {}); setPad(d.pad === true); }
    else if (d.action === 'dealershipClose') close(false);
    // A refused purchase: the reason stays on the card (whip's toast also shows it). A sale closes
    // the menu from Lua.
    else if (d.action === 'dealershipResult' && !d.ok) unlatch(d.message || 'That did not go through. Nothing was charged.');
    else if (d.action === 'pad') padPress(String(d.cmd || ''));
    else if (d.action === 'padDevice') setPad(d.pad === true);
    // What was typed on whip's keyboard: the search, and the first car it finds picked.
    else if (d.action === 'dealershipSearch' && typeof d.text === 'string') {
        $('search').value = d.text;
        state.query = d.text;
        state.searchLit = false;   // the D-pad goes to what it found
        $('list').scrollTop = 0;
        render();
        if (rows.length && typeof rows[0] === 'object') pick(rows[0], true);
    }
});
