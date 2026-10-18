'use strict';
const express = require('express'), crypto = require('crypto'), path = require('path'), fs = require('fs');
const imgLib = require('./lib/image'), autoPhoto = require('./lib/autophoto'), google = require('./lib/google');
const GID = process.env.GOOGLE_CLIENT_ID || ''; // Google sign-in is shown only when this is set (see README)

// menu photos uploaded by staff; kept next to the database so they live on the same disk
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.env.DB_FILE ? path.dirname(path.resolve(process.env.DB_FILE)) : path.join(__dirname, 'database'), 'uploads');

const db = require('./database/db');
const app = express(), PORT = process.env.PORT || 3000, CAP = 10, FEE = 5;

// Behind a tunnel or reverse proxy (Cloudflare Tunnel, ngrok, Nginx...) every visitor would look like the same IP address,
// so the login limit would lock everybody out. Start with TRUST_PROXY=1 in that case so the real visitor IP is used.
if (process.env.TRUST_PROXY)
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
const EMAIL_DOMAIN = (process.env.EMAIL_DOMAIN || 'cspc.edu.ph').toLowerCase(), TYPES = ['student', 'employee', 'instructor', 'administrator'];
const emailOk = e => /^[^\s@]+@[^\s@]+$/.test(e) && (e.split('@')[1] === EMAIL_DOMAIN || e.split('@')[1].endsWith('.' + EMAIL_DOMAIN));
const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(p, s, 64).toString('hex');

const verify = (p, h) => {
    const [s, k] = h.split(':'), a = Buffer.from(k, 'hex'), b = crypto.scryptSync(p, s, 64);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const one = (sql, ...a) => db.prepare(sql).get(...a), all = (sql, ...a) => db.prepare(sql).all(...a), run = (sql, ...a) => db.prepare(sql).run(...a);

/* ---- first-run setup: demo accounts and session secret ---- */
if (!one('SELECT 1 FROM users LIMIT 1')) {
    const q = 'INSERT INTO users(name,id_number,email,role,user_type,department,password_hash) VALUES(?,?,?,?,?,?,?)';
    run(q, 'Juan Dela Cruz', '2024-0001', 'juan.delacruz@cspc.edu.ph', 'customer', 'student', 'BS Information Technology', hash('Student@123'));
    run(q, 'Cafeteria Staff', 'STAFF-01', 'staff@cspc.edu.ph', 'staff', 'staff', 'Cafeteria', hash('Staff@123'));
}

let SECRET = (one("SELECT value v FROM settings WHERE key='secret'") || {}).v;

if (!SECRET) {
    SECRET = crypto.randomBytes(32).toString('hex');
    run("INSERT INTO settings(key,value) VALUES('secret',?)", SECRET);
}

/* ---- staff access code: decided and changed by cafeteria staff (stored only as a hash) ---- */
const getSet = k => (one('SELECT value v FROM settings WHERE key=?', k) || {}).v, putSet = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v), delSet = k => run('DELETE FROM settings WHERE key=?', k);

if (!getSet('staff_code') && process.env.STAFF_CODE && process.env.STAFF_CODE.length >= 8)
    putSet('staff_code', hash(process.env.STAFF_CODE)); // optional one-time starting code; staff can change it in the app

const codeOk = c => typeof c === 'string' && c.length >= 8 && c.length <= 40 && c === c.trim();

/* ---- helpers ---- */
const U = r => ({
    id: r.id,
    name: r.name,
    idNumber: r.id_number,
    email: r.email,
    role: r.role,
    userType: r.user_type,
    department: r.department,
    contact: r.contact,
    joined: r.created_at,
    photo: r.photo || '',
    needsPassword: r.pw_set === 0
});

const MI = r => ({
    id: r.id,
    name: r.name,
    cat: r.category,
    price: r.price,
    stock: r.stock,
    prep: r.prep_minutes,
    desc: r.description,
    ing: r.ingredients,
    all: r.allergens,
    rating: r.rating,
    img: r.image
});

const ORD = 'SELECT o.*,u.name customer,u.id_number customer_id,u.user_type customer_type FROM orders o JOIN users u ON u.id=o.user_id';
const qrCode = no => 'CSPC.' + no + '.' + crypto.createHmac('sha256', SECRET).update('qr:' + no).digest('base64url').slice(0, 10);

