'use strict';
const $ = s => document.querySelector(s), root = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = n => '₱' + Number(n).toLocaleString();
const tm = i => new Date(i).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
let me, menu = [], cat = 'All', q = '', slot = null, poll = null;
let soundOn = true, notes = [], unread = 0, lastNid = null, notifyUid = null, notifyBusy = false, panelOpen = false;

try {
    soundOn = localStorage.getItem('sound') !== 'off';
}
catch { }
let cart = {};
const ck = () => 'cart:' + (me ? me.id : 0); // every account has its own cart, even on a shared computer

const loadCart = () => {
    try {
        cart = JSON.parse(localStorage.getItem(ck()) || '{}');
    }
    catch {
        cart = {};
    }
};

const saveCart = () => {
    try {
        localStorage.setItem(ck(), JSON.stringify(cart));
    }
    catch { }
};

try {
    localStorage.removeItem('cart');
}
catch { }

const avatar = (u, c = '') => `<span class="av ${c}">${u.photo ? `<img src="${esc(u.photo)}" alt="Profile photo of ${esc(u.name)}">` : esc(ini(u.name))}</span>`;
const ini = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

async function api(u, m = 'GET', b) {
    const r = await fetch('/api' + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok)
        throw new Error(d.error || 'Request failed.');
    return d;
}

let tt;

const toast = m => {
    const t = $('#toast');
    t.textContent = m;
    t.classList.add('show');
    clearTimeout(tt);
    tt = setTimeout(() => t.classList.remove('show'), 2500);
};

const go = h => {
    location.hash = h;
};

let BASE = '';
api('/config').then(r => { BASE = r.base || ''; }).catch(() => { });

const qrUrl = c => (BASE || location.origin) + location.pathname + '#/scan/' + c; // QR content: opens this system when scanned by any camera app

const codeOf = s => {
    s = String(s || '').trim();
    const m = /CSPC\.\d{11}\.[\w-]{10}/.exec(s);
    return m ? m[0] : s;
};

const cartLines = () => Object.entries(cart).map(([id, n]) => ({ m: menu.find(x => x.id == id), n })).filter(l => l.m);

// items the staff deleted must disappear from the customer's cart too
const pruneCart = () => {
    let n = 0;
    for (const id of Object.keys(cart))
        if (!menu.some(x => x.id == id)) {
            delete cart[id];
            n++;
        }
    if (n) {
        saveCart();
        toast(n + (n > 1 ? ' items in your cart are' : ' item in your cart is') + ' no longer available and ' + (n > 1 ? 'were' : 'was') + ' removed.');
    }
};

const sub = () => cartLines().reduce((a, l) => a + l.m.price * l.n, 0);

const FEE = 5, TYPE = {
    student: 'Student',
    employee: 'Employee',
    instructor: 'Instructor',
    administrator: 'Administrator',
    staff: 'Cafeteria Staff'
};

const nav = () => me.role === 'staff' ? [
    ['staff', 'Dashboard', '▦'],
    ['staff/orders', 'Orders', '☰'],
    ['staff/queue', 'Preparation Queue', '⏱'],
    ['staff/scan', 'Scan QR', '▣'],
    ['staff/inventory', 'Inventory', '▤'],
    ['staff/reports', 'Reports', '▲'],
    ['staff/access', 'Access Code', '⚿'],
    ['staff/audit', 'Audit Log', '◈'],
    ['staff/profile', 'Profile', '☺']
]
    : [
        ['dashboard', 'Dashboard', '⌂'],
        ['menu', 'Menu', '☰'],
        ['orders', 'My Orders', '▤'],
        ['track', 'Order Tracking', '◎'],
        ['profile', 'Profile', '☺']
    ];

const seal = (s = 44) => `<img class="logo" src="img/cspc-logo.png" width="${s}" height="${Math.round(s * 1.04)}" alt="CSPC logo">`;

const shell = (body, act) => `<header class="hd">
          <div class="hd-in"><a class="bd" href="#/${me.role === 'staff' ? 'staff' : 'dashboard'}">${seal(44)}<span><b>CSPC Cafeteria</b><small>${me.role === 'staff' ? 'Staff Console' : 'Pre-Order System'}</small></span></a>
        <nav class="nav">${nav().map(([h, l, i]) => `<a class="nv ${act === h ? 'on' : ''}" href="#/${h}"><span>${i}</span><em>${l}</em></a>`).join('')}</nav>
        <div class="usr"><a class="who" href="#/${me.role === 'staff' ? 'staff/profile' : 'profile'}" title="My profile">${avatar(me)}<span class="wt"><b>${esc(me.name)}</b><small>${esc(me.email)}</small></span></a><button class="nbtn" data-act="notifs" aria-label="Notifications"><span class="nic">${IC.bell}</span><span>Notifications</span><i class="nbadge" ${unread ? '' : 'hidden'}>${unread > 99 ? '99+' : unread}</i></button><button class="lo" data-act="logout">Logout</button>
        </div>
        </div>
        </header>
        <main class="main">${body}</main>
        <footer class="ft">Camarines Sur Polytechnic Colleges &nbsp;|&nbsp; Cafeteria Pre-Order System &nbsp;|&nbsp; Version 1.1</footer>`;

const back = (h, t) => `<div class="top">
          <div class="row"><a href="#/${h}" aria-label="Back">←</a>
        <h1>${t}</h1>
        </div>
        </div>`;

const badge = s => `<span class="badge ${s}">${{ pending: 'Pending', preparing: 'Preparing', ready: 'Ready', claimed: 'Completed', cancelled: 'Cancelled' }[s]}</span>`;
const plate = b => `<ellipse cx="100" cy="108" rx="86" ry="84" fill="#0c4a6e" opacity=".14"/><circle cx="100" cy="100" r="86" fill="url(#pl)" stroke="#cfe3f1"/><circle cx="100" cy="100" r="66" fill="#fff" stroke="#e3eef7"/>${b}`;
const curl = (cx, cy, r, c, w = 5, n = 5) => Array.from({ length: n }, (_, i) => `<circle cx="${cx + (i % 2 ? 3 : -3)}" cy="${cy + (i % 3 - 1) * 2}" r="${r - i * (r / (n + 1))}" fill="none" stroke="${c}" stroke-width="${w}" opacity="${.95 - i * .05}"/>`).join('');

