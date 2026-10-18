// The website worker (scripts/post-preview-worker.js): the page behind a
// shared post link, the /get download link, the universal-links file, and the
// site's redirects. Runs the real worker with a stand-in Supabase and assets.
//
//   node scripts/__tests__/share-page.test.mjs
//   SHARE_DUMP=<dir> node scripts/__tests__/share-page.test.mjs   (also writes the pages, for screenshots)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The worker is plain ESM in a CommonJS package: load a copy as .mjs.
const src = fs.readFileSync(path.join(here, '..', 'post-preview-worker.js'), 'utf8');
const tmp = path.join(here, '..', '..', '.test-build', 'worker.mjs');
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, src);
const worker = (await import(pathToFileURL(tmp).href)).default;
const { cookTime, inviteHandle } = await import(pathToFileURL(tmp).href);

const ID = '10000000-0000-4000-8000-0000000000a1';
const BARE = '10000000-0000-4000-8000-0000000000b2';
const GONE = '10000000-0000-4000-8000-00000000dead';
const HOSTILE = '10000000-0000-4000-8000-0000000000c3';
const DOWN = '10000000-0000-4000-8000-0000000000d4';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

const ROWS = {
  [ID]: {
    photo_url: 'https://x.supabase.co/storage/v1/object/public/photos/u/a.jpg',
    blurb: 'Garlic butter chicken, way too much garlic\nworth it',
    display_name: 'Bryce',
    handle: 'bdubs2004',
    meal_slot: 'dinner',
    avatar_url: 'https://x.supabase.co/storage/v1/object/public/photos/u/me.jpg',
    created_at: new Date(Date.now() - 2 * 86400e3).toISOString(),
    price_level: 2,
    hashtags: ['mexican', 'spicy'],
    recipe_title: 'Garlic Butter Chicken',
    cook_time_minutes: 70,
  },
  [BARE]: {
    photo_url: 'https://x.supabase.co/storage/v1/object/public/photos/u/b.jpg',
    blurb: null,
    display_name: 'Marcus',
    handle: 'marcusa',
    meal_slot: 'lunch',
    avatar_url: null,
    created_at: new Date(Date.now() - 5 * 60e3).toISOString(),
    price_level: null,
    hashtags: [],
    recipe_title: null,
    cook_time_minutes: null,
  },
  [HOSTILE]: {
    photo_url: 'javascript:alert(1)',
    blurb: '</p><script>alert("blurb")</script>',
    display_name: '"><img src=x onerror=alert(1)>',
    handle: 'h"><script>',
    meal_slot: 'dinner<script>',
    avatar_url: 'http://plain.example/me.jpg',
    created_at: 'not a date',
    price_level: 9,
    hashtags: ['ok', '<b>bad</b>', 'x"y'],
    recipe_title: '<img src=x onerror=alert(2)>',
    cook_time_minutes: -5,
  },
};

let calls = 0;
globalThis.fetch = async (url, init) => {
  calls++;
  const { pid } = JSON.parse(init.body);
  if (pid === DOWN) throw new Error('network down');
  return new Response(JSON.stringify(ROWS[pid] ? [ROWS[pid]] : []), { status: 200 });
};
let assetHits = 0;
const env = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_test',
  ASSETS: { fetch: async () => { assetHits++; return new Response('static', { status: 200 }); } },
};
const get = (p, ua = IPHONE) => worker.fetch(new Request('https://niblgo.com' + p, { headers: { 'user-agent': ua } }), env);

let failed = 0;
const check = (name, ok, got) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${got !== undefined && !ok ? '  — got: ' + String(got).slice(0, 300) : ''}`);
};
const dump = process.env.SHARE_DUMP;
const save = (name, html) => { if (dump) { fs.mkdirSync(dump, { recursive: true }); fs.writeFileSync(path.join(dump, name + '.html'), html); } };

// ---- a full post, opened on an iPhone, shared by someone with a handle
let res = await get(`/post/${ID}?from=margesbakes`);
let html = await res.text();
save('full-iphone', html);
check('a shared post answers 200', res.status === 200, res.status);
check('the link preview title says whose meal it is', html.includes('<meta property="og:title" content="Bryce&#39;s dinner on NiblGo">') || html.includes('Bryce’s dinner on NiblGo'), html.match(/og:title" content="[^"]*"/)?.[0]);
check('the link preview uses the food photo', html.includes(`og:image" content="${ROWS[ID].photo_url}"`));
check('the caption is shown as written (line break kept)', html.includes('Garlic butter chicken, way too much garlic\nworth it'));
check('the poster\'s photo, name, handle, meal and when', html.includes(`class="avatar" src="${ROWS[ID].avatar_url}"`) && html.includes('@bdubs2004 · Dinner · 2 days ago'));
check('price and hashtags show as chips', html.includes('>$$</span>') && html.includes('>#mexican</span>') && html.includes('>#spicy</span>'));
check('the recipe is teased by its title and time', html.includes('Garlic Butter Chicken') && html.includes('1 hr 10 min · Full recipe in the app'));
check('on an iPhone: Open in NiblGo opens the post in the app', html.includes(`href="niblgo://post/${ID}"`) && html.includes('class="device-ios"'));
check('on an iPhone: Get NiblGo is the one download link', html.includes('href="/get">New here? Get NiblGo'));
check('the sharer\'s handle is offered as the invite code', html.includes('@margesbakes</div>') && html.includes('data-copy="@margesbakes"'));
check('nothing ends in a stray period or uses an em dash', !/—/.test(html) && !/Get NiblGo\./.test(html));

