'use strict';

/* Downloads a real photo for every menu item from Wikimedia Commons (free-licensed images).
   Usage:  npm run images           (downloads only the photos that are missing)
           npm run images -- --force (re-download all)
   Needs internet. Photos are saved to public/img/food/<slug>.jpg and the author + license of each
   photo is written to public/img/food/CREDITS.md (please keep it: many licenses require attribution).
   Always look at the results; if one is wrong, replace that file with your own photo of the same name. */

const fs=require('fs'),path=require('path');
const OUT=path.join(__dirname,'..','public','img','food'),force=process.argv.includes('--force');
const API=process.env.COMMONS_API||'https://commons.wikimedia.org/w/api.php',WIKI=process.env.WIKI_API||'https://en.wikipedia.org/w/api.php',UA='CSPC-Cafeteria-PreOrder/1.1 (school capstone project; image fetch script)';

// slug -> search words used on Wikimedia Commons

const Q={
'chicken-adobo':'chicken adobo',
'pork-sinigang':'pork sinigang',
'spaghetti':'Filipino spaghetti',
'pancit-canton':'pancit canton',
'iced-tea':'iced tea glass',
'rice':'steamed white rice bowl',
'fried-egg':'fried egg sunny side up',
'leche-flan':'leche flan',
'pork-sisig':'pork sisig',
'beef-tapa':'beef tapa tapsilog',
'chicken-tinola':'chicken tinola',
'lechon-kawali':'lechon kawali',
'beef-caldereta':'beef caldereta',
'fried-chicken':'fried chicken',
'siomai':'siomai dumpling',
'lumpia-shanghai':'lumpiang shanghai',
'banana-cue':'banana cue',
'french-fries':'french fries',
'fish-ball':'Filipino fish ball street food',
'siopao-asado':'siopao asado',
'buko-juice':'buko juice coconut',
'calamansi-juice':'calamansi juice',
'mango-shake':'mango shake',
'sago-t-gulaman':'sago at gulaman',
'brewed-coffee':'cup of coffee',
'milk-tea':'bubble milk tea',
'bottled-water':['bottle of mineral water','plastic bottle drinking water','water bottle 500 ml'],
'halo-halo':'halo-halo Filipino dessert glass',
'turon':['turon Filipino banana spring roll','turon saba lumia fried','turon dessert Philippines'],
'maja-blanca':'maja blanca',
'biko':'biko rice cake',
'cassava-cake':'cassava cake',
'buko-pie':'buko pie'
};

// Items that were picked wrongly by a plain search before. For these, the lead photo of the matching Wikipedia article is used first
// (that photo is chosen by Wikipedia editors for exactly that dish), and unwanted search results are blocked by words in their title.
const WIKI_PAGES={'halo-halo':['Halo-halo'],'turon':['Turon (food)','Turon','Turón'],'bottled-water':[]};
const BLOCK={
 'halo-halo':/sun|optical|phenomenon|halo\s*(?:effect|ring)|sky|moon|ice crystal|antarctic|pole|cloud|angel|nimbus|saint/i,
 'bottled-water':/purifier|filter|collage|dispenser|gallon|jug|machine|india|plant|cooler|tap|faucet|reverse|osmosis|home water|truck|delivery|crowd|label|vending/i,
 'turon':/mapa|map|flag|logo|spain|spanish|nougat|turr[oó]n de|town|city|municipality/i
};
const MIN_BYTES=6000;
const slugs=Object.keys(Q);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const strip=h=>String(h||'').replace(/<[^>]*>/g,'').trim();

async function get(url,bin){
        for(let i=0;i<4;i++){
                const r=await fetch(url,{headers:{'User-Agent':UA}});
                
                if(r.status===429||r.status>=500)
                 {await sleep(2000*(i+1));
                        continue
                }
                        
        if(!r.ok)throw new Error('HTTP '+r.status);
        
        return bin?Buffer.from(await r.arrayBuffer()):r.json()
     }
     throw new Error('too many retries')
}

const meta=(p,i)=>{const m=i.extmetadata||{};return{url:i.thumburl||i.url,page:i.descriptionurl,title:p.title.replace(/^File:/,''),author:strip(m.Artist&&m.Artist.value)||'Unknown',license:strip(m.LicenseShortName&&m.LicenseShortName.value)||'See page'}};
const infoParams={action:'query',format:'json',prop:'imageinfo',iiprop:'url|mime|size|extmetadata',iiurlwidth:'800'};

