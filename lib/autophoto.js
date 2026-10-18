'use strict';

// Looks for a real, free-licensed photo of an item on Wikimedia Commons by its name and returns the image bytes.
// Needs internet on the server. The result is a best guess: staff can always replace the photo with their own.
const API = process.env.COMMONS_API || 'https://commons.wikimedia.org/w/api.php';

const UA = 'CSPC-Cafeteria-PreOrder/1.1 (school capstone project)';
const BAD = /\b(map|logo|flag|diagram|drawing|illustration|icon|poster|menu|sign|chart|vector|painting|cartoon|screenshot|packag(?:e|ing) design|restaurant exterior|people|crowd)\b/i;
const strip = h => String(h || '').replace(/<[^>]*>/g, '').trim();

const okHost = u => {
    try {
        const h = new URL(u);
        return h.protocol === 'https:' && (h.hostname === 'upload.wikimedia.org' || h.hostname.endsWith('.wikimedia.org'));
    }
    catch {
        return false;
    }
};

const get = async (url, bin) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok)
        throw new Error('HTTP ' + r.status);
    return bin ? Buffer.from(await r.arrayBuffer()) : r.json();
};

async function find(name, cat) {
    const hint = cat === 'Drinks' ? 'drink' : 'food';
    const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
    const d = await get(API + '?' + new URLSearchParams({
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrsearch: name + ' ' + hint + ' filetype:bitmap',
        gsrnamespace: '6',
        gsrlimit: '15',
        prop: 'imageinfo',
        iiprop: 'url|mime|size|extmetadata',
        iiurlwidth: '800'
    }));
    const pages = Object.values((d.query && d.query.pages) || {}).sort((a, b) => a.index - b.index);
    const out = [];
    for (const p of pages) {
        const i = p.imageinfo && p.imageinfo[0];
        if (!i || i.mime !== 'image/jpeg' || i.width < 600 || i.height < 400 || BAD.test(p.title) || !okHost(i.thumburl || i.url))
            continue;
        const t = p.title.toLowerCase(), hits = words.filter(w => t.includes(w)).length;
        if (words.length && !hits)
            continue; // title must mention at least one word of the item name
        const m = i.extmetadata || {};
        out.push({
            hits,
            url: i.thumburl || i.url,
            title: p.title.replace(/^File:/, ''),
            author: strip(m.Artist && m.Artist.value) || 'Unknown',
            license: strip(m.LicenseShortName && m.LicenseShortName.value) || 'See page',
            page: i.descriptionurl
        });
    }
    return out.sort((a, b) => b.hits - a.hits).slice(0, 4);
}

async function photoFor(name, cat) {
    for (const c of await find(name, cat)) {
        try {
            const buf = await get(c.url, true);
            return { buf, credit: c };
        }
        catch { }
    }
    return null;
}

module.exports = { photoFor };