const ART = {
    none: plate(`<text x="100" y="98" text-anchor="middle" font-size="17" font-weight="600" fill="#587084" font-family="sans-serif">Photo</text><text x="100" y="120" text-anchor="middle" font-size="13" fill="#587084" font-family="sans-serif">coming soon</text>`),
    adobo: plate(`<circle cx="100" cy="100" r="56" fill="#3d1c0b"/><circle cx="100" cy="100" r="50" fill="#5a2a10"/>${[[78, 86, 20], [118, 84, -25], [86, 118, 35], [122, 116, -10], [100, 100, 60]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="22" ry="14" transform="rotate(${r} ${x} ${y})" fill="url(#ch)"/><ellipse cx="${x - 4}" cy="${y - 4}" rx="10" ry="4" transform="rotate(${r} ${x} ${y})" fill="#e0a063" opacity=".55"/>`).join('')}${[[60, 100], [140, 98], [100, 64], [102, 138], [70, 72]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#f4e2b0"/>`).join('')}<path d="M52 110q10-14 24-4-8 14-24 4z" fill="#6b8a35"/><path d="M130 70q14-4 18 10-14 6-18-10z" fill="#6b8a35"/>`),
    sinigang: plate(`<circle cx="100" cy="100" r="58" fill="#8a5a1d"/><circle cx="100" cy="100" r="52" fill="#d7a64a"/><circle cx="100" cy="100" r="44" fill="#e3b862" opacity=".7"/>${[[78, 80, 15], [122, 92, -30], [96, 124, 60]].map(([x, y, r]) => `<rect x="${x - 16}" y="${y - 11}" width="32" height="22" rx="8" transform="rotate(${r} ${x} ${y})" fill="#f0c3a6"/><rect x="${x - 16}" y="${y - 11}" width="32" height="8" rx="4" transform="rotate(${r} ${x} ${y})" fill="#fff0e4" opacity=".7"/>`).join('')}<path d="M70 106q14-20 30-4-8 20-30 4zM116 66q22 0 20 20-20 2-20-20z" fill="#3f8a3a"/><circle cx="128" cy="116" r="11" fill="#d6402c"/><circle cx="76" cy="62" r="9" fill="#e5533c"/><circle cx="100" cy="100" r="8" fill="#fff" opacity=".85"/>`),
    spaghetti: plate(`${curl(100, 104, 46, '#f0c44e', 6, 6)}<path d="M62 100q38-52 76 0-38 22-76 0z" fill="#c23b22"/><path d="M72 96q28-34 56 0-28 12-56 0z" fill="#d9482b"/>${[[86, 90], [104, 84], [116, 96], [96, 100], [80, 102]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#6e2616"/>`).join('')}${Array.from({ length: 9 }, (_, i) => `<path d="M${74 + i * 6} ${84 + (i % 3) * 5}l7 ${4 + i % 2 * 3}" stroke="#ffe9a6" stroke-width="2" stroke-linecap="round"/>`).join('')}<path d="M110 70q16-8 20 6-16 6-20-6z" fill="#3f8a3a"/>`),
    pancit: plate(`${curl(100, 100, 50, '#d9a066', 6, 7)}${curl(96, 106, 34, '#c98a4b', 5, 5)}${[[78, 84], [120, 92], [96, 126], [124, 120], [70, 112]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="6" fill="${i % 2 ? '#f08a24' : '#e9731a'}"/><circle cx="${x}" cy="${y}" r="2.5" fill="#fbc27a"/>`).join('')}<path d="M88 74q10-10 20 0-10 8-20 0zM60 100q8-12 18-2-10 8-18 2zM120 132q12-8 20 4-14 4-20-4z" fill="#8ab544"/><rect x="132" y="66" width="30" height="16" rx="8" transform="rotate(30 147 74)" fill="#e9d74a"/>`),
    tea: `<ellipse cx="100" cy="182" rx="46" ry="8" fill="#0c4a6e" opacity=".15"/><path d="M122 16l10 -4 6 -2" stroke="#e0527a" stroke-width="6" stroke-linecap="round"/><path d="M62 38h76l-9 140a8 8 0 01-8 7H79a8 8 0 01-8-7z" fill="url(#gl)" stroke="#bcd9ea" stroke-width="2"/><path d="M66 70h68l-6 108a8 8 0 01-8 7H79a8 8 0 01-8-7z" fill="url(#te)"/>${[[88, 82, -12], [112, 92, 14], [96, 118, 8], [116, 132, -10], [84, 150, 12]].map(([x, y, r]) => `<rect x="${x - 13}" y="${y - 13}" width="26" height="26" rx="5" transform="rotate(${r} ${x} ${y})" fill="#fff" opacity=".42" stroke="#fff" stroke-opacity=".7"/>`).join('')}<circle cx="132" cy="42" r="19" fill="#f7d84a" stroke="#e9b82a" stroke-width="2"/><path d="M132 42l0-17M132 42l16 6M132 42l-14 9M132 42l9 16M132 42l-12-13" stroke="#fff3a8" stroke-width="2"/><path d="M70 50q4 40 3 110" stroke="#fff" stroke-width="4" opacity=".5" stroke-linecap="round"/>`,
    rice: plate(`<ellipse cx="100" cy="110" rx="46" ry="30" fill="#d9e2e8"/><path d="M54 106q4-42 46-44 42 2 46 44-46 22-92 0z" fill="url(#ri)"/>${Array.from({ length: 46 }, (_, i) => {
        const a = i * 2.4, r = 8 + (i % 9) * 4.6;
        return `<ellipse cx="${100 + Math.cos(a) * r * 1.3}" cy="${88 + Math.sin(a) * r * .62}" rx="4.4" ry="1.9" transform="rotate(${i * 37 % 180} ${100 + Math.cos(a) * r * 1.3} ${88 + Math.sin(a) * r * .62})" fill="#fff" stroke="#e7ecef" stroke-width=".6"/>`;
    }).join('')}`),
    egg: plate(`<path d="M52 98c-6-26 18-40 38-34 18-12 46-2 50 20 14 14 4 40-16 42-12 14-38 14-50 2-18 2-30-12-22-30z" fill="#fffdf6" stroke="#ecdfc3" stroke-width="2"/><path d="M60 92c4-14 18-20 30-16" stroke="#f1e6cf" stroke-width="3" fill="none"/><circle cx="98" cy="100" r="22" fill="#f6a500"/><circle cx="98" cy="100" r="22" fill="url(#yk)"/><ellipse cx="90" cy="92" rx="7" ry="4" fill="#fff" opacity=".6"/><path d="M52 112q-8 6-2 12M142 106q6 6 2 12" stroke="#c98a1f" stroke-width="3" fill="none" opacity=".5"/>`),
    flan: plate(`<ellipse cx="100" cy="124" rx="62" ry="22" fill="#a65a12" opacity=".7"/><path d="M52 112c0-20 22-38 48-38s48 18 48 38c0 16-22 28-48 28s-48-12-48-28z" fill="url(#fl)"/><ellipse cx="100" cy="96" rx="40" ry="16" fill="#b8620f"/><ellipse cx="100" cy="94" rx="34" ry="12" fill="#d98a1f"/><ellipse cx="86" cy="90" rx="16" ry="4" fill="#fff" opacity=".35" transform="rotate(-8 86 90)"/>`)
};

const artKey = (c, n = '') => {
    n = n.toLowerCase();
    return /halo-halo|halo halo|turon|bottled water/.test(n) ? 'none' : /adobo|chicken|pork(?!.*sin)|menudo|afritada/.test(n) ? 'adobo' : /sinigang|soup|nilaga|tinola/.test(n) ? 'sinigang' : /spag|pasta|carbonara/.test(n) ? 'spaghetti' : /pancit|noodle|canton|bihon/.test(n) ? 'pancit' : /egg|itlog/.test(n) ? 'egg' : /rice|kanin/.test(n) ? 'rice' : /flan|leche|cake|halo|dessert/.test(n) || c === 'Dessert' ? 'flan' : /tea|juice|drink|coffee|water|soda|shake/.test(n) || c === 'Drinks' ? 'tea' : c === 'Snacks' ? 'pancit' : 'adobo';
};

const defs = `<defs><radialGradient id="pl" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#dcebf6"/></radialGradient><radialGradient id="ch" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#b9702f"/><stop offset="1" stop-color="#6e3412"/></radialGradient><linearGradient id="gl" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#d7ecf8" stop-opacity=".7"/></linearGradient><linearGradient id="te" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9892a"/><stop offset="1" stop-color="#8f4a0c"/></linearGradient><radialGradient id="ri" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e5ebef"/></radialGradient><radialGradient id="yk" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffd24d"/><stop offset="1" stop-color="#ee8f00"/></radialGradient><linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe29a"/><stop offset="1" stop-color="#e6b85c"/></linearGradient></defs>`;
const art = (c, n) => `<svg class="art" viewBox="0 0 200 200" role="img" aria-label="${esc(n)}" preserveAspectRatio="xMidYMid meet">${defs}${ART[artKey(c, n)]}</svg>`;
const thumb = (m, c = '') => `<div class="thumb ${c}">${m.img ? `<img src="${esc(m.img)}" alt="${esc(m.name)}" loading="lazy" data-cat="${esc(m.cat)}" data-name="${esc(m.name)}">` : art(m.cat, m.name)}</div>`;

// if a food photo file is missing, show the illustrated plate instead
document.addEventListener('error', e => {
    const t = e.target;
    if (t.tagName === 'IMG' && t.dataset.name) {
        const h = t.closest('.thumb,.lp-plate');
        if (h)
            h.innerHTML = art(t.dataset.cat, t.dataset.name);
    }
}, true);

/* ---------- Auth pages ---------- */
const hero = `<div class="hero">
          <div class="hero-in">${seal(112)}<div class="schl">CAMARINES SUR POLYTECHNIC COLLEGES</div>
        <div class="rule"></div>
        <h1>Cafeteria Pre-Order System</h1>
        <p class="tag">Order ahead. Pick up on time. Skip the line.</p>
        <ul class="perks">
          <li>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v7M4 3v5a3 3 0 006 0V3M7 11v10M17 21V3c-2.6 1.6-3.6 4.6-3.6 8H17"/></svg><b>Pre-order meals</b><span>Browse the menu and order online</span>
          </li>
          <li>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3M16 3v3M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM4 9.5h16M12 12.5v3l2 1.2"/></svg><b>Choose pickup time</b><span>Select a morning or afternoon slot</span>
          </li>
          <li>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h6v6H4zM7 7h0M14 4h6v6h-6zM17 7h0M4 14h6v6H4zM7 17h0M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/></svg><b>Claim with QR</b><span>Present your QR pass at the counter</span>
          </li>
        </ul>
        <p class="who-for">Open to CSPC students, employees, instructors, administrators and cafeteria staff</p>
        </div>
        </div>`;

/* SVG icons (same style as on regular websites, instead of emoji) */
const svg = (d, c = '') => `<svg class="ico ${c}" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const IC = {
    eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg('<path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 4.1-5M9.9 5.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M2 2l20 20"/>'),
    bell: svg('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    bellOff: svg('<path d="M8.7 3A6 6 0 0 1 18 8c0 2.6.4 4.6.9 6"/><path d="M17 17H3s3-2 3-9c0-.9.2-1.7.5-2.4"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M2 2l20 20"/>'),
    cook: svg('<path d="M6 14h12v3a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-3z"/><path d="M18 15h3"/><path d="M9 4c0 1.5 1.2 1.8 1.2 3.2M13 4c0 1.5 1.2 1.8 1.2 3.2"/>'),
    check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>'),
    bag: svg('<path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M9.5 14l2 2 3.5-4"/>'),
    receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>'),
    cancel: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>')
};

const pwField = (id, ph, ac) => `<div class="pw"><input id="${id}" type="password" placeholder="${ph}" autocomplete="${ac || 'new-password'}" required><button type="button" data-act="eye" aria-label="Show password">${IC.eye}</button>
        </div>`;

/* Sign in with Google (shown only when the server has GOOGLE_CLIENT_ID): the customer's name, email and photo come from their CSPC Google account */
let gcfg;

async function initGoogle() {
    try {
        if (gcfg === undefined)
            gcfg = (await api('/config')).googleClientId || '';
        if (!gcfg || !$('#gbtn'))
            return;
        if (!window.google || !google.accounts) {
            await new Promise((ok, no) => {
                const sc = document.createElement('script');
                sc.src = 'https://accounts.google.com/gsi/client';
                sc.async = true;
                sc.onload = ok;
                sc.onerror = no;
                document.head.appendChild(sc);
            });
        }
        google.accounts.id.initialize({ client_id: gcfg, callback: r => F.google(r.credential) });
        google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 300 });
        $('#gbox').hidden = false;
    }
    catch { }
}

function pLogin() {
    root.innerHTML = `<div class="auth">${hero}<div class="side">
          <form class="formbox" data-form="login">
            <div class="fb-h">
              <span class="eyebrow">Account Access</span>
              <h2>Sign In</h2>
              <p class="muted">Use your official CSPC email address. Customers and cafeteria staff sign in here.</p>
            </div>
            <label for="email">CSPC Email</label><input id="email" type="email" required autocomplete="username" placeholder="yourname@cspc.edu.ph"><label for="password">Password</label>${pwField('password', 'Enter your password', 'current-password')}<div class="err" id="err" role="alert"></div>
        <button class="btn">Sign In</button>
        <div class="or">
          <span>New to the system?</span>
        </div>
        <a class="btn ghost" href="#/register">Create an Account</a>
        <div id="gbox" hidden>
          <div class="or">
            <span>or</span>
          </div>
          <div id="gbtn"></div>
        </div>
        <details class="demo">
          <summary>Demo accounts (for evaluation)</summary>Customer: juan.delacruz@cspc.edu.ph / Student@123<br>Cafeteria staff: staff@cspc.edu.ph / Staff@123</details>
        </form>
        <p class="copy">
        <a href="#/">&larr; Back to home</a><br>&copy; Camarines Sur Polytechnic Colleges · Nabua, Camarines Sur</p>
        </div>
        </div>`;
    initGoogle();
}

function pRegister() {
    root.innerHTML = `<div class="auth">
          <div class="side">
            <form class="formbox wide" data-form="register">
              <div class="row">${seal(48)}<div>
          <b>CAMARINES SUR POLYTECHNIC COLLEGES</b>
          <div class="muted">Cafeteria Pre-Order System</div>
        </div>
        </div>
        <h2 style="margin-top:14px">Create Your Account</h2>
        <p class="muted">Set up your own profile using your CSPC email.</p>
 <label>I am a…</label>
        <div class="types">${['student', 'employee', 'instructor', 'administrator', 'staff'].map((t, i) => `<label class="type"><input type="radio" name="ut" value="${t}" ${i ? '' : 'checked'}><span>${TYPE[t]}</span></label>`).join('')}</div>
 <div id="staffbox" hidden>
        <label for="scode">Staff Access Code</label><input id="scode" type="password" autocomplete="off" placeholder="Given by the cafeteria staff">
        <p class="muted" id="scnote">Cafeteria staff accounts need an access code set by the cafeteria staff. Customers do not.</p>
        </div>
 <label for="name">Full Name</label><input id="name" required maxlength="60" autocomplete="name" placeholder="Juan Dela Cruz">
 <div class="g2">
        <div>
          <label for="idn">ID Number</label><input id="idn" required maxlength="20" placeholder="Student / Employee ID">
        </div>
        <div>
          <label for="contact">Contact No. <span class="opt">(optional)</span></label><input id="contact" type="tel" maxlength="20" autocomplete="tel" placeholder="09XX XXX XXXX">
        </div>
        </div>
 <label for="dept">Course / Department / Office <span class="opt">(optional)</span></label><input id="dept" maxlength="60" placeholder="e.g. BS Information Technology">
 <label for="email">CSPC Email</label><input id="email" type="email" required autocomplete="email" placeholder="yourname@cspc.edu.ph">
 <div class="g2">
        <div>
          <label for="password">Password</label>${pwField('password', '8+ chars, letters &amp; numbers')}</div>
        <div>
        <label for="password2">Confirm Password</label>${pwField('password2', 'Re-type password')}</div>
        </div>
 <div class="err" id="err" role="alert"></div>
        <button class="btn">Create Account</button>
        <p class="muted c">Already have an account? <a href="#/login">Sign in</a>
        </p>
        </form>
        </div>${hero}</div>`;
    initGoogle();
    api('/register-info').then(r => {
        const n = $('#scnote');
        if (n && !r.staffSignup)
            n.textContent = 'Cafeteria staff sign-up is currently closed. A current staff member must set the access code first.';
    }, () => { });
}

/* ---------- Student pages ---------- */
async function pDash() {
    const [m, s] = await Promise.all([api('/menu'), api('/slots')]);
    menu = m.menu;
    pruneCart();
    const h = new Date().getHours(), open = h >= 7 && h < 19, left = s.slots.filter(x => !x.past && x.left > 0).length, meals = menu.reduce((a, x) => a + x.stock, 0);
    root.innerHTML = shell(`<div class="top">
          <div>
            <div class="muted">Good ${h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening'},</div>
        <h1>${esc(me.name)}</h1>
        </div>
        </div>
 <section class="status ${open ? 'open' : ''}"><span class="lbl">Today's Cafeteria Status</span>
        <h2>
          <i class="dot"></i>${open ? 'Open' : 'Closed'}</h2>
        <span class="hrs">Daily, 7:00 AM – 7:00 PM</span>
        </section>
 <div class="stats">
        <div class="card stat">
        <b>${meals}</b><span class="muted">Available Meals</span>
        </div>
        <div class="card stat">
        <b>12 min</b><span class="muted">Avg. Prep Time</span>
        </div>
        <div class="card stat">
        <b>${left}</b><span class="muted">Pickup Slots Left</span>
        </div>
        </div>
 <div class="top">
        <h2>Today's Menu</h2>
        <a href="#/menu">View All</a>
        </div>
        <div class="grid3">${menu.slice(0, 3).map(card).join('')}</div>`, 'dashboard');
}

const card = m => `<a class="card" href="#/food/${m.id}" style="color:inherit">${thumb(m)}<b>${esc(m.name)}</b>
        <div class="price">${peso(m.price)}</div><div class="${m.stock ? 'stk-in' : 'stk-out'} muted">${m.stock ? 'Available: ' + m.stock : 'Out of stock'}</div>
        </a>`;

const menuRow = m => `<div class="card item"><a href="#/food/${m.id}">${thumb(m)}</a>
        <div class="grow">
        <b>${esc(m.name)}</b>
        <div class="price">${peso(m.price)}</div>
        <div class="muted">${esc(m.desc)}</div>
        </div><button class="btn sm" data-act="add" data-id="${m.id}" ${m.stock ? '' : 'disabled'}>${m.stock ? 'Add' : 'Sold out'}</button>
        </div>`;

const grid = () => {
    const l = menu.filter(m => (cat === 'All' || m.cat === cat) && m.name.toLowerCase().includes(q.toLowerCase()));
    return l.length ? l.map(menuRow).join('') : '<p class="muted">No items found. Try another category or search.</p>';
};

async function pMenu() {
    menu = (await api('/menu')).menu;
    pruneCart();
    root.innerHTML = shell(`<h1>Our Menu</h1><input id="q" placeholder="Search for food..." value="${esc(q)}" aria-label="Search"><div class="chips">${['All', 'Main Dish', 'Snacks', 'Drinks', 'Dessert'].map(c => `<button class="chip ${c === cat ? 'on' : ''}" data-act="cat" data-v="${c}">${c}</button>`).join('')}</div>
        <div id="grid">${grid()}</div>${Object.keys(cart).length ? `<a class="btn" href="#/cart" style="margin-top:12px">View Cart (${Object.values(cart).reduce((a, b) => a + b, 0)})</a>` : ''}`, 'menu');
}

async function pFood(id) {
    menu = (await api('/menu')).menu;
    pruneCart();
    const m = menu.find(x => x.id == id);
    if (!m)
        return go('/menu');
    root.innerHTML = shell(`<div class="card" style="padding:0;overflow:hidden">${thumb(m, 'big')}<div style="padding:16px">
          <div class="row sp">
            <h1>${esc(m.name)}</h1>
        <h2>${peso(m.price)}</h2>
        </div>
        <div>⭐ ${m.rating}</div>
        <p class="muted">${esc(m.desc)}</p>
        <div class="row">
        <span>Available: ${m.stock}</span><span>Prep Time: ${m.prep} min</span>
        </div>
        <h3 style="margin-top:12px">Ingredients</h3>
        <p class="muted">${esc(m.ing)}</p>
        <h3>Allergens</h3>
        <p class="muted">${esc(m.all)}</p>
        <div class="qty" style="margin:10px 0">
        <button data-act="fq" data-d="-1">−</button><b id="fq">1</b><button data-act="fq" data-d="1">+</button>
        </div><button class="btn" data-act="addq" data-id="${m.id}" ${m.stock ? '' : 'disabled'}>Add to Cart</button>
        </div>
        </div>`, 'menu');
}

async function pCart() {
    menu = (await api('/menu')).menu;
    pruneCart();
    const L = cartLines();
    root.innerHTML = shell(`${back('menu', 'My Cart')}${L.length ? L.map(({ m, n }) => `<div class="card item">${thumb(m)}<div class="grow">
          <b>${esc(m.name)}</b>
        <div class="price">${peso(m.price)}</div>
        </div>
        <div class="qty"><button data-act="dec" data-id="${m.id}">−</button><b>${n}</b><button data-act="inc" data-id="${m.id}">+</button><button data-act="del" data-id="${m.id}" aria-label="Remove">🗑</button>
        </div>
        </div>`).join('') + `<div class="card">
          <div class="tot">
            <span>Subtotal</span><span>${peso(sub())}</span>
        </div>
        <div class="tot">
        <span>Service Fee</span><span>${peso(FEE)}</span>
        </div>
        <div class="tot big">
        <span>Total</span><span>${peso(sub() + FEE)}</span>
        </div>
        </div>
        <a class="btn" href="#/pickup" style="margin-top:12px">Proceed to Checkout</a>` : '<div class="card">Your cart is empty. <a href="#/menu">Browse the menu</a> to add meals.</div>'}`, 'menu');
}

let per = null;

async function pPickup() {
    if (!Object.keys(cart).length)
        return go('/cart');
    menu = (await api('/menu')).menu;
    pruneCart();
    const all = (await api('/slots')).slots.filter(x => !x.past);
    const free = x => x.left > 0, cnt = p => all.filter(x => x.period === p && free(x)).length;
    if (slot && !all.find(x => x.id === slot && free(x)))
        slot = null;
    const cur = slot && all.find(x => x.id === slot);
    if (cur)
        per = cur.period;
    if (!per || !all.some(x => x.period === per))
        per = cnt('AM') ? 'AM' : 'PM';
    const list = all.filter(x => x.period === per), rec = all.find(free);
    root.innerHTML = shell(`${back('cart', 'Select Pickup Time')}<p class="muted">You decide when to pick up your order. Today, ${new Date().toDateString()}.</p>
 <div class="seg" role="tablist" aria-label="Morning or afternoon"><button role="tab" aria-selected="${per === 'AM'}" class="${per === 'AM' ? 'on' : ''}" data-act="per" data-v="AM"><b>AM</b><small>Morning · ${cnt('AM')} open</small></button><button role="tab" aria-selected="${per === 'PM'}" class="${per === 'PM' ? 'on' : ''}" data-act="per" data-v="PM"><b>PM</b><small>Afternoon / Evening · ${cnt('PM')} open</small></button>
        </div>
 <div class="slots">${list.map(x => `<div class="slot ${x.left < 1 ? 'off' : ''} ${slot === x.id ? 'on' : ''}" ${x.left > 0 ? `data-act="slot" data-id="${x.id}" tabindex="0" role="button"` : ''}><b>${x.start}</b><small class="${x.left < 1 ? 'full' : ''}">${x.left < 1 ? 'Full' : x.left + ' left'}</small>
        </div>`).join('') || '<p class="muted">No pickup times left in this period today.</p>'}</div>
 ${slot && cur ? `<div class="card pick">
          <span class="muted">Your pickup time</span><b>${cur.label}</b>
        </div>` : rec ? `<div class="card">
          <b>Earliest available</b>
          <p>${rec.label}</p>
        <span class="muted">Estimated prep time: 12 min</span>
        </div>` : ''}<button class="btn" style="margin-top:12px" data-act="next" ${slot ? '' : 'disabled'}>Next</button>`, 'menu');
}

async function pConfirm() {
    if (!slot)
        return go('/pickup');
    menu = (await api('/menu')).menu;
    pruneCart();
    const s = (await api('/slots')).slots.find(x => x.id === slot);
    root.innerHTML = shell(`${back('pickup', 'Confirm Your Order')}<div class="card">${cartLines().map(({ m, n }) => `<div class="tot">
          <span>${esc(m.name)} x${n}</span><span>${peso(m.price * n)}</span>
        </div>`).join('')}<div class="tot">
          <span>Service Fee</span><span>${peso(FEE)}</span>
        </div>
        <div class="tot">
        <span>📅 Pickup Time</span><span>Today, ${s ? s.label : slot}</span>
        </div>
        <div class="tot big">
        <span>Total Amount</span><span>${peso(sub() + FEE)}</span>
        </div>
        </div>
        <label class="row" style="font-weight:400;margin:14px 0"><input type="checkbox" id="agree" style="width:auto"> I agree to the terms and conditions of the cafeteria.</label>
        <div class="err" id="err"></div>
        <button class="btn" data-act="place">Place Order</button>`, 'menu');
}

const STEPS = [['pending', 'Order Received'], ['preparing', 'Preparing'], ['ready', 'Ready for Pickup'], ['claimed', 'Claimed']];

async function pTrack(no) {
    if (!no) {
        const o = (await api('/orders')).orders;
        if (!o.length) {
            root.innerHTML = shell('<h1>Order Tracking</h1><div class="card">No orders yet. <a href="#/menu">Order a meal</a>.</div>', 'track');
            return;
        }
        return go('/track/' + o[0].no);
    }
    const { order: o } = await api('/orders/' + no), i = STEPS.findIndex(s => s[0] === o.status);
    root.innerHTML = shell(`${back('orders', 'Track Your Order')}<div class="card">
          <b>Order #${o.no}</b>
        <div class="muted">Placed ${tm(o.created)} &nbsp; ${badge(o.status)}</div>
        </div>
        <ul class="steps card">${STEPS.map(([k, l], n) => `<li class="${n <= i ? 'done' : ''}"><i>${n <= i ? '✓' : ''}</i>
        <div>
        <b>${l}</b>
        <div class="muted">${o.times[k] ? tm(o.times[k]) : ''}</div>
        </div>
        </li>`).join('')}</ul>
        <div class="card">
        <b>Estimated Ready Time</b>
        <p>Pickup slot: ${o.slotLabel}</p>
        </div>${o.status === 'pending' ? `<button class="btn ghost" data-act="cancel" data-no="${o.no}" style="margin-top:12px">Cancel Order</button>` : ''}${['pending', 'preparing', 'ready'].includes(o.status) ? `<div class="card c" style="margin-top:12px">
          <b>Pickup QR</b>
          <div class="qr">${qrSvg(qrUrl(o.qr), 180)}</div>
        <p class="muted">Show this to the cafeteria staff when you claim your order.</p>
        </div>` : ''}${o.status === 'cancelled' ? '' : `<a class="btn" href="#/pass/${o.no}" style="margin-top:12px">View QR Pass</a>`}`, 'track');
    poll = setInterval(() => {
        if (location.hash === '#/track/' + no)
            route(true);
        else
            clearInterval(poll);
    }, 10000);
}

async function pPass(no) {
    const { order: o } = await api('/orders/' + no), done = o.status === 'claimed', live = ['pending', 'preparing', 'ready'].includes(o.status);
    root.innerHTML = shell(`${back('track/' + o.no, 'Your Pickup Pass')}<div class="ticket">${done ? '<div class="stamp">CLAIMED</div>' : ''}<div class="tk-h">${seal(42)}<div>
          <b>Pickup Pass</b><small>CSPC Cafeteria</small>
        </div>
        </div><div class="qr ${done ? 'dim' : ''}">${qrSvg(qrUrl(o.qr), 200)}</div>
        <div class="tk-n">Order #${o.no}</div>
        <div class="muted">${esc(me.name)} · ${esc(TYPE[me.userType] || '')}</div>${badge(o.status)}<div class="tk-p">
          <span>Pickup Time (Today)</span><b>${o.slotLabel}</b>
        </div>
        <ul class="lines">${o.items.map(i => `<li>
          <span>${esc(i.name)} ×${i.qty}</span><span>${peso(i.price * i.qty)}</span>
        </li>`).join('')}<li class="t">
          <span>Total (incl. ₱${o.fee} fee)</span><span>${peso(o.total)}</span>
        </li>
        </ul>
        <p class="muted">${live ? 'Show this QR code to the cafeteria staff when you claim your order.' : done ? 'This order has already been claimed.' : 'This order is no longer valid.'}</p>
        </div>
        <div class="row" style="max-width:360px;margin:auto">
        <button class="btn ghost" data-act="print">Print / Save</button><a class="btn" href="#/dashboard">Home</a>
        </div>`, 'track');
}

async function pOrders() {
    const o = (await api('/orders')).orders;
    root.innerHTML = shell(`<h1>My Orders</h1>${o.length ? o.map(x => `<a class="card item" style="color:inherit" href="#/track/${x.no}"><div class="grow">
          <b>#${x.no}</b>
        <div class="muted">${x.items.map(i => esc(i.name) + ' x' + i.qty).join(', ')}</div>
        <div class="muted">Pickup ${x.slotLabel}</div>
        </div>
        <div>${badge(x.status)}<div class="price">${peso(x.total)}</div>
        </div>
        </a>`).join('') : '<div class="card">No orders yet. <a href="#/menu">Order a meal</a>.</div>'}`, 'orders');
}

async function pProfile() {
    const r = await api('/me');
    me = r.user;
    const st = r.stats, isStaff = me.role === 'staff';
    const jd = me.joined ? new Date(/Z$/.test(me.joined) ? me.joined : me.joined.replace(' ', 'T') + 'Z') : null, joined = jd && !isNaN(jd) ? jd.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    root.innerHTML = shell(`<div class="pcard card">
          <div class="avbox">${avatar(me, 'big')}</div>
        <div class="pinfo">
        <h1>${esc(me.name)}</h1>
        <div class="pmail">${esc(me.email)}</div>
        <div class="ptags">
        <span class="ptag">${esc(TYPE[me.userType] || '')}</span>${/^PENDING-/.test(me.idNumber) ? '' : `<span class="ptag">ID ${esc(me.idNumber)}</span>`}${me.department ? `<span class="ptag">${esc(me.department)}</span>` : ''}${me.contact ? `<span class="ptag">☎ ${esc(me.contact)}</span>` : ''}</div>${joined ? `<div class="muted" style="margin-top:6px">Member since ${esc(joined)}</div>` : ''}</div>${isStaff ? '' : '<a class="btn" href="#/menu">Browse Menu</a>'}</div>
 ${!me.department || !me.contact || me.needsPassword || /^PENDING-/.test(me.idNumber) ? '<div class="card" style="margin:12px 0;border-left:4px solid var(--gold)"><b>Complete your profile</b><div class="muted">Add your ID number, course / department / office and contact number' + (me.needsPassword ? ', and create your password,' : '') + ' so the cafeteria staff can identify your orders.</div></div>' : ''}
 ${st ? `<div class="stats">${stat(st.total, 'Total Orders')}${stat(st.active, 'Active')}${stat(st.done, 'Completed')}${stat(st.cancelled, 'Cancelled')}</div>` : ''}
 <div class="g2p" style="margin-top:14px">
          <form class="card" data-form="profile">
            <h3>Edit Personal Information</h3>
 ${isStaff ? '' : `<label>I am a…</label>
        <div class="types">${['student', 'employee', 'instructor', 'administrator'].map(t => `<label class="type"><input type="radio" name="ut" value="${t}" ${me.userType === t ? 'checked' : ''}><span>${TYPE[t]}</span></label>`).join('')}</div>`}
 <label for="pn">Full Name</label><input id="pn" required maxlength="60" value="${esc(me.name)}"><div class="g2">
          <div>
            <label for="pi">ID Number</label><input id="pi" required maxlength="20" placeholder="Student / Employee ID" value="${/^PENDING-/.test(me.idNumber) ? '' : esc(me.idNumber)}"></div>
        <div>
        <label for="pc">Contact No.</label><input id="pc" type="tel" maxlength="20" value="${esc(me.contact)}"></div>
        </div>
 <label for="pd">Course / Department / Office</label><input id="pd" maxlength="60" value="${esc(me.department)}"><label for="pe">CSPC Email (your login)</label><input id="pe" value="${esc(me.email)}" disabled><div class="err" id="err" role="alert"></div>
        <button class="btn">Save Changes</button>
        </form>
 <form class="card" data-form="pw">
        <h3>${me.needsPassword ? 'Create Your Password' : 'Change Password'}</h3>${me.needsPassword ? '<p class="muted">Choose a password so next time you can sign in with your CSPC email and password.</p>' : '<label for="cp">Current password</label><input id="cp" type="password" required autocomplete="current-password">'}<label for="np">New password</label><input id="np" type="password" required minlength="8" autocomplete="new-password">
        <div class="err" id="err2" role="alert"></div>
        <button class="btn">${me.needsPassword ? 'Save Password' : 'Update Password'}</button>
        </form>
        </div>`, isStaff ? 'staff/profile' : 'profile');
}

/* ---------- Staff pages ---------- */
const stat = (n, l) => `<div class="card stat">
          <b>${n}</b><span class="muted">${l}</span>
        </div>`;

const orderTbl = (o, act) => `<div class="card tbl">
          <table>
            <tr>
              <th>Order #</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Status</th>
              <th>Pickup</th>${act ? '<th></th>' : ''}</tr>${o.map(x => `<tr>
          <td>#${x.no}</td>
        <td>${esc(x.customer)}</td>
        <td>${x.items.reduce((a, i) => a + i.qty, 0)}</td>
        <td>${badge(x.status)}</td>
        <td>${x.slotLabel}</td>${act ? `<td>${['pending', 'preparing', 'ready'].includes(x.status) ? `<button class="btn sm" data-act="adv" data-no="${x.no}" data-s="${['preparing', 'ready', 'claimed'][['pending', 'preparing', 'ready'].indexOf(x.status)]}">${{ pending: 'Start', preparing: 'Mark ready', ready: 'Claim' }[x.status]}</button>` : ''}</td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="muted">No orders yet.</td></tr>'}</table>
        </div>`;

const todayOrders = async () => {
    const d = new Date(), k = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    return (await api('/orders')).orders.filter(o => o.no.startsWith(k));
};

async function sDash() {
    const o = await todayOrders(), c = s => o.filter(x => x.status === s).length;
    root.innerHTML = shell(`<div class="top">
          <h1>Staff Dashboard</h1>
          <span class="muted">${new Date().toDateString()}</span>
        </div>
        <div class="stats">${stat(o.length, 'Total Orders')}${stat(c('preparing'), 'In Progress')}${stat(c('ready'), 'Ready for Pickup')}${stat(c('claimed'), 'Completed')}</div>
        <div class="top">
        <h2>Recent Orders</h2>
        <a href="#/staff/orders">View All</a>
        </div>${orderTbl(o.slice(0, 5))}`, 'staff');
}

async function sOrders() {
    root.innerHTML = shell(`<h1>Orders</h1>${orderTbl((await api('/orders')).orders, true)}`, 'staff/orders');
}

let qtab = 'pending';

async function sQueue() {
    const o = await todayOrders(), t = ['pending', 'preparing', 'ready'];
    root.innerHTML = shell(`<h1>Preparation Queue</h1>
        <div class="tabs">${t.map(s => `<button class="chip ${qtab === s ? 'on' : ''}" data-act="qtab" data-v="${s}">${s[0].toUpperCase() + s.slice(1)} (${o.filter(x => x.status === s).length})</button>`).join('')}</div>${orderTbl(o.filter(x => x.status === qtab), true)}<a class="btn" href="#/staff/scan" style="margin-top:14px">▣ Scan QR to claim an order</a>`, 'staff/queue');
}

async function sInv() {
    menu = (await api('/menu')).menu;
    pruneCart();
    const st = m => m.stock === 0 ? ['Out of Stock', 'stk-out'] : m.stock <= 5 ? ['Low Stock', 'stk-low'] : ['In Stock', 'stk-in'];
    root.innerHTML = shell(`<h1>Inventory</h1>
        <div class="card tbl">
          <table>
            <tr>
              <th>Photo</th>
              <th>Item</th>
              <th>Price</th>
              <th>Available</th>
              <th>Status</th>
              <th></th>
            </tr>${menu.map(m => `<tr>
          <td>${m.img ? `<img src="${esc(m.img)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px;display:block;margin-bottom:4px">` : '<span class="muted">No photo</span> <button class="btn" type="button" data-act="autophoto" data-id="${m.id}" style="padding:2px 8px;font-size:.75rem">Find photo</button><br>'}<input type="file" accept="image/jpeg,image/png,image/webp" data-act="photo" data-id="${m.id}" style="width:150px;font-size:.75rem" aria-label="Change photo of ${esc(m.name)}"></td>
        <td>${esc(m.name)}</td>
        <td>${peso(m.price)}</td>
        <td><input type="number" min="0" max="999" value="${m.stock}" data-act="stock" data-id="${m.id}" data-price="${m.price}" style="width:80px" aria-label="Stock for ${esc(m.name)}"></td><td class="${st(m)[1]}">${st(m)[0]}</td>
        <td><button class="btn ghost sm" type="button" data-act="delitem" data-id="${m.id}" data-name="${esc(m.name)}">Delete</button>
        </td>
        </tr>`).join('')}</table>
        </div>
 <form class="card" data-form="additem" style="margin-top:14px">
        <h3>Add Item</h3>
        <div class="row">
        <input id="n" placeholder="Name" required maxlength="40"><select id="c"><option>Main Dish</option><option>Snacks</option><option>Drinks</option><option>Dessert</option></select><input id="p" type="number" min="0" placeholder="Price" required><input id="s" type="number" min="0" placeholder="Stock" required>
        </div>
        <div style="margin:10px 0">
        <label for="f" class="muted" style="display:block;margin-bottom:4px">Photo of the real food or drink (JPG, PNG or WEBP). Leave empty and the system will look for a real photo online.</label><input id="f" type="file" accept="image/jpeg,image/png,image/webp"><img id="pv" alt="" hidden style="display:block;margin-top:8px;width:140px;height:140px;object-fit:cover;border-radius:10px">
        </div>
        <div class="err" id="err"></div>
        <button class="btn">Add Item</button>
        </form>`, 'staff/inventory');
}

async function sRep() {
    const r = await api('/reports/daily');
    root.innerHTML = shell(`<h1>Daily Sales Report</h1>
        <div class="stats">${stat(peso(r.sales), 'Total Sales')}${stat(r.orders, 'Total Orders')}${stat(peso(r.avg), 'Avg. Order Value')}</div>
        <div class="card">
        <h3>Best Selling Items</h3>
        <table>${r.best.map(b => `<tr>
          <td>${esc(b.name)}</td>
        <td>${b.qty}</td>
        <td>
        <div class="bar"><i style="width:${b.pct}%"></i>
        </div>
        </td>
        <td>${b.pct}%</td>
        </tr>`).join('') || '<tr><td class="muted">No sales yet today.</td></tr>'}</table>
        </div>
        <button class="btn" style="margin-top:12px" data-act="export">Export Report</button>`, 'staff/reports');
    window._r = r;
}

async function sAudit() {
    const l = (await api('/audit')).log;
    root.innerHTML = shell(`<h1>Audit Log</h1>
        <p class="muted" style="margin-bottom:14px">Most recent system activity.</p>
        <div class="card tbl">
          <table>
            <tr>
              <th>Date / Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Details</th>
            </tr>${l.map(x => `<tr>
          <td>${new Date(x.at).toLocaleString()}</td>
        <td>${esc(x.user)}</td>
        <td>${esc(x.action)}</td>
        <td>${esc(x.detail)}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No activity recorded.</td></tr>'}</table>
        </div>`, 'staff/audit');
}

/* ---------- Staff: QR scanner ---------- */
let stream = null, scanTimer = null, busy = false, lastCode = '', pendingScan = null;

const stopCam = () => {
    clearInterval(scanTimer);
    scanTimer = null;
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
};

function sScan() {
    root.innerHTML = shell(`<h1>Scan Pickup QR</h1>
        <p class="muted" style="margin:4px 0 16px">Scan the customer's QR pass with the camera, or type / scan the code into the box (USB &amp; Bluetooth scanners work too).</p>
        <div class="g2p">
          <div class="card">
            <div class="cam">
              <video id="vid" playsinline muted></video>
              <div class="frame"></div>
              <span class="hint" id="hint">Camera is off</span>
            </div>
            <button class="btn" data-act="cam" id="camBtn" style="margin-top:12px">Start Camera</button>
            <div class="muted" id="camMsg" style="margin-top:6px"></div>
            <form class="row" data-form="scan" style="margin-top:14px">
              <input id="code" placeholder="Pickup code or order number" autocomplete="off"><button class="btn sm">Look up</button>
            </form>
          </div>
          <div class="card" id="res">
            <p class="muted">The scanned order will appear here.</p>
          </div>
        </div>`, 'staff/scan');
    $('#code').focus();
    if (!('BarcodeDetector' in window))
        $('#camMsg').textContent = 'This browser cannot scan inside the page. Use the phone\'s normal Camera app: scanning the customer\'s QR opens this page and the order appears automatically. You can also type the code or use a USB scanner.';
    if (pendingScan) {
        const c = pendingScan;
        pendingScan = null;
        lookup(c);
    }
}

async function startCam() {
    const msg = $('#camMsg');
    try {
        if (!('BarcodeDetector' in window))
            throw new Error('This browser cannot scan QR codes with the camera.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = $('#vid');
        v.srcObject = stream;
        await v.play();
        const det = new BarcodeDetector({ formats: ['qr_code'] });
        $('#camBtn').textContent = 'Stop Camera';
        $('#hint').textContent = 'Point at the QR code';
        msg.textContent = '';
        scanTimer = setInterval(async () => {
            if (busy)
                return;
            try {
                const c = await det.detect(v);
                if (c[0]) {
                    busy = true;
                    await lookup(c[0].rawValue);
                    setTimeout(() => busy = false, 2500);
                }
            }
            catch { }
        }, 350);
    }
    catch (e) {
        stopCam();
        msg.textContent = e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the browser, or type the code instead.' : e.message;
    }
}

const when = i => new Date(i).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function lookup(code) {
    code = codeOf(code);
    lastCode = code;
    const res = $('#res');
    if (!res)
        return;
    try {
        const r = await api('/scan', 'POST', { code }), o = r.order, warn = [];
        if (!r.today)
            warn.push('This order is from another day.');
        if (!r.verified)
            warn.push('Typed in manually — please check the customer\'s ID.');
        const act = { pending: ['preparing', 'Start preparing'], preparing: ['ready', 'Mark as ready'] }[o.status];
        res.innerHTML = `<div class="row sp">
          <h3>Order #${o.no}</h3>${badge(o.status)}</div>
        <p>
        <b>${esc(o.customer)}</b><br><span class="muted">${esc(TYPE[o.customerType] || '')} · ID ${esc(o.customerId)}</span>
        </p>
        <ul class="lines">${o.items.map(i => `<li>
          <span>${esc(i.name)} ×${i.qty}</span><span>${peso(i.price * i.qty)}</span>
        </li>`).join('')}<li class="t">
          <span>Total</span><span>${peso(o.total)}</span>
        </li>
        </ul>
        <p class="muted">Pickup: ${o.slotLabel}</p>${warn.map(w => `<div class="warn">⚠ ${w}</div>`).join('')}
  ${o.status === 'ready' && r.today ? `<button class="btn" data-act="sact" data-no="${o.no}" data-s="claimed">✓ Mark as Claimed</button>` : o.status === 'claimed' ? `<div class="okb">✓ Already claimed ${o.times.claimed ? when(o.times.claimed) : ''}</div>` : o.status === 'cancelled' ? '<div class="warn">This order was cancelled — do not release.</div>' : act ? `<div class="warn">Not ready for pickup yet.</div><button class="btn ghost" data-act="sact" data-no="${o.no}" data-s="${act[0]}">${act[1]}</button>` : ''}`;
        $('#code').value = '';
        if (r.verified && r.today && o.status === 'ready')
            toast('Valid QR — ready to claim');
    }
    catch (e) {
        res.innerHTML = `<div class="warn">✗ ${esc(e.message)}</div>`;
    }
}

/* ---------- Landing page (shown before sign in) ---------- */
function pLanding() {
    const ic = d => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
    const head = (e, t, s) => `<div class="lp-h">
          <span class="lp-eye">${e}</span>
        <h2>${t}</h2>${s ? `<p>${s}</p>` : ''}</div>`;
    const cats = [
        ['Main Dish', 'Chicken Adobo', 'Chicken Adobo · Pork Sisig · Beef Caldereta', 'chicken-adobo'],
        ['Snacks', 'Pancit Canton', 'Lumpia Shanghai · Siomai · Banana Cue', 'lumpia-shanghai'],
        ['Drinks', 'Iced Tea', 'Iced Tea · Mango Shake · Buko Juice', 'iced-tea'],
        ['Dessert', 'Biko', 'Biko · Chocolate Cupcake · Turon', 'biko']
    ];
    const steps = [
        ['Create your account', 'Register with your CSPC email and set up your profile.'],
        ['Browse and order', 'Pick meals from Main Dish, Snacks, Drinks and Dessert.'],
        ['Choose a pickup time', 'Select an AM or PM slot that fits your class schedule.'],
        ['Show your QR pass', 'Staff scan your QR and hand over your order.']
    ];
    const feats = [
        [
            'M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zM18 20a1 1 0 100-2 1 1 0 000 2z',
            'Pre-order meals',
            'Browse the full menu with photos and prices before you go.'
        ],
        [
            'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
            'Pickup time slots',
            'Limited orders per 15-minute slot keep the counter from getting crowded.'
        ],
        [
            'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 14v6h-3',
            'QR pickup pass',
            'Every order has its own signed QR. Fake or edited codes are rejected.'
        ],
        ['M3 12l5 5L21 6', 'Live order tracking', 'Follow your order from Pending to Preparing, Ready and Claimed.'],
        [
            'M4 7h16M4 12h16M4 17h10',
            'Real-time stock',
            'See what is still available so you never order a sold-out dish.'
        ],
        [
            'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
            'Secure accounts',
            'CSPC email sign-in with hashed passwords and protected staff tools.'
        ]
    ];
    const faq = [
        ['Who can use the system?', 'CSPC students, employees, instructors and administrators with a CSPC email. Cafeteria staff register with the staff access code.'],
        ['Can I cancel an order?', 'Yes, as long as the order is still Pending. After staff start preparing it, it can no longer be cancelled.'],
        ['Which day can I pick up?', 'Pickup slots are for today, in 15-minute windows from 7:00 AM to 7:00 PM.'],
        ['Do I pay online?', 'No. The system handles ordering and pickup only. Online payment is not included.']
    ];
    const glance = [
        ['7:00 AM – 7:00 PM', 'Open daily'],
        ['15 minutes', 'Pickup slot length'],
        ['10 orders', 'Per pickup slot'],
        ['₱5', 'Service fee per order']
    ];
    root.innerHTML = `<div class="lp">
          <header class="lp-nav">
            <div class="lp-in row sp">
              <a class="bd" href="#/">${seal(44)}<span><b>CSPC Cafeteria</b><small>Pre-Order System</small></span></a>
        <nav class="lp-links">
        <a href="#lp-menu" data-jump="lp-menu">Menu</a><a href="#lp-how" data-jump="lp-how">How it works</a><a href="#lp-feat" data-jump="lp-feat">Why use it</a><a href="#lp-info" data-jump="lp-info">Good to know</a>
        </nav>
        <div class="row">
        <a class="lo" href="#/login">Sign In</a><a class="lp-cta sm" href="#/register">Register</a>
        </div>
        </div>
        </header>
 <section class="lp-hero">
        <div class="lp-in">
        <span class="lp-eye">Camarines Sur Polytechnic Colleges</span>
        <h1>Order ahead.<br>Pick up on time.<br><em>Skip the line.</em>
        </h1>
        <p>The official online pre-order system of the CSPC cafeteria. Choose your meal, pick a time, and claim it with a QR code.</p>
        <div class="lp-btns">
        <a class="lp-cta" href="#/register">Create an Account</a><a class="lp-ghost" href="#/login">Sign In</a>
        </div>
        <p class="lp-for">For CSPC students, employees, instructors, administrators and cafeteria staff.</p>
        </div>
        </section>
 <section class="lp-sec" id="lp-menu">
        <div class="lp-in">${head('Our Menu', "What's on the menu", 'Main dishes, snacks, drinks and desserts, prepared fresh every day. Sign in to see the full menu, prices and stock.')}<div class="lp-cats">${cats.map(([c, n, l, f]) => `<div class="lp-glass lp-cat">
          <div class="lp-plate"><img src="img/food/${f}.jpg" alt="${esc(c)}: ${esc(l)}" loading="lazy" data-cat="${esc(c)}" data-name="${esc(n)}"></div>
        <b>${c}</b><span>${l}</span>
        </div>`).join('')}</div>
        </div>
        </section>
 <section class="lp-sec dim" id="lp-how">
        <div class="lp-in">${head('Simple Process', 'How it works', 'Four quick steps from your seat to the counter.')}<div class="lp-how">
          <ol class="lp-steps">${steps.map(([t, d], n) => `<li>
          <i>${n + 1}</i>
        <div>
        <b>${t}</b><span>${d}</span>
        </div>
        </li>`).join('')}</ol>
        <div class="ticket lp-tk">
        <div class="tk-h">${seal(42)}<div>
          <b>Pickup Pass</b><small>CSPC Cafeteria · Sample</small>
        </div>
        </div>
        <div class="qr">${qrSvg('CSPC cafeteria sample pickup pass', 170)}</div>
        <div class="tk-n">Order #20261002001</div>
        <div class="tk-p">
        <span>Pickup Time (Today)</span><b>10:15 AM – 10:30 AM</b>
        </div>
        <p class="muted">This is how your pass looks. Show it to the staff when you claim.</p>
        </div>
        </div>
        </div>
        </section>
 <section class="lp-sec" id="lp-feat">
        <div class="lp-in">${head('Why CSPC Cafeteria Pre-Order', 'Why use it', 'Built for busy school days: less waiting, clear orders, fair pickup.')}<div class="lp-feats">${feats.map(([d, t, x]) => `<div class="lp-glass lp-feat">
          <span class="lp-ico">${ic(d)}</span><b>${t}</b><span>${x}</span>
        </div>`).join('')}</div>
        </div>
        </section>
 <section class="lp-sec dim" id="lp-info">
        <div class="lp-in">${head('Before You Order', 'Good to know', '')}<div class="lp-info">
          <div class="lp-faq">${faq.map(([q, x]) => `<details class="lp-glass">
          <summary>${q}</summary>
        <p>${x}</p>
        </details>`).join('')}</div>
        <div class="lp-glass lp-glance">
        <h3>Cafeteria at a glance</h3>${glance.map(([v, l]) => `<div>
          <b>${v}</b><span>${l}</span>
        </div>`).join('')}</div>
        </div>
        </div>
        </section>
 <footer class="lp-ft">&copy; Camarines Sur Polytechnic Colleges &middot; Nabua, Camarines Sur</footer>
        </div>`;
    scrollTo(0, 0);
}

document.addEventListener('click', e => {
    const j = e.target.closest('[data-jump]');
    if (!j)
        return;
    e.preventDefault();
    document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth' });
});

/* ---------- Router ---------- */
const student = {
    dashboard: pDash,
    menu: pMenu,
    food: pFood,
    cart: pCart,
    pickup: pPickup,
    confirm: pConfirm,
    track: pTrack,
    pass: pPass,
    orders: pOrders,
    profile: pProfile
};

async function sAccess() {
    const c = await api('/staff/access-code');
    root.innerHTML = shell(`<h1>Staff Access Code</h1>
        <p class="muted" style="margin-bottom:14px">This code lets new cafeteria staff create their own staff account on the Register page. Only cafeteria staff can set or change it. The code is stored securely and cannot be viewed again, so share it only with people you trust.</p>
 <div class="card" style="max-width:560px">
          <p>
            <b>Status:</b> ${c.enabled ? '<span style="color:var(--ok)">Staff sign-up is OPEN</span>' : '<span style="color:var(--bad)">Staff sign-up is CLOSED (no code set)</span>'}</p>${c.enabled && c.at ? `<p class="muted">Last changed by ${esc(c.by || 'staff')} on ${new Date(c.at).toLocaleString()}</p>` : ''}
 <form data-form="acode">
          <label for="ac">${c.enabled ? 'New access code' : 'Choose an access code'}</label><input id="ac" type="text" minlength="8" maxlength="40" required autocomplete="off" placeholder="8 to 40 characters, e.g. Cafe-Staff-2026">
 <label for="acp">Your password (to confirm)</label><input id="acp" type="password" required autocomplete="current-password">
 <div class="err" id="err" role="alert"></div>
        <button class="btn">${c.enabled ? 'Change Access Code' : 'Set Access Code'}</button>
        </form>
 ${c.enabled ? '<form data-form="aclose" style="margin-top:18px"><label for="acp2">Close staff sign-up (remove the code)</label><input id="acp2" type="password" required autocomplete="current-password" placeholder="Your password"><div class="err" id="err2" role="alert"></div><button class="btn ghost">Close Staff Sign-up</button></form>' : ''}</div>`, 'staff/access');
}

const staff = {
    profile: pProfile,
    access: sAccess,
    scan: sScan,
    audit: sAudit,
    staff: sDash,
    orders: sOrders,
    queue: sQueue,
    inventory: sInv,
    reports: sRep
};

async function route() {
    clearInterval(poll);
    stopCam();
    const p = location.hash.replace(/^#\//, '').split('/'), [a, b] = p;
    if (me === undefined) {
        me = await api('/me').then(r => r.user, () => null);
        if (me)
            loadCart();
    }
    notifyBoot();
    if (a === 'scan' && b) {
        const c = codeOf(decodeURIComponent(b));
        if (!me) {
            try {
                sessionStorage.setItem('next', location.hash);
            }
            catch { }
            return pLogin();
        }
        if (me.role === 'staff') {
            pendingScan = c;
            return go('/staff/scan');
        }
        const n = /^CSPC\.(\d{11})\./.exec(c);
        return go(n ? '/track/' + n[1] : '/dashboard');
    }
    if (!me) {
        return a === 'register' ? pRegister() : a === 'login' ? pLogin() : pLanding();
    }
    try {
        if (me.role === 'staff') {
            const f = staff[a === 'staff' ? (b || 'staff') : ''];
            return f ? await f() : go('/staff');
        }
        const f = student[a];
        f ? await f(b) : go('/dashboard');
    }
    catch (e) {
        if (/log in/i.test(e.message)) {
            me = null;
            cart = {};
            go('/login');
        }
        else {
            root.innerHTML = shell(`<div class="card">
          <h2>Something went wrong</h2>
          <p>${esc(e.message)}</p>
        <a href="#/dashboard">Go to dashboard</a>
        </div>`);
        }
    }
}

window.addEventListener('hashchange', () => route());

/* ---------- Actions ---------- */
let fqty = 1;

const adv = async (no, s) => {
    try {
        await api('/orders/' + no + '/status', 'PATCH', { status: s });
        toast('Order updated');
        route();
    }
    catch (e) {
        toast(e.message);
    }
};

const A = {
    notifs: () => {
        panelOpen ? closePanel() : openPanel();
    },
    bell: () => { // sound on/off (button inside the notification panel)
        soundOn = !soundOn;
        try {
            localStorage.setItem('sound', soundOn ? 'on' : 'off');
        }
        catch { }
        if (soundOn)
            chime('info');
        paintPanel();
    },
    nopen: d => { // click on one notification: mark it read and open the order
        const n = notes.find(x => x.id === +d.id);
        if (n && !n.read) {
            n.read = true;
            unread = Math.max(0, unread - 1);
            api('/notifications/read', 'POST', { id: n.id }).catch(() => { });
            paintBadge();
        }
        closePanel();
        $('#notice')?.classList.remove('show');
        if (d.no)
            go(me && me.role === 'staff' ? '/staff/orders' : '/track/' + d.no);
    },
    nread: () => {
        notes.forEach(n => n.read = true);
        unread = 0;
        api('/notifications/read', 'POST', {}).catch(() => { });
        paintBadge();
        paintPanel();
    },
    nclose: () => closePanel(),
    logout: async () => {
        await api('/logout', 'POST').catch(() => { });
        me = null;
        cart = {};
        go('/login');
        route();
    },
    eye: (d, b) => {
        const i = b.previousElementSibling, show = i.type === 'password';
        i.type = show ? 'text' : 'password';
        b.innerHTML = show ? IC.eyeOff : IC.eye;
        b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    },
    cat: d => {
        cat = d.v;
        route();
    },
    per: d => {
        per = d.v;
        slot = null;
        route();
    }, print: () => window.print(),
    cam: () => stream ? (stopCam(), $('#camBtn').textContent = 'Start Camera', $('#hint').textContent = 'Camera is off') : startCam(),
    delitem: async (d, b) => {
        if (!confirm('Delete "' + d.name + '" from the menu? Customers will no longer see it. Past orders are not affected.'))
            return;
        b.disabled = true;
        try {
            await api('/menu/' + d.id, 'DELETE');
            toast('Item deleted');
            route();
        }
        catch (e) {
            toast(e.message);
            b.disabled = false;
        }
    },
    autophoto: async (d, b) => {
        b.disabled = true;
        toast('Looking for a real photo…');
        try {
            await api('/menu/' + d.id + '/autophoto', 'POST', {});
            toast('Photo added. Please check it.');
            route();
        }
        catch (e) {
            toast(e.message);
            b.disabled = false;
        }
    },
    sact: async (d) => {
        try {
            await api('/orders/' + d.no + '/status', 'PATCH', { status: d.s });
            toast(d.s === 'claimed' ? 'Order claimed' : 'Order updated');
            lookup(lastCode);
        }
        catch (e) {
            toast(e.message);
        }
    },
    add: d => {
        const m = menu.find(x => x.id == d.id);
        if ((cart[d.id] || 0) >= m.stock)
            return toast('No more stock available.');
        cart[d.id] = (cart[d.id] || 0) + 1;
        saveCart();
        toast(m.name + ' added to cart');
        route();
    },
    fq: d => {
        fqty = Math.max(1, Math.min(10, fqty + +d.d));
        $('#fq').textContent = fqty;
    },
    addq: d => {
        const m = menu.find(x => x.id == d.id), n = (cart[d.id] || 0) + fqty;
        if (n > m.stock)
            return toast('Only ' + m.stock + ' available.');
        cart[d.id] = n;
        saveCart();
        fqty = 1;
        go('/cart');
    },
    inc: d => {
        const m = menu.find(x => x.id == d.id);
        if (cart[d.id] >= m.stock)
            return toast('No more stock available.');
        cart[d.id]++;
        saveCart();
        route();
    },
    dec: d => {
        cart[d.id] > 1 ? cart[d.id]-- : delete cart[d.id];
        saveCart();
        route();
    },
    del: d => {
        delete cart[d.id];
        saveCart();
        route();
    },
    slot: d => {
        slot = d.id;
        route();
    }, next: () => go('/confirm'),
    place: async () => {
        if (!$('#agree').checked)
            return $('#err').textContent = 'Please agree to the terms and conditions.';
        try {
            const r = await api('/orders', 'POST', { items: Object.entries(cart).map(([id, qty]) => ({ id: +id, qty })), slot });
            cart = {};
            slot = null;
            saveCart();
            go('/track/' + r.order.no);
        }
        catch (e) {
            $('#err').textContent = e.message;
            syncMenu();
        }
    },
    qtab: d => {
        qtab = d.v;
        route();
    },
    adv: d => adv(d.no, d.s),
    cancel: async (d) => {
        if (!confirm('Cancel this order?'))
            return;
        try {
            await api('/orders/' + d.no + '/cancel', 'PATCH', {});
            toast('Order cancelled');
            route();
        }
        catch (e) {
            toast(e.message);
        }
    },
    export: () => {
        const r = window._r, rows = [
            ['Item', 'Qty', 'Percent'],
            ...r.best.map(b => [b.name, b.qty, b.pct + '%']),
            [],
            ['Total Sales', r.sales],
            ['Total Orders', r.orders],
            ['Avg Order Value', r.avg]
        ];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([rows.map(x => x.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n')], { type: 'text/csv' }));
        a.download = 'daily-sales-report.csv';
        a.click();
    }
};

document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT')
        return;
    A[b.dataset.act]?.(b.dataset, b);
});

document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset?.act === 'slot')
        A.slot(e.target.dataset);
});

document.addEventListener('change', e => {
    if (e.target.name === 'ut') {
        const b = $('#staffbox');
        if (b)
            b.hidden = e.target.value !== 'staff';
    }
});

document.addEventListener('input', e => {
    if (e.target.id === 'q') {
        q = e.target.value;
        $('#grid').innerHTML = grid();
    }
});

document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.act !== 'stock')
        return;
    try {
        await api('/menu/' + el.dataset.id, 'PATCH', { stock: +el.value, price: +el.dataset.price });
        toast('Stock updated');
        route();
    }
    catch (x) {
        toast(x.message);
    }
});

const F = {
    async acode(f) {
        try {
            await api('/staff/access-code', 'PUT', { code: f.ac.value, password: f.acp.value });
            toast('Access code saved');
            route();
        }
        catch (e) {
            $('#err').textContent = e.message;
        }
    },
    async aclose(f) {
        if (!confirm('Close staff sign-up? Nobody will be able to register as staff until a new code is set.'))
            return;
        try {
            await api('/staff/access-code', 'DELETE', { password: f.acp2.value });
            toast('Staff sign-up closed');
            route();
        }
        catch (e) {
            $('#err2').textContent = e.message;
        }
    },
    async login(f) {
        try {
            me = (await api('/login', 'POST', { email: f.email.value, password: f.password.value })).user;
            loadCart();
            let nx = null;
            try {
                nx = sessionStorage.getItem('next');
                sessionStorage.removeItem('next');
            }
            catch { }
            toast('Signed in as ' + me.email);
            go(nx ? nx.replace(/^#/, '') : me.role === 'staff' ? '/staff' : '/profile');
            route();
        }
        catch (e) {
            $('#err').textContent = e.message;
        }
    },
    async google(credential) {
        try {
            me = (await api('/google', 'POST', { credential })).user;
            loadCart();
            let nx = null;
            try {
                nx = sessionStorage.getItem('next');
                sessionStorage.removeItem('next');
            }
            catch { }
            toast('Signed in as ' + me.email);
            go(nx ? nx.replace(/^#/, '') : me.role === 'staff' ? '/staff' : '/profile');
            route();
        }
        catch (e) {
            const x = $('#err');
            if (x)
                x.textContent = e.message;
            toast(e.message);
        }
    },
    async register(f) {
        const ut = f.querySelector('input[name=ut]:checked').value;
        if (f.password.value !== f.password2.value)
            return $('#err').textContent = 'Passwords do not match.';
        try {
            await api('/register', 'POST', {
                userType: ut,
                staffCode: f.scode ? f.scode.value : '',
                name: f.name.value,
                idNumber: f.idn.value,
                contact: f.contact.value,
                department: f.dept.value,
                email: f.email.value,
                password: f.password.value
            });
            toast('Account created. Please sign in.');
            go('/login');
        }
        catch (e) {
            $('#err').textContent = e.message;
        }
    },
    async profile(f) {
        const u = f.querySelector('input[name=ut]:checked');
        try {
            me = (await api('/profile', 'PATCH', {
                userType: u ? u.value : me.userType,
                name: f.pn.value,
                idNumber: f.pi.value,
                contact: f.pc.value,
                department: f.pd.value
            })).user;
            toast('Profile saved');
            route();
        }
        catch (e) {
            $('#err').textContent = e.message;
        }
    },
    scan(f) {
        const c = f.code.value.trim();
        if (c)
            lookup(c);
    },
    async pw(f) {
        try {
            await api('/password', 'POST', { current: f.cp ? f.cp.value : '', next: f.np.value });
            f.reset();
            $('#err2').textContent = '';
            toast('Password saved');
            route();
        }
        catch (e) {
            $('#err2').textContent = e.message;
        }
    },
    async additem(f) {
        try {
            const file = f.f.files[0], photo = file ? await shrink(file) : null;
            const r = await api('/menu', 'POST', { name: f.n.value, cat: f.c.value, price: +f.p.value, stock: +f.s.value });
            if (photo) {
                try {
                    await api('/menu/' + r.item.id + '/image', 'POST', { data: photo });
                }
                catch (e) {
                    toast('Item added, but the photo was not saved: ' + e.message);
                    return route();
                }
            }
            if (!photo && !r.item.img) {
                toast('Item added. Looking for a real photo…');
                try {
                    await api('/menu/' + r.item.id + '/autophoto', 'POST', {});
                    toast('Item added with a real photo. Please check it.');
                }
                catch (e) {
                    toast('Item added. ' + e.message);
                }
                return route();
            }
            toast('Item added');
            route();
        }
        catch (e) {
            $('#err').textContent = e.message;
        }
    }
};

/* menu photos: shrink to max 800px JPEG in the browser before upload (keeps files small and fast on phones) */
function shrink(file, max = 800) {
    return new Promise((ok, no) => {
        const fr = new FileReader();
        fr.onerror = () => no(new Error('Could not read that photo.'));
        fr.onload = () => {
            const i = new Image();
            i.onerror = () => no(new Error('That file is not a readable photo.'));
            i.onload = () => {
                const k = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement('canvas');
                c.width = Math.round(i.width * k);
                c.height = Math.round(i.height * k);
                c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
                ok(c.toDataURL('image/jpeg', .85));
            };
            i.src = fr.result;
        };
        fr.readAsDataURL(file);
    });
}

document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.id === 'f') {
        const pv = $('#pv'), file = el.files[0];
        if (!pv)
            return;
        if (!file) {
            pv.hidden = true;
            return;
        }
        try {
            pv.src = await shrink(file, 300);
            pv.hidden = false;
        }
        catch (err) {
            pv.hidden = true;
            toast(err.message);
        }
        return;
    }
    if (el.dataset.act !== 'photo' || !el.files[0])
        return;
    try {
        await api('/menu/' + el.dataset.id + '/image', 'POST', { data: await shrink(el.files[0]) });
        toast('Photo updated');
        route();
    }
    catch (err) {
        toast(err.message);
    }
});

document.addEventListener('submit', e => {
    e.preventDefault();
    F[e.target.dataset.form]?.(e.target);
});

route();

/* Live menu sync: when staff delete an item or change stock/price, customers see it within seconds (no refresh needed) */
let msync = null;

const sig = () => menu.map(m => [m.id, m.name, m.price, m.stock, m.img].join(':')).join('|');

async function syncMenu() {
    if (!me || me.role === 'staff' || document.hidden)
        return;
    const a = location.hash.replace(/^#\//, '').split('/')[0];
    if (!['dashboard', 'menu', 'food', 'cart', 'pickup', 'confirm'].includes(a))
        return;
    try {
        const fresh = (await api('/menu')).menu, old = sig();
        menu = fresh;
        if (sig() === old)
            return;
        pruneCart();
        const el = document.activeElement;
        if (a === 'menu' && el && el.id === 'q') {
            $('#grid').innerHTML = grid();
            return;
        }
        route();
    }
    catch (e) {
        if (/log in/i.test(e.message)) {
            me = null;
            cart = {};
            go('/login');
            route();
        }
    }
}

msync = setInterval(syncMenu, 5000);

/* Live orders: staff pages (dashboard, orders, queue) and the customer's My Orders list refresh by themselves, so a customer's new order shows up on the staff phone without pressing refresh. */
let osig = '';

async function syncOrders() {
    if (!me || document.hidden)
        return;
    const h = location.hash.replace(/^#\//, '').split('/').slice(0, 2).join('/');
    if (!(me.role === 'staff' ? ['staff', 'staff/orders', 'staff/queue'] : ['orders']).includes(h))
        return;
    try {
        const sg = (await api('/orders')).orders.map(o => o.no + ':' + o.status).join('|');
        if (sg === osig)
            return;
        osig = sg;
        route();
    }
    catch { }
}

setInterval(syncOrders, 4000);

document.addEventListener('visibilitychange', () => {
    if (!document.hidden)
        syncMenu();
});

/* ---------- Notifications ----------
   Saved by the server in the database (see notifications table), so a person sees them even if they were offline.
   Customers: order is being prepared / ready for pickup / completed.  Staff: new order, order cancelled.
   The app checks every few seconds; a new one plays a chime, shows a pop-up and raises the red counter on the bell. */
let audioCtx, noticeTimer;

const baseTitle = document.title;
const NICON = { preparing: IC.cook, ready: IC.check, claimed: IC.bag, new_order: IC.receipt, cancelled: IC.cancel };

function unlockAudio() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended')
            audioCtx.resume();
    }
    catch { }
}

// Browsers only allow sound after the person has clicked or typed once, so unlock on the first interaction.
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, { passive: true }));