// 1) the lead photo of a Wikipedia article (e.g. "Halo-halo")
async function fromWikipedia(slug){
  const out=[];
  for(const t of WIKI_PAGES[slug]||[]){
    try{
      const d=await get(WIKI+'?'+new URLSearchParams({action:'query',format:'json',redirects:'1',prop:'pageimages',piprop:'name',titles:t}));
      const pg=Object.values((d.query&&d.query.pages)||{})[0];
      if(!pg||pg.missing!==undefined||!pg.pageimage)continue;
      const name='File:'+pg.pageimage;if(BLOCK[slug]&&BLOCK[slug].test(name))continue;
      const c=await get(API+'?'+new URLSearchParams({...infoParams,titles:name}));
      const p=Object.values((c.query&&c.query.pages)||{})[0],i=p&&p.imageinfo&&p.imageinfo[0];
      if(i&&i.mime==='image/jpeg'&&i.width>=500&&i.height>=350){out.push(meta(p,i));break}
    }catch{}
  }
  return out;
}
// 2) Wikimedia Commons search (one or several queries), skipping results whose title matches the block list for that dish
async function find(q,slug){
  const bl=BLOCK[slug],out=[];
  for(const one of [].concat(q)){
    const d=await get(API+'?'+new URLSearchParams({...infoParams,generator:'search',gsrsearch:one+' filetype:bitmap',gsrnamespace:'6',gsrlimit:'20'}));
    const pages=Object.values((d.query&&d.query.pages)||{}).sort((a,b)=>a.index-b.index);
    for(const p of pages){
      const i=p.imageinfo&&p.imageinfo[0];
      if(!i||i.mime!=='image/jpeg'||i.width<600||i.height<400)continue;
      if(bl&&bl.test(p.title))continue;
      out.push(meta(p,i));
    }
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const credits = [];
  let ok = 0, miss = [];

  const cf = path.join(OUT, 'CREDITS.md');
  const old = fs.existsSync(cf)
    ? fs.readFileSync(cf, 'utf8').split('\n')
        .filter(l => l.startsWith('| ') && !l.startsWith('| File') && !l.startsWith('|---'))
    : [];

  for (const s of slugs) {
    const f = path.join(OUT, s + '.jpg');

    const have = fs.existsSync(f) && fs.statSync(f).size >= MIN_BYTES;
    if (have && !force) {
      console.log('skip  ', s);
      continue;
    }

    try {
      const cands = [...(await fromWikipedia(s)), ...(await find(Q[s], s))]
        .filter((c, n, arr) => arr.findIndex(x => x.url === c.url) === n).slice(0, 6);   // try the best few candidates in order

      if (!cands.length) {
        miss.push(s);
        console.log('MISSING', s);
        continue;
      }

      let r = null;
      for (const c of cands) {
        try {
          const buf = await get(c.url, true);
          if (buf.length < MIN_BYTES || buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('not a valid photo');
          fs.writeFileSync(f, buf);
          r = c;
          break;
        } catch (e) {
          console.log('  retry ', s, '(', c.title, ':', e.message, ')');
        }
      }

      if (!r) {
        miss.push(s);
        console.log('ERROR  ', s, 'no usable photo downloaded');
        continue;
      }

      ok++;
      console.log('saved  ', s, '<-', r.title);

      credits.push(
        `| ${s}.jpg | ${r.title.replace(/\|/g, '/')} | ${r.author.replace(/\|/g, '/').slice(0, 80)} | ${r.license} | ${r.page} |`
      );
    } catch (e) {
      miss.push(s);
      console.log('ERROR  ', s, e.message);
    }

    await sleep(600);
  }

  const keep = old.filter(l => !credits.some(c => c.split('|')[1] === l.split('|')[1]));

  fs.writeFileSync(
    cf,
    '# Photo credits (Wikimedia Commons)\n\n' +
    '| File | Original title | Author | License | Source |\n' +
    '|---|---|---|---|---|\n' +
    [...keep, ...credits].join('\n') +
    '\n'
  );

  console.log(
    `\nDone: ${ok} downloaded.` +
    (miss.length
      ? ` Not found: ${miss.join(', ')} (put your own ${'<name>'}.jpg in public/img/food/).`
      : '')
  );
})();