const O = r => {
    if (!r)
        return null;
    const times = {};
    all('SELECT status,changed_at FROM order_status_log WHERE order_id=? ORDER BY id', r.id).forEach(x => times[x.status] = x.changed_at);
    return {
        no: r.order_no,
        day: r.order_date,
        userId: r.user_id,
        customer: r.customer,
        customerId: r.customer_id,
        customerType: r.customer_type,
        items: all('SELECT item_id id,name,unit_price price,quantity qty FROM order_items WHERE order_id=?', r.id),
        slot: r.slot,
        slotLabel: r.slot_label,
        fee: r.service_fee,
        total: r.total,
        status: r.status,
        times,
        created: r.created_at,
        qr: qrCode(r.order_no)
    };
};

const log = (u, a, d) => run('INSERT INTO audit_log(created_at,user_ref,role,action,detail) VALUES(?,?,?,?,?)', new Date().toISOString(), u.id_number, u.user_type, a, d || '');

// In-app notifications are saved in the database, so a person still sees them if they were offline when the status changed.
const notifyUser = (userId, orderNo, kind, title, body) => {
    run('INSERT INTO notifications(user_id,order_no,kind,title,body,created_at) VALUES(?,?,?,?,?,?)', userId, orderNo, kind, title, body, new Date().toISOString());
    run('DELETE FROM notifications WHERE user_id=? AND id<=(SELECT id FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1 OFFSET 100)', userId, userId); // keep the newest 100 per person
};

const notifyStaff = (orderNo, kind, title, body) => all("SELECT id FROM users WHERE role='staff'").forEach(u => notifyUser(u.id, orderNo, kind, title, body));

// What the customer is told when staff move their order forward.
const STATUS_NOTE = {
    preparing: no => ['Your order is being prepared', 'Order #' + no + ' is now being prepared by the cafeteria. We will notify you as soon as it is ready.'],
    ready: no => ['Your order is ready for pickup!', 'Order #' + no + ' is ready. You can now claim it at the cafeteria counter. Please show your QR pass to the staff.'],
    claimed: no => ['Order completed', 'You have claimed order #' + no + '. Thank you for ordering at the CSPC Cafeteria. Enjoy your meal!']
};

const today = () => {
    const d = new Date();
    return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
};

const sign = o => {
    const p = Buffer.from(JSON.stringify(o)).toString('base64url');
    return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
};

const unsign = t => {
    try {
        const [p, s] = t.split('.'), e = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
        if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e)))
            return null;
        const o = JSON.parse(Buffer.from(p, 'base64url'));
        return o.exp > Date.now() ? o : null;
    }
    catch {
        return null;
    }
};

const tok = r => ((r.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('t=')) || '').slice(2);

const auth = role => (q, s, n) => {
    const o = unsign(tok(q)), u = o && one('SELECT * FROM users WHERE id=?', o.id);
    if (!u)
        return s.status(401).json({ error: 'Please log in.' });
    if (role && u.role !== role)
        return s.status(403).json({ error: 'Not allowed.' });
    q.user = u;
    n();
};

const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const strong = p => typeof p === 'string' && p.length >= 8 && p.length <= 100 && /[a-zA-Z]/.test(p) && /\d/.test(p);

const A = fn => (q, s) => {
    try {
        fn(q, s);
    }
    catch (e) {
        console.error(e);
        s.status(500).json({ error: 'Server error.' });
    }
};

/* ---- middleware ---- */
app.disable('x-powered-by');

app.use((q, s, n) => {
    s.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(self)',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-src https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/"
    });
    n();
});

app.use('/api', (q, s, n) => {
    s.set('Cache-Control', 'no-store');
    n();
}); // always fresh: deleted items and the signed-in profile must never come from a browser cache

app.use('/api', (q, s, n) => {
    if (q.method !== 'GET' && !(q.headers['content-type'] || '').includes('application/json'))
        return s.status(415).json({ error: 'JSON required.' });
    n();
});

const smallJson = express.json({ limit: '10kb' }), photoJson = express.json({ limit: '3mb' }); // only the photo upload route may send a big body
app.use((q, s, n) => (q.method === 'POST' && /^\/api\/(menu\/\d+\/image|profile\/photo)$/.test(q.path) ? photoJson : smallJson)(q, s, n));
app.use('/img/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true, index: false }));

app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (r, f) => {
        if (/\.(html|js|css)$/.test(f))
            r.setHeader('Cache-Control', 'no-cache');
    } })); // browsers must re-check code files, so an update is never hidden by an old cached copy