// Normal-sounding notification chime made with the Web Audio API (no sound file needed).
function chime(kind) {
    if (!soundOn)
        return;
    unlockAudio();
    if (!audioCtx)
        return;
    const notes = kind === 'ready' ? [[784, 0], [988, .16], [1319, .32], [1568, .5]] : [[880, 0], [1319, .17]];
    const t0 = audioCtx.currentTime + .02;
    notes.forEach(([hz, at]) => {
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(.3, t0 + at + .02);
        gain.gain.exponentialRampToValueAtTime(.0001, t0 + at + .45);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + .5);
    });
}

const ago = iso => {
    const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60)
        return 'Just now';
    if (sec < 3600)
        return Math.floor(sec / 60) + ' min ago';
    if (sec < 86400)
        return Math.floor(sec / 3600) + ' h ago';
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
};

function paintBadge() {
    document.querySelectorAll('.nbadge').forEach(b => {
        b.textContent = unread > 99 ? '99+' : unread;
        b.hidden = !unread;
    });
}

function paintPanel() {
    const p = $('#npanel');
    if (!p)
        return;
    const list = notes.map(n => `<li class="nitem ${n.read ? '' : 'unread'}" data-act="nopen" data-id="${n.id}" data-no="${esc(n.no || '')}">
        <span class="nk">${NICON[n.kind] || IC.bell}</span>
        <div><b>${esc(n.title)}</b><small>${esc(n.body)}</small><em>${ago(n.created)}</em></div>
        </li>`).join('');
    p.innerHTML = `<div class="nh"><b>Notifications</b>
        <button type="button" data-act="bell" title="Turn the sound on or off">${soundOn ? IC.bell + ' Sound on' : IC.bellOff + ' Sound off'}</button>
        <button type="button" data-act="nclose" aria-label="Close">×</button></div>
        ${unread ? '<button type="button" class="nall" data-act="nread">Mark all as read</button>' : ''}
        ${notes.length ? `<ul>${list}</ul>` : '<p class="nempty">No notifications yet.<br>Updates about your orders will show up here.</p>'}`;
}