// ---- the same post on Android and on a computer
html = await (await get(`/post/${ID}`, ANDROID)).text();
save('full-android', html);
check('on Android: the page says iPhone for now and links the beta sign-up', html.includes('class="device-other"') && html.includes('href="/beta">Get NiblGo') && html.includes('NiblGo is on iPhone for now'));
check('no invite code when the link doesn\'t name a sharer', !html.includes('Your invite code'));
html = await (await get(`/post/${ID}`, DESKTOP)).text();
save('full-desktop', html);
check('on a computer: same as Android (no app to open)', html.includes('class="device-other"'));

// ---- a plain post: no caption, recipe, price or avatar
html = await (await get(`/post/${BARE}`)).text();
save('bare-iphone', html);
check('no avatar photo: their initial instead', html.includes('avatar-letter" aria-hidden="true">M<'));
check('no caption: the preview still describes it', html.includes('og:description" content="A meal shared on NiblGo"'));
check('no recipe, price or tags: none of their boxes', !html.includes('class="recipe"') && !html.includes('class="chips"'));
check('posted minutes ago reads naturally', html.includes('5 minutes ago'));

// ---- hostile post content
html = await (await get(`/post/${HOSTILE}?from=%3Cscript%3E`)).text();
save('hostile', html);
check('script in the caption is shown as text, not run', !html.includes('<script>alert') && html.includes('&lt;script&gt;alert(&quot;blurb&quot;)'));
check('a name that tries to break out of the page is escaped', !html.includes('"><img src=x onerror') && html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'));
check('a non-https photo is never used', !html.includes('javascript:') && html.includes('og:image" content="https://niblgo.com/assets/og.png"'));
check('a non-https avatar falls back to the initial', !html.includes('plain.example'));
check('only real hashtags show, price out of range is dropped', html.includes('>#ok</span>') && !html.includes('bad') && !html.includes('x&quot;y') && !html.includes('class="chip chip-price"'));
check('an odd meal value or date shows nothing', !html.includes('dinner&lt;script') && !html.includes('NaN'));
check('a made-up invite code is ignored', !html.includes('Your invite code'));

// ---- missing, malformed, and Supabase down
res = await get(`/post/${GONE}`);
html = await res.text();
save('missing', html);
check('a deleted post: 404 with a friendly page', res.status === 404 && html.includes('This post isn’t available') && html.includes('href="/get"'));
const before = calls;
res = await get('/post/not-a-real-id');
check('a link that isn\'t a post id: 404 without asking the database', res.status === 404 && calls === before);
res = await get(`/post/${DOWN}`);
html = await res.text();
check('database unreachable: the page still opens the app', res.status === 200 && html.includes(`niblgo://post/${DOWN}`) && html.includes('Open NiblGo to see this post'));
res = await get('/post/%E0%A4%A');
check('a garbled link doesn\'t crash the worker', res.status === 404);

// ---- /get, universal links, and the rest of the site
res = await get('/get');
check('/get sends people to the download link', res.status === 302 && res.headers.get('location') === 'https://testflight.apple.com/join/J94Q9uXw', res.headers.get('location'));
res = await get('/download');
check('/download goes to /get', res.status === 302 && res.headers.get('location') === 'https://niblgo.com/get');
res = await get('/.well-known/apple-app-site-association');
const aasa = await res.json();
check('the universal-links file is JSON', res.headers.get('content-type') === 'application/json');
check('it names the app (Team ID + bundle)', aasa.applinks.details[0].appIDs[0] === '2QQPTNNN28.com.niblgo.app' && aasa.applinks.details[0].appID === '2QQPTNNN28.com.niblgo.app');
check('only shared posts open the app; sign-in links stay in the browser', JSON.stringify(aasa.applinks.details[0].components) === '[{"/":"/post/*","comment":"A shared post opens in the app"}]' && !JSON.stringify(aasa).includes('auth'));
res = await get('/help');
check('old redirects still work (/help)', res.status === 302 && res.headers.get('location') === 'https://niblgo.com/support');
res = await get('/privacy.html');
check('.html addresses still tidy up', res.status === 301 && res.headers.get('location') === 'https://niblgo.com/privacy');
const hits = assetHits;
res = await get('/privacy');
check('ordinary pages are served from the site, with its headers', assetHits === hits + 1 && res.headers.get('x-frame-options') === 'DENY');

// ---- helpers
check('cook times read naturally', cookTime(25) === '25 min' && cookTime(60) === '1 hr' && cookTime(70) === '1 hr 10 min' && cookTime(0) === '' && cookTime('x') === '');
check('invite codes: real handles only', inviteHandle('@Bob_1') === 'Bob_1' && inviteHandle('a') === '' && inviteHandle('<x>') === '' && inviteHandle(null) === '');

console.log(failed ? `\n${failed} share page check(s) failed` : '\nAll share page checks passed');
process.exit(failed ? 1 : 0);