/* ---- accounts ---- */
const tries = {};

const contactOk = c => !c || /^[0-9+\-\s()]{7,20}$/.test(c);

app.post('/api/register', A((q, s) => {
    const b = q.body, name = str(b.name, 60), id = str(b.idNumber, 20), email = str(b.email, 80).toLowerCase(), type = b.userType, dept = str(b.department, 60), contact = str(b.contact, 20), pw = b.password;
    const staff = type === 'staff';
    if (!staff && !TYPES.includes(type))
        return s.status(400).json({ error: 'Choose if you are a student, employee, instructor, administrator or cafeteria staff.' });
    if (staff) {
        const sh = getSet('staff_code');
        if (!sh)
            return s.status(403).json({ error: 'Cafeteria staff sign-up is closed. A current cafeteria staff member must set an access code first.' });
        const t = tries['sc' + q.ip] = (tries['sc' + q.ip] || []).filter(x => Date.now() - x < 9e5);
        if (t.length >= 5)
            return s.status(429).json({ error: 'Too many wrong access codes. Try again in 15 minutes.' });
        if (typeof b.staffCode !== 'string' || !verify(b.staffCode, sh)) {
            t.push(Date.now());
            return s.status(403).json({ error: 'Invalid staff access code. Ask the cafeteria staff for the code.' });
        }
    }
    if (name.length < 2)
        return s.status(400).json({ error: 'Enter your full name.' });
    if (!/^[\w-]{3,20}$/.test(id))
        return s.status(400).json({ error: 'Enter a valid ID number (letters, numbers and dashes).' });
    if (!emailOk(email))
        return s.status(400).json({ error: 'Use your CSPC email (ending in @' + EMAIL_DOMAIN + ').' });
    if (!contactOk(contact))
        return s.status(400).json({ error: 'Enter a valid contact number.' });
    if (!strong(pw))
        return s.status(400).json({ error: 'Password needs 8+ characters with letters and numbers.' });
    if (one('SELECT 1 FROM users WHERE email=? OR id_number=?', email, id))
        return s.status(409).json({ error: 'ID number or CSPC email is already registered.' });
    run('INSERT INTO users(name,id_number,email,role,user_type,department,contact,password_hash) VALUES(?,?,?,?,?,?,?,?)', name, id, email, staff ? 'staff' : 'customer', type, dept, contact, hash(pw));
    if (staff)
        run('INSERT INTO audit_log(created_at,user_ref,role,action,detail) VALUES(?,?,?,?,?)', new Date().toISOString(), id, 'staff', 'STAFF_REGISTERED', email);
    s.json({ ok: true });
}));

app.post('/api/login', A((q, s) => {
    const t = tries[q.ip] = (tries[q.ip] || []).filter(x => Date.now() - x < 9e5);
    if (t.length >= 10)
        return s.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const id = str(q.body.email, 80).toLowerCase(), u = id && one('SELECT * FROM users WHERE email=?', id);
    if (!u || typeof q.body.password !== 'string' || !verify(q.body.password, u.password_hash)) {
        t.push(Date.now());
        return s.status(401).json({ error: 'Incorrect CSPC email or password.' });
    }
    s.cookie('t', sign({ id: u.id, exp: Date.now() + 864e5 }), { httpOnly: true, sameSite: 'strict', maxAge: 864e5, secure: q.secure });
    log(u, 'LOGIN', 'Signed in');
    s.json({ user: U(u) });
}));