function openPanel() {
    let p = $('#npanel');
    if (!p) {
        p = document.createElement('div');
        p.id = 'npanel';
        document.body.appendChild(p);
    }
    panelOpen = true;
    $('#notice')?.classList.remove('show');
    paintPanel();
    p.classList.add('open');
    checkNotify();
}

function closePanel() {
    panelOpen = false;
    $('#npanel')?.classList.remove('open');
}

// click outside the panel closes it
document.addEventListener('click', e => {
    if (panelOpen && !e.target.closest('#npanel, [data-act="notifs"], [data-act="nopen"]'))
        closePanel();
});

function banner(n) {
    let el = $('#notice');
    if (!el) {
        el = document.createElement('div');
        el.id = 'notice';
        el.setAttribute('role', 'alert');
        document.body.appendChild(el);
    }
    el.innerHTML = `<span class="ni">${NICON[n.kind] || IC.bell}</span><div><b>${esc(n.title)}</b><small>${esc(n.body)}</small></div><button type="button" aria-label="Close">×</button>`;
    el.dataset.id = n.id;
    el.dataset.no = n.no || '';
    el.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => el.classList.remove('show'), 10000);
}

document.addEventListener('click', e => {
    const el = e.target.closest('#notice');
    if (!el)
        return;
    el.classList.remove('show');
    if (!e.target.closest('button'))
        A.nopen({ id: el.dataset.id, no: el.dataset.no });
});

