'use strict';

// Automated API test: starts the server on a temporary database and verifies core flows and security rules.
const { spawn } = require('child_process'), os = require('os'), path = require('path');

const PORT = 3999, B = 'http://localhost:' + PORT + '/api', DB = path.join(os.tmpdir(), 'cafe-test-' + Date.now() + '.db');
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DB_FILE: DB, NODE_PATH: process.env.NODE_PATH || '' }, stdio: 'ignore' });
let fails = 0;

const ok = (n, c) => {
    console.log((c ? 'PASS  ' : 'FAIL  ') + n);
    if (!c)
        fails++;
};

const call = async (m, u, b, c) => {
    const r = await fetch(B + u, {
        method: m,
        headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
        body: b ? JSON.stringify(b) : undefined
    });
    return { s: r.status, d: await r.json().catch(() => ({})), c: (r.headers.get('set-cookie') || '').split(';')[0] };
};

(async () => {
    await new Promise(r => setTimeout(r, 1000));
    try {
        const reg = (o) => call('POST', '/register', {
            userType: 'student',
            name: 'Test User',
            idNumber: 'T-100',
            email: 'test.user@cspc.edu.ph',
            password: 'Passw0rd1',
            ...o
        });
        ok('Wrong password rejected', (await call('POST', '/login', { email: 'juan.delacruz@cspc.edu.ph', password: 'bad' })).s === 401);
        ok('Login by ID number no longer works', (await call('POST', '/login', { email: '2024-0001', password: 'Student@123' })).s === 401);
        ok('Weak password rejected on register', (await reg({ password: 'abc' })).s === 400);
        ok('Non-CSPC email rejected', (await reg({ email: 'test@gmail.com' })).s === 400);
        ok('Look-alike domain rejected', (await reg({ email: 'test@evilcspc.edu.ph' })).s === 400);
        ok('Invalid user type rejected', (await reg({ userType: 'hacker' })).s === 400);
        ok('Staff sign-up without access code rejected', (await reg({ userType: 'staff', idNumber: 'ST-9', email: 'st9@cspc.edu.ph' })).s === 403);
        ok('Staff sign-up closed until staff set a code', (await reg({ userType: 'staff', staffCode: 'Anything-123', idNumber: 'ST-8', email: 'st8@cspc.edu.ph' })).s === 403);
        ok('Register info says staff sign-up is closed', (await call('GET', '/register-info')).d.staffSignup === false);
        const T0 = (await call('POST', '/login', { email: 'staff@cspc.edu.ph', password: 'Staff@123' })).c;
        ok('Customer cannot set staff code', (await call('PUT', '/staff/access-code', { code: 'Hack-Code-1234', password: 'Student@123' }, (await call('POST', '/login', { email: 'juan.delacruz@cspc.edu.ph', password: 'Student@123' })).c)).s === 403);
        ok('Staff code needs correct password', (await call('PUT', '/staff/access-code', { code: 'Cafe-Staff-2026', password: 'wrong' }, T0)).s === 400);
        ok('Too-short staff code rejected', (await call('PUT', '/staff/access-code', { code: 'short', password: 'Staff@123' }, T0)).s === 400);
        ok('Staff can set the access code', (await call('PUT', '/staff/access-code', { code: 'Cafe-Staff-2026', password: 'Staff@123' }, T0)).d.enabled === true);
        ok('Staff sign-up without access code rejected', (await reg({ userType: 'staff', idNumber: 'ST-9', email: 'st9@cspc.edu.ph' })).s === 403);
        ok('Old default code no longer works', (await reg({ userType: 'staff', staffCode: 'CSPC-STAFF-2026', idNumber: 'ST-9', email: 'st9@cspc.edu.ph' })).s === 403);
        ok('Staff sign-up with staff-chosen code accepted', (await reg({ userType: 'staff', staffCode: 'Cafe-Staff-2026', idNumber: 'ST-9', email: 'st9@cspc.edu.ph' })).s === 200);
        ok('Staff can change the code; old one stops working', (await call('PUT', '/staff/access-code', { code: 'New-Code-98765', password: 'Staff@123' }, T0)).s === 200 && (await reg({ userType: 'staff', staffCode: 'Cafe-Staff-2026', idNumber: 'ST-7', email: 'st7@cspc.edu.ph' })).s === 403);
        const ST = (await call('POST', '/login', { email: 'st9@cspc.edu.ph', password: 'Passw0rd1' })).c;
        ok('New staff account can open staff pages', (await call('GET', '/audit', null, ST)).s === 200);
        for (const t of ['student', 'employee', 'instructor', 'administrator'])
            ok('Register as ' + t, (await reg({ userType: t, idNumber: 'T-' + t, email: t + '@cspc.edu.ph' })).s === 200);
        ok('Duplicate registration rejected', (await reg({ userType: 'student', idNumber: 'T-student', email: 'student@cspc.edu.ph' })).s === 409);
        const S = (await call('POST', '/login', { email: 'juan.delacruz@cspc.edu.ph', password: 'Student@123' })).c, T = (await call('POST', '/login', { email: 'staff@cspc.edu.ph', password: 'Staff@123' })).c;
        ok('Customer and staff login', !!S && !!T);
        const I = (await call('POST', '/login', { email: 'instructor@cspc.edu.ph', password: 'Passw0rd1' })).c;
        ok('Instructor can log in and see menu', (await call('GET', '/menu', null, I)).s === 200);
        ok('Profile update works', (await call('PATCH', '/profile', {
            userType: 'instructor',
            name: 'Instr Uctor',
            idNumber: 'T-instructor',
            department: 'IT Dept',
            contact: '09171234567'
        }, I)).d.user?.department === 'IT Dept');
        ok('Profile ID collision rejected', (await call('PATCH', '/profile', { userType: 'instructor', name: 'Instr Uctor', idNumber: '2024-0001' }, I)).s === 409);
        ok('Unauthenticated request blocked', (await call('GET', '/menu')).s === 401);
        ok('Customer blocked from staff API', (await call('GET', '/reports/daily', null, S)).s === 403);
        ok('Staff can read audit log', (await call('GET', '/audit', null, T)).s === 200);
        const sls = (await call('GET', '/slots', null, S)).d.slots;
        ok('Slots carry AM/PM', sls.every(x => x.period === 'AM' || x.period === 'PM') && /AM|PM/.test(sls[0].label) && sls.some(x => x.period === 'AM') && sls.some(x => x.period === 'PM'));
        const sl = (await call('GET', '/slots', null, S)).d.slots.find(x => !x.past && x.left > 0);
        if (!sl)
            console.log('SKIP  Order tests (no pickup slot left today)');
        else {
            ok('Out-of-stock item rejected', (await call('POST', '/orders', { items: [{ id: 7, qty: 1 }], slot: sl.id }, S)).s === 409);
            let r = await call('POST', '/orders', { items: [{ id: 1, qty: 2 }], slot: sl.id }, S);
            const no = r.d.order && r.d.order.no;
            ok('Order placed, total computed by server (60x2+5=125)', r.s === 200 && r.d.order.total === 125);
            const qr = r.d.order.qr;
            ok('Order has signed QR code', /^CSPC\.\d{11}\.[\w-]{10}$/.test(qr));
            ok('Customer cannot use scan API', (await call('POST', '/scan', { code: qr }, S)).s === 403);
            ok('Tampered QR rejected', (await call('POST', '/scan', { code: qr.slice(0, -1) + (qr.endsWith('a') ? 'b' : 'a') }, T)).s === 400);
            ok('Garbage QR rejected', (await call('POST', '/scan', { code: 'hello' }, T)).s === 400);
            const sc = (await call('POST', '/scan', { code: qr }, T)).d;
            ok('Valid QR looks up order (verified, today)', sc.verified === true && sc.today === true && sc.order.no === no && sc.order.customerId === '2024-0001');
            ok('Invalid status jump rejected', (await call('PATCH', '/orders/' + no + '/status', { status: 'ready' }, T)).s === 400);
            for (const st of ['preparing', 'ready', 'claimed'])
                ok('Status -> ' + st, (await call('PATCH', '/orders/' + no + '/status', { status: st }, T)).s === 200);
            ok('Claimed order cannot be cancelled', (await call('PATCH', '/orders/' + no + '/cancel', {}, S)).s === 400);
            const before = (await call('GET', '/menu', null, S)).d.menu.find(m => m.id === 2).stock;
            r = await call('POST', '/orders', { items: [{ id: 2, qty: 1 }], slot: sl.id }, S);
            ok('Pending order cancelled', (await call('PATCH', '/orders/' + r.d.order.no + '/cancel', {}, S)).s === 200);
            ok('Stock restored after cancellation', (await call('GET', '/menu', null, S)).d.menu.find(m => m.id === 2).stock === before);
            // menu photo upload (staff only, real image bytes only)
            const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(40)]).toString('base64');
            const ni = (await call('POST', '/menu', { name: 'Photo Test Item', cat: 'Snacks', price: 10, stock: 5 }, T)).d.item;
            ok('Customer cannot upload a menu photo', (await call('POST', '/menu/' + ni.id + '/image', { data: png }, S)).s === 403);
            ok('Non-image upload rejected', (await call('POST', '/menu/' + ni.id + '/image', { data: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') }, T)).s === 400);
            const up = await call('POST', '/menu/' + ni.id + '/image', { data: png }, T);
            ok('Customer cannot delete an item', (await call('DELETE', '/menu/' + ni.id, null, S)).s === 403);
            ok('Staff can delete an item', (await call('DELETE', '/menu/' + ni.id, null, T)).s === 200);
            ok('Deleted item is hidden from the menu', !(await call('GET', '/menu', null, S)).d.menu.some(m => m.id === ni.id));
            ok('Deleted item cannot be ordered', (await call('POST', '/orders', { items: [{ id: ni.id, qty: 1 }], slot: sl.id }, S)).s === 400);
            ok('Staff can upload a menu photo', up.s === 200 && /^\/img\/uploads\/[0-9a-f]{16}\.png$/.test(up.d.item.img));
            ok('Daily report counts completed order', (await call('GET', '/reports/daily', null, T)).d.orders >= 1);
        }
    }
    catch (e) {
        console.log('FAIL  Unexpected error: ' + e.message);
        fails++;
    }
    console.log(fails ? '\n' + fails + ' test(s) failed' : '\nAll tests passed');
    srv.kill();
    process.exit(fails ? 1 : 0);
})();