// The address that goes inside the pickup QR. A QR made on "localhost" would open nothing on the staff phone, so localhost is swapped for this computer's Wi-Fi address (or set PUBLIC_URL for an online site).
app.get('/api/config', (q, s) => {
    let base = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : q.protocol + '://' + q.get('host');
    if (!process.env.PUBLIC_URL && /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(q.get('host') || '')) {
        const lan = Object.values(require('os').networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
        if (lan)
            base = 'http://' + lan.address + ':' + PORT;
    }
    s.json({ googleClientId: GID, base, version: require('./package.json').version });
});

app.post('/api/google', async (q, s) => {
    try { // sign in (or first-time sign-up) with the school Google account: name, email and photo come from Google
        const t = tries[q.ip] = (tries[q.ip] || []).filter(x => Date.now() - x < 9e5);
        if (t.length >= 10)
            return s.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
        const g = await google.verify(q.body && q.body.credential, GID);
        if (!g || !emailOk(g.email)) {
            t.push(Date.now());
            return s.status(401).json({ error: 'Google sign-in failed. Use your CSPC Google account (ending in @' + EMAIL_DOMAIN + ').' });
        }
        let u = one('SELECT * FROM users WHERE email=?', g.email);
        if (!u) {
            run('INSERT INTO users(name,id_number,email,role,user_type,department,contact,password_hash,pw_set) VALUES(?,?,?,?,?,?,?,?,0)', (g.name || g.email.split('@')[0]).slice(0, 60), 'PENDING-' + crypto.randomBytes(4).toString('hex'), g.email, 'customer', 'student', '', '', hash(crypto.randomBytes(24).toString('hex')));
            u = one('SELECT * FROM users WHERE email=?', g.email);
            log(u, 'REGISTERED_GOOGLE', g.email);
        } // new accounts are always customers; staff accounts still need the staff access code
        if (!u.photo && g.picture) {
            const ph = await google.photo(g.picture, UPLOAD_DIR);
            if (ph) {
                run('UPDATE users SET photo=? WHERE id=?', ph, u.id);
                u = one('SELECT * FROM users WHERE id=?', u.id);
            }
        }
        s.cookie('t', sign({ id: u.id, exp: Date.now() + 864e5 }), { httpOnly: true, sameSite: 'strict', maxAge: 864e5, secure: q.secure });
        log(u, 'LOGIN', 'Signed in with Google');
        s.json({ user: U(u) });
    }
    catch (e) {
        console.error(e);
        s.status(500).json({ error: 'Google sign-in is not available right now.' });
    }
});

app.post('/api/logout', (q, s) => {
    s.clearCookie('t');
    s.json({ ok: true });
});

const myStats = u => {
    if (u.role === 'staff')
        return null;
    const r = one("SELECT COUNT(*) total,SUM(status IN('pending','preparing','ready')) active,SUM(status='claimed') done,SUM(status='cancelled') cancelled FROM orders WHERE user_id=?", u.id);
    return { total: r.total || 0, active: r.active || 0, done: r.done || 0, cancelled: r.cancelled || 0 };
};

app.get('/api/me', auth(), (q, s) => s.json({ user: U(q.user), stats: myStats(q.user) })); // always the account that is signed in (taken from the session cookie)

app.post('/api/password', auth(), A((q, s) => {
    if (q.user.pw_set !== 0 && (typeof q.body.current !== 'string' || !verify(q.body.current, q.user.password_hash)))
        return s.status(400).json({ error: 'Current password is incorrect.' });
    if (!strong(q.body.next))
        return s.status(400).json({ error: 'New password needs 8+ characters with letters and numbers.' });
    run('UPDATE users SET password_hash=?,pw_set=1 WHERE id=?', hash(q.body.next), q.user.id);
    log(q.user, 'PASSWORD_CHANGED');
    s.json({ ok: true });
}));

app.patch('/api/profile', auth(), A((q, s) => {
    const b = q.body, name = str(b.name, 60), id = str(b.idNumber, 20), dept = str(b.department, 60), contact = str(b.contact, 20), u = q.user;
    const type = u.role === 'staff' ? 'staff' : b.userType;
    if (!(u.role === 'staff' || TYPES.includes(type)))
        return s.status(400).json({ error: 'Choose a valid user type.' });
    if (name.length < 2)
        return s.status(400).json({ error: 'Enter your full name.' });
    if (!/^[\w-]{3,20}$/.test(id))
        return s.status(400).json({ error: 'Enter a valid ID number.' });
    if (!contactOk(contact))
        return s.status(400).json({ error: 'Enter a valid contact number.' });
    if (one('SELECT 1 FROM users WHERE id_number=? AND id!=?', id, u.id))
        return s.status(409).json({ error: 'That ID number is already used by another account.' });
    run('UPDATE users SET name=?,id_number=?,user_type=?,department=?,contact=? WHERE id=?', name, id, type, dept, contact, u.id);
    const n = one('SELECT * FROM users WHERE id=?', u.id);
    log(n, 'PROFILE_UPDATED');
    s.json({ user: U(n) });
}));

/* ---- profile picture (each account changes only its own) ---- */
const dropPhoto = u => {
    if (u.photo && u.photo.startsWith('/img/uploads/'))
        fs.unlink(path.join(UPLOAD_DIR, path.basename(u.photo)), () => { });
};

app.post('/api/profile/photo', auth(), A((q, s) => {
    const f = imgLib.save(UPLOAD_DIR, q.body && q.body.data);
    if (!f)
        return s.status(400).json({ error: 'Use a JPG, PNG or WEBP photo (under 1.5 MB).' });
    dropPhoto(q.user);
    run('UPDATE users SET photo=? WHERE id=?', '/img/uploads/' + f, q.user.id);
    log(q.user, 'PROFILE_PHOTO', 'Changed');
    s.json({ user: U(one('SELECT * FROM users WHERE id=?', q.user.id)) });
}));

app.delete('/api/profile/photo', auth(), A((q, s) => {
    dropPhoto(q.user);
    run("UPDATE users SET photo='' WHERE id=?", q.user.id);
    log(q.user, 'PROFILE_PHOTO', 'Removed');
    s.json({ user: U(one('SELECT * FROM users WHERE id=?', q.user.id)) });
}));

/* ---- menu and pickup slots ---- */
app.get('/api/menu', auth(), (q, s) => s.json({ menu: all('SELECT * FROM menu_items WHERE active=1 ORDER BY id').map(MI) }));

const slots = () => {
    const n = new Date(), now = n.getHours() * 60 + n.getMinutes(), used = {}, out = [];
    all("SELECT slot,COUNT(*) c FROM orders WHERE order_date=? AND status!='cancelled' GROUP BY slot", today()).forEach(r => used[r.slot] = r.c);
    const f = x => {
        x %= 1440;
        const h = Math.floor(x / 60);
        return (h % 12 || 12) + ':' + String(x % 60).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
    };
    for (let m = 420; m < 1140; m += 15) {
        const id = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
        out.push({
            id,
            start: f(m),
            label: f(m) + ' – ' + f(m + 15),
            period: m < 720 ? 'AM' : 'PM',
            left: Math.max(0, CAP - (used[id] || 0)),
            past: m + 15 <= now
        });
    }
    return out;
};

app.get('/api/slots', auth(), (q, s) => s.json({ slots: slots() }));

/* ---- orders ---- */
const place = db.transaction((user, lines, sl, sub) => {
    const day = today(), no = day + String(one('SELECT COUNT(*) c FROM orders WHERE order_date=?', day).c + 1).padStart(3, '0'), now = new Date().toISOString();
    const id = run('INSERT INTO orders(order_no,order_date,user_id,slot,slot_label,service_fee,total,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)', no, day, user.id, sl.id, sl.label, FEE, sub + FEE, 'pending', now).lastInsertRowid;
    for (const l of lines) {
        run('INSERT INTO order_items(order_id,item_id,name,category,unit_price,quantity) VALUES(?,?,?,?,?,?)', id, l.id, l.name, l.category, l.price, l.qty);
        run('UPDATE menu_items SET stock=stock-? WHERE id=?', l.qty, l.id);
    }
    run('INSERT INTO order_status_log(order_id,status,changed_at) VALUES(?,?,?)', id, 'pending', now);
    log(user, 'ORDER_PLACED', '#' + no);
    notifyStaff(no, 'new_order', 'New order #' + no, user.name + ' placed an order · pickup ' + sl.label + ' · ₱' + (sub + FEE));
    return no;
});

app.post('/api/orders', auth('customer'), A((q, s) => {
    const items = Array.isArray(q.body.items) ? q.body.items.slice(0, 20) : [];
    if (!items.length)
        return s.status(400).json({ error: 'Your cart is empty.' });
    const sl = slots().find(x => x.id === q.body.slot);
    if (!sl || sl.past || sl.left < 1)
        return s.status(400).json({ error: 'Pickup time is not available. Choose another.' });
    const lines = [], seen = new Set();
    let sub = 0;
    for (const it of items) {
        const m = one('SELECT * FROM menu_items WHERE id=?', it.id), n = Number(it.qty);
        if (m && !m.active)
            return s.status(409).json({ error: m.name + ' is no longer available. Please remove it from your cart.' });
        if (!m || seen.has(m.id) || !Number.isInteger(n) || n < 1 || n > 10)
            return s.status(400).json({ error: 'Invalid cart item.' });
        if (m.stock < n)
            return s.status(409).json({ error: m.name + ' only has ' + m.stock + ' left.' });
        seen.add(m.id);
        lines.push({ ...m, qty: n });
        sub += m.price * n;
    }
    s.json({ order: O(one(ORD + ' WHERE o.order_no=?', place(q.user, lines, sl, sub))) });
}));

app.post('/api/scan', auth('staff'), A((q, s) => {
    const raw = str(q.body.code, 300), f = /CSPC\.\d{11}\.[\w-]{10}/.exec(raw), code = f ? f[0] : raw.slice(0, 60);
    let no = null, verified = false;
    const m = /^CSPC\.(\d{11})\.([\w-]{10})$/.exec(code);
    if (m) {
        const e = Buffer.from(qrCode(m[1])), g = Buffer.from(code);
        if (e.length !== g.length || !crypto.timingSafeEqual(e, g))
            return s.status(400).json({ error: 'Invalid or tampered QR code.' });
        no = m[1];
        verified = true;
    }
    else if (/^\d{11}$/.test(code))
        no = code;
    else
        return s.status(400).json({ error: 'This is not a CSPC cafeteria pickup QR code.' });
    const r = one(ORD + ' WHERE o.order_no=?', no);
    if (!r)
        return s.status(404).json({ error: 'Order not found.' });
    log(q.user, 'ORDER_SCANNED', '#' + no + (verified ? ' (QR)' : ' (manual entry)'));
    s.json({ order: O(r), verified, today: r.order_date === today() });
}));

const mine = (q, r) => r && (q.user.role === 'staff' || r.user_id === q.user.id);
app.get('/api/orders', auth(), (q, s) => s.json({ orders: (q.user.role === 'staff' ? all(ORD + ' ORDER BY o.id DESC') : all(ORD + ' WHERE o.user_id=? ORDER BY o.id DESC', q.user.id)).map(O) }));

app.get('/api/orders/:no', auth(), (q, s) => {
    const r = one(ORD + ' WHERE o.order_no=?', q.params.no);
    if (!mine(q, r))
        return s.status(404).json({ error: 'Order not found.' });
    s.json({ order: O(r) });
});

const setStatus = db.transaction((r, st, u, act) => {
    run('UPDATE orders SET status=? WHERE id=?', st, r.id);
    run('INSERT INTO order_status_log(order_id,status,changed_at) VALUES(?,?,?)', r.id, st, new Date().toISOString());
    log(u, act, '#' + r.order_no + ' set to ' + st);
    if (STATUS_NOTE[st])
        notifyUser(r.user_id, r.order_no, st, ...STATUS_NOTE[st](r.order_no));
    if (act === 'ORDER_CANCELLED')
        notifyStaff(r.order_no, 'cancelled', 'Order #' + r.order_no + ' was cancelled', r.customer + ' cancelled this order. The items were returned to stock.');
});

const FLOW = ['pending', 'preparing', 'ready', 'claimed'];

app.patch('/api/orders/:no/status', auth('staff'), A((q, s) => {
    const r = one(ORD + ' WHERE o.order_no=?', q.params.no);
    if (!r)
        return s.status(404).json({ error: 'Order not found.' });
    if (FLOW.indexOf(q.body.status) !== FLOW.indexOf(r.status) + 1)
        return s.status(400).json({ error: 'Invalid status change.' });
    setStatus(r, q.body.status, q.user, 'ORDER_STATUS');
    s.json({ order: O(one(ORD + ' WHERE o.id=?', r.id)) });
}));

app.patch('/api/orders/:no/cancel', auth('customer'), A((q, s) => {
    const r = one(ORD + ' WHERE o.order_no=? AND o.user_id=?', q.params.no, q.user.id);
    if (!r)
        return s.status(404).json({ error: 'Order not found.' });
    if (r.status !== 'pending')
        return s.status(400).json({ error: 'Only pending orders can be cancelled.' });
    db.transaction(() => {
        all('SELECT item_id,quantity FROM order_items WHERE order_id=?', r.id).forEach(i => run('UPDATE menu_items SET stock=stock+? WHERE id=?', i.quantity, i.item_id));
        setStatus(r, 'cancelled', q.user, 'ORDER_CANCELLED');
    })();
    s.json({ order: O(one(ORD + ' WHERE o.id=?', r.id)) });
}));

/* ---- notifications ---- */
const NT = r => ({ id: r.id, no: r.order_no, kind: r.kind, title: r.title, body: r.body, created: r.created_at, read: !!r.read_at });

app.get('/api/notifications', auth(), (q, s) => s.json({
    notifications: all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30', q.user.id).map(NT),
    unread: one('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL', q.user.id).c
}));

// body { id } marks one notification as read; no id marks them all.
app.post('/api/notifications/read', auth(), A((q, s) => {
    const id = Number(q.body.id), now = new Date().toISOString();
    if (id)
        run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL', now, id, q.user.id);
    else
        run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', now, q.user.id);
    s.json({ ok: true });
}));

/* ---- staff: inventory, reports, audit ---- */
app.patch('/api/menu/:id', auth('staff'), A((q, s) => {
    const m = one('SELECT * FROM menu_items WHERE id=?', +q.params.id);
    if (!m)
        return s.status(404).json({ error: 'Item not found.' });
    const st = Number(q.body.stock), pr = q.body.price === undefined ? m.price : Number(q.body.price);
    if (!Number.isInteger(st) || st < 0 || st > 999 || !(pr >= 0 && pr <= 9999))
        return s.status(400).json({ error: 'Invalid stock or price.' });
    run('UPDATE menu_items SET stock=?,price=? WHERE id=?', st, pr, m.id);
    log(q.user, 'INVENTORY_UPDATE', m.name + ': stock ' + st + ', price ' + pr);
    s.json({ item: MI(one('SELECT * FROM menu_items WHERE id=?', m.id)) });
}));

app.post('/api/menu', auth('staff'), A((q, s) => {
    const b = q.body, name = str(b.name, 40), cat = ['Main Dish', 'Snacks', 'Drinks', 'Dessert'].includes(b.cat) ? b.cat : null, price = Number(b.price), stock = Number(b.stock);
    if (!name || !cat || !(price >= 0 && price <= 9999) || !Number.isInteger(stock) || stock < 0 || stock > 999)
        return s.status(400).json({ error: 'Check the item details.' });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), img = slug && fs.existsSync(path.join(__dirname, 'public', 'img', 'food', slug + '.jpg')) ? '/img/food/' + slug + '.jpg' : ''; // same name as a stock photo? use it
    const id = run('INSERT INTO menu_items(name,category,price,stock,prep_minutes,description,ingredients,allergens,image) VALUES(?,?,?,?,?,?,?,?,?)', name, cat, price, stock, 10, str(b.desc, 120), '—', '—', img).lastInsertRowid;
    log(q.user, 'ITEM_ADDED', name);
    s.json({ item: MI(one('SELECT * FROM menu_items WHERE id=?', id)) });
}));

