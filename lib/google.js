'use strict';

// "Sign in with Google": checks the Google sign-in token with Google itself and downloads the account's profile photo.
const imgLib = require('./image');

// Returns {email,name,picture} when Google confirms the token is genuine, was issued for THIS app and the email is verified.
async function verify(credential, clientId, f = fetch) {
    if (!clientId || typeof credential !== 'string' || credential.length < 20 || credential.length > 4096)
        return null;
    const r = await f('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { signal: AbortSignal.timeout(6000) });
    if (!r.ok)
        return null;
    const t = await r.json();
    if (t.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss) || String(t.email_verified) !== 'true' || !t.email || !(Number(t.exp) * 1000 > Date.now()))
        return null;
    return { email: String(t.email).toLowerCase(), name: String(t.name || '').trim(), picture: String(t.picture || '') };
}

// Saves the Google profile photo into the uploads folder. Only https://*.googleusercontent.com is accepted.
async function photo(url, dir, f = fetch) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' || !/(^|\.)googleusercontent\.com$/.test(u.hostname))
            return null;
        const big = url.replace(/=s\d+(-c)?$/, '=s400-c');
        const r = await f(big, { signal: AbortSignal.timeout(6000) });
        if (!r.ok)
            return null;
        const name = imgLib.saveBuf(dir, Buffer.from(await r.arrayBuffer()));
        return name ? '/img/uploads/' + name : null;
    }
    catch {
        return null;
    }
}

module.exports = { verify, photo };