function desktopNotice(n) {
    try {
        if (!('Notification' in window) || Notification.permission !== 'granted')
            return;
        const d = new Notification(n.title, { body: n.body, icon: 'img/favicon.png', tag: 'cspc-' + n.id });
        d.onclick = () => {
            window.focus();
            A.nopen({ id: n.id, no: n.no || '' });
            d.close();
        };
    }
    catch { }
}

// A brand-new notification arrived while the app is open.
function ring(n) {
    chime(n.kind === 'ready' ? 'ready' : 'info');
    if (!panelOpen)
        banner(n);
    if (document.hidden) {
        desktopNotice(n);
        document.title = '(' + unread + ') ' + n.title + ' · ' + baseTitle;
    }
}

// Ask once (on a click, as browsers require) if we may show notifications while the tab is in the background.
let askedPermission = false;

document.addEventListener('pointerdown', () => {
    if (askedPermission || !me || !('Notification' in window))
        return;
    askedPermission = true;
    if (Notification.permission === 'default') {
        try {
            Notification.requestPermission();
        }
        catch { }
    }
});

async function checkNotify() {
    if (!me || notifyBusy)
        return;
    const uid = me.id;
    notifyBusy = true;
    try {
        const r = await api('/notifications');
        if (!me || me.id !== uid)
            return;
        // first check after login: just show the counter, no sound for things that were already waiting
        const fresh = lastNid === null ? [] : r.notifications.filter(n => n.id > lastNid && !n.read);
        notes = r.notifications;
        unread = r.unread;
        lastNid = Math.max(lastNid || 0, ...notes.map(n => n.id));
        paintBadge();
        paintPanel();
        if (fresh.length) {
            ring(fresh[0]);
            syncOrders();
        }
    }
    catch { }
    finally {
        notifyBusy = false;
    }
}

// Called on every page change: starts (or resets) watching when the logged-in person changes.
function notifyBoot() {
    const id = me ? me.id : null;
    if (id === notifyUid)
        return;
    notifyUid = id;
    lastNid = null;
    notes = [];
    unread = 0;
    closePanel();
    if (id)
        checkNotify();
}

setInterval(checkNotify, 6000);

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        document.title = baseTitle;
        checkNotify();
    }
});