app.delete('/api/menu/:id', auth('staff'), A((q, s) => {   // "delete" hides the item but keeps the row, so old orders and reports stay correct
    const m = one('SELECT * FROM menu_items WHERE id=? AND active=1', +q.params.id);
    if (!m)
        return s.status(404).json({ error: 'Item not found.' });
    run("UPDATE menu_items SET active=0,stock=0,image='' WHERE id=?", m.id);
    if (m.image && m.image.startsWith('/img/uploads/'))
        fs.unlink(path.join(UPLOAD_DIR, path.basename(m.image)), () => { });
    log(q.user, 'ITEM_DELETED', m.name);
    s.json({ ok: true });
}));

app.post('/api/menu/:id/autophoto', auth('staff'), async (q, s) => {
    try { // finds a real photo of the item on the internet (Wikimedia Commons)
        const m = one('SELECT * FROM menu_items WHERE id=?', +q.params.id);
        if (!m)
            return s.status(404).json({ error: 'Item not found.' });
        const r = await autoPhoto.photoFor(m.name, m.category), f = r && imgLib.saveBuf(UPLOAD_DIR, r.buf);
        if (!f)
            return s.status(404).json({ error: 'No good photo found online for "' + m.name + '". Upload your own photo instead.' });
        run('UPDATE menu_items SET image=? WHERE id=?', '/img/uploads/' + f, m.id);
        if (m.image && m.image.startsWith('/img/uploads/'))
            fs.unlink(path.join(UPLOAD_DIR, path.basename(m.image)), () => { });
        try {
            fs.appendFileSync(path.join(UPLOAD_DIR, 'CREDITS.md'), '| ' + f + ' | ' + m.name.replace(/\|/g, '/') + ' | ' + r.credit.title.replace(/\|/g, '/') + ' | ' + r.credit.author.replace(/\|/g, '/').slice(0, 80) + ' | ' + r.credit.license + ' | ' + r.credit.page + ' |\n');
        }
        catch { }
        log(q.user, 'ITEM_AUTOPHOTO', m.name);
        s.json({ item: MI(one('SELECT * FROM menu_items WHERE id=?', m.id)) });
    }
    catch (e) {
        console.error(e);
        s.status(502).json({ error: 'Could not reach the photo source. Check the internet connection, or upload your own photo.' });
    }
});

app.post('/api/menu/:id/image', auth('staff'), A((q, s) => {
    const m = one('SELECT * FROM menu_items WHERE id=?', +q.params.id);
    if (!m)
        return s.status(404).json({ error: 'Item not found.' });
    const f = imgLib.save(UPLOAD_DIR, q.body && q.body.data);
    if (!f)
        return s.status(400).json({ error: 'Use a JPG, PNG or WEBP photo (under 1.5 MB).' });
    run('UPDATE menu_items SET image=? WHERE id=?', '/img/uploads/' + f, m.id);
    if (m.image && m.image.startsWith('/img/uploads/'))
        fs.unlink(path.join(UPLOAD_DIR, path.basename(m.image)), () => { }); // remove the replaced photo
    log(q.user, 'ITEM_PHOTO', m.name);
    s.json({ item: MI(one('SELECT * FROM menu_items WHERE id=?', m.id)) });
}));

app.get('/api/reports/daily', auth('staff'), (q, s) => {
    const d = today(), os = all("SELECT total FROM orders WHERE order_date=? AND status!='cancelled'", d), total = os.reduce((a, o) => a + o.total, 0);
    const by = all("SELECT oi.name,SUM(oi.quantity) qty FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.order_date=? AND o.status!='cancelled' GROUP BY oi.name ORDER BY qty DESC", d), sum = by.reduce((a, b) => a + b.qty, 0) || 1;
    s.json({
        sales: total,
        orders: os.length,
        avg: os.length ? Math.round(total / os.length) : 0,
        best: by.map(b => ({ name: b.name, qty: b.qty, pct: Math.round(b.qty / sum * 100) }))
    });
});

app.get('/api/register-info', (q, s) => s.json({ staffSignup: !!getSet('staff_code') }));
app.get('/api/staff/access-code', auth('staff'), (q, s) => s.json({ enabled: !!getSet('staff_code'), by: getSet('staff_code_by') || null, at: getSet('staff_code_at') || null }));

app.put('/api/staff/access-code', auth('staff'), A((q, s) => {
    if (typeof q.body.password !== 'string' || !verify(q.body.password, q.user.password_hash))
        return s.status(400).json({ error: 'Your password is incorrect.' });
    if (!codeOk(q.body.code))
        return s.status(400).json({ error: 'Access code must be 8 to 40 characters with no spaces at the start or end.' });
    db.transaction(() => {
        putSet('staff_code', hash(q.body.code));
        putSet('staff_code_by', q.user.name);
        putSet('staff_code_at', new Date().toISOString());
        log(q.user, 'STAFF_CODE_SET', 'Staff access code changed');
    })();
    s.json({ enabled: true, by: q.user.name, at: getSet('staff_code_at') });
}));

app.delete('/api/staff/access-code', auth('staff'), A((q, s) => {
    if (typeof q.body.password !== 'string' || !verify(q.body.password, q.user.password_hash))
        return s.status(400).json({ error: 'Your password is incorrect.' });
    db.transaction(() => {
        ['staff_code', 'staff_code_by', 'staff_code_at'].forEach(delSet);
        log(q.user, 'STAFF_CODE_DISABLED', 'Staff sign-up closed');
    })();
    s.json({ enabled: false });
}));

app.get('/api/audit', auth('staff'), (q, s) => s.json({ log: all('SELECT created_at at,user_ref user,action,detail FROM audit_log ORDER BY id DESC LIMIT 50') }));
app.use('/api', (q, s) => s.status(404).json({ error: 'Not found.' }));
app.use((e, q, s, n) => s.status(400).json({ error: 'Bad request.' }));

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('Cafeteria Pre-Order running at http://localhost:' + PORT);
        // addresses for opening the system from a phone connected to the same Wi-Fi
        const lan = Object.values(require('os').networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal);
        lan.forEach(i => console.log('On a phone on the same Wi-Fi:  http://' + i.address + ':' + PORT));
    });
}
