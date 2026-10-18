/**
 * niblgo.com edge worker (Cloudflare Pages, advanced mode).
 *
 * Jobs:
 *   1. /post/<id>  the page behind a shared post link. Link previews
 *      (iMessage, WhatsApp, Slack) unfurl it into a card with the food photo,
 *      and a person who opens it sees the post with a way into the app: open
 *      it if they have NiblGo, get NiblGo if they don't.
 *   2. /get        the one download link everything points at (invites, this
 *      page). TestFlight today; the App Store on launch day, by changing
 *      DOWNLOAD_URL below and nothing else.
 *   3. /.well-known/apple-app-site-association  tells iOS that niblgo.com/post
 *      links belong to the app, so they open NiblGo straight away when it's
 *      installed. Only /post: /auth pages must stay in the browser.
 *   4. everything else is the normal static site, served from env.ASSETS.
 *
 * Note on the redirect and header blocks below. A _worker.js at the root puts
 * Pages into advanced mode, and in that mode the _redirects and _headers files
 * are not reliably applied. Both files are still in the build for the case where
 * they are, but every rule in them is reimplemented here so the site behaves the
 * same either way.
 *
 * This file is generated into website/_worker.js by scripts/build-site.js; edit
 * it here, not there. The Supabase URL and public (publishable) key are baked in
 * at build time; the key is public-safe, it already ships inside the app.
 */

// Filled in by build-site.js. Left blank in source on purpose.
const BUILD_SUPABASE_URL = '';
const BUILD_SUPABASE_ANON_KEY = '';

// Where "Get NiblGo" goes on an iPhone. Change this one line on App Store day.
const DOWNLOAD_URL = 'https://testflight.apple.com/join/J94Q9uXw';
// TestFlight is iPhone only, so everyone else gets the beta sign-up page.
const BETA_PATH = '/beta';

// Apple Team ID + bundle id, for universal links.
const IOS_APP_ID = '2QQPTNNN28.com.niblgo.app';

const MEAL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

const REDIRECTS = {
  '/auth': ['/auth/confirm', 302],
  '/beta-tester': ['/beta', 302],
  '/betatester': ['/beta', 302],
  '/thanks': ['/beta-thanks', 302],
  '/legal': ['/privacy', 302],
  '/help': ['/support', 302],
  '/contact': ['/support', 302],
  '/download': ['/get', 302],
  '/app': ['/get', 302],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/.well-known/apple-app-site-association' || p === '/apple-app-site-association') {
      return appSiteAssociation();
    }
    if (p === '/get') return Response.redirect(DOWNLOAD_URL, 302);

    const shared = p.match(/^\/post\/([^/]+)\/?$/);
    if (shared) return sharePage(safeDecode(shared[1]), url, request, env);

    const named = REDIRECTS[p];
    if (named) return Response.redirect(url.origin + named[0] + url.search, named[1]);

    if (p !== '/' && p.endsWith('/')) {
      return Response.redirect(url.origin + p.slice(0, -1) + url.search, 301);
    }
    if (p.endsWith('.html')) {
      const clean = p === '/index.html' ? '/' : p.slice(0, -5);
      return Response.redirect(url.origin + clean + url.search, 301);
    }

    return decorate(await env.ASSETS.fetch(request), p);
  },
};

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return '';
  }
}

/* ---------- universal links ------------------------------------------------ */

function appSiteAssociation() {
  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [{ '/': '/post/*', comment: 'A shared post opens in the app' }],
          // The older keys, for iOS 12 and earlier.
          appID: IOS_APP_ID,
          paths: ['/post/*'],
        },
      ],
    },
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}

/* ---------- static asset headers ------------------------------------------ */

function decorate(res, pathname) {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), interest-cohort=()');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (pathname.startsWith('/auth/')) {
    /* A verification link carries a one-time token. Never cache it, and never
       hand it to another site in a referrer header. */
    h.set('Cache-Control', 'no-store');
    h.set('Referrer-Policy', 'no-referrer');
  } else {
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (/\.(css|js)$/.test(pathname) || pathname.startsWith('/assets/')) {
      /* These filenames carry a content hash, so they can never go stale. */
      h.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      h.set('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
  return out;
}

/* ---------- shared post page ----------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sharePage(id, url, request, env) {
  const supabaseUrl = BUILD_SUPABASE_URL || (env && env.SUPABASE_URL) || '';
  const anonKey = BUILD_SUPABASE_ANON_KEY || (env && env.SUPABASE_ANON_KEY) || '';
  // 'found', 'missing' (no such post: deleted, or a mistyped link) or
  // 'unknown' (couldn't ask; the page still offers the app).
  let state = 'unknown';
  let post = null;
  if (!UUID.test(id)) {
    state = 'missing';
  } else if (supabaseUrl && anonKey) {
    try {
      const res = await fetch(supabaseUrl + '/rest/v1/rpc/get_post_preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: anonKey,
          authorization: 'Bearer ' + anonKey,
        },
        body: JSON.stringify({ pid: id }),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const rows = await res.json();
        post = Array.isArray(rows) ? rows[0] || null : rows;
        state = post ? 'found' : 'missing';
      }
    } catch (e) {
      /* No preview data is fine: the page still opens the app. */
    }
  }
  const html = shareHtml({
    id,
    post,
    state,
    origin: url.origin,
    from: inviteHandle(url.searchParams.get('from')),
    device: deviceOf(request.headers.get('user-agent') || ''),
    now: Date.now(),
  });
  return new Response(html, {
    status: state === 'missing' ? 404 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      // The page differs for iPhone and everyone else.
      vary: 'User-Agent',
      'x-robots-tag': 'noindex',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}

/** 'ios' or 'other'. iPads that call themselves Macs are fixed up in the page. */
function deviceOf(ua) {
  return /iPhone|iPad|iPod/i.test(ua) ? 'ios' : 'other';
}

/** The sharer's handle from ?from=, only if it could be a real handle. */
function inviteHandle(raw) {
  if (typeof raw !== 'string') return '';
  const h = raw.trim().replace(/^@+/, '');
  return /^[A-Za-z0-9_]{2,30}$/.test(h) ? h : '';
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* Only ever hand an https image to the page. A photo or avatar URL is user data. */
function safeImage(raw) {
  if (typeof raw !== 'string') return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : '';
  } catch (e) {
    return '';
  }
}

function ago(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
  const date = new Date(t);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear();
  return months[date.getUTCMonth()] + ' ' + date.getUTCDate() + (sameYear ? '' : ', ' + date.getUTCFullYear());
}

function cookTime(min) {
  const n = Number(min);
  if (!Number.isInteger(n) || n <= 0) return '';
  if (n < 60) return n + ' min';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h + ' hr' + (m ? ' ' + m + ' min' : '');
}

function possessive(name) {
  return /s$/i.test(name) ? name + '’' : name + '’s';
}

/** Everything the page shows, worked out once from the preview row. */
function cardData(post) {
  const handle = post && typeof post.handle === 'string' ? post.handle : '';
  const name = (post && post.display_name) || (handle ? '@' + handle : 'Someone');
  const meal = post && MEAL[post.meal_slot] ? MEAL[post.meal_slot] : '';
  const price = post && [1, 2, 3].includes(Number(post.price_level)) ? '$'.repeat(Number(post.price_level)) : '';
  const tags = post && Array.isArray(post.hashtags)
    ? post.hashtags.filter((t) => typeof t === 'string' && /^[a-z0-9]{2,30}$/.test(t)).slice(0, 5)
    : [];
  const recipe = post && typeof post.recipe_title === 'string' && post.recipe_title.trim()
    ? { title: post.recipe_title.trim(), time: cookTime(post.cook_time_minutes) }
    : null;
  return {
    handle,
    name,
    meal,
    price,
    tags,
    recipe,
    blurb: post && typeof post.blurb === 'string' ? post.blurb.trim() : '',
    photo: safeImage(post && post.photo_url),
    avatar: safeImage(post && post.avatar_url),
    initial: (name.replace(/^@/, '').trim()[0] || 'N').toUpperCase(),
  };
}

function shareHtml({ id, post, state, origin, from, device, now }) {
  const appLink = 'niblgo://post/' + encodeURIComponent(id);
  const pageUrl = origin + '/post/' + encodeURIComponent(id);
  const c = cardData(post);
  const when = post ? ago(post.created_at, now) : '';
  const missing = state === 'missing';

  const subject = c.meal ? possessive(c.name) + ' ' + c.meal.toLowerCase() : c.name;
  const title = missing ? 'NiblGo' : post ? subject + ' on NiblGo' : 'A meal on NiblGo';
  const descSrc = missing
    ? 'Share what you eat with the people you actually know'
    : c.blurb || (c.recipe ? 'Recipe: ' + c.recipe.title : 'A meal shared on NiblGo');
  const desc = descSrc.length > 160 ? descSrc.slice(0, 157).trimEnd() + '…' : descSrc;
  const ogImage = c.photo || origin + '/assets/og.png';
  const ogAlt = post ? subject + ', shared on NiblGo' : 'NiblGo';

  const getHref = device === 'ios' ? '/get' : BETA_PATH;
  const sub = [c.handle ? '@' + c.handle : '', c.meal, when].filter(Boolean).join(' · ');

  const avatar = c.avatar
    ? `<img class="avatar" src="${esc(c.avatar)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="avatar avatar-letter" aria-hidden="true">${esc(c.initial)}</span>`;

  const chips = [
    c.price ? `<span class="chip chip-price" title="What it cost to make">${esc(c.price)}</span>` : '',
    ...c.tags.map((t) => `<span class="chip">#${esc(t)}</span>`),
  ].join('');

  const recipe = c.recipe
    ? `<div class="recipe">
        <span class="recipe-icon" aria-hidden="true">${ICON_BOOK}</span>
        <div class="recipe-text">
          <div class="recipe-title">${esc(c.recipe.title)}</div>
          <div class="recipe-sub">${c.recipe.time ? esc(c.recipe.time) + ' · ' : ''}Full recipe in the app</div>
        </div>
      </div>`
    : '';

  const invite = from
    ? `<div class="invite">
        <div>
          <div class="invite-label">Your invite code</div>
          <div class="invite-code">@${esc(from)}</div>
        </div>
        <button class="invite-copy" type="button" data-copy="@${esc(from)}">Copy</button>
      </div>
      <p class="fine">Enter it when you sign up so @${esc(from)} gets credit for inviting you</p>`
    : '';

  const ctaIos = `
    <div class="cta only-ios">
      <a class="btn btn-primary" href="${esc(missing ? 'niblgo://' : appLink)}">${missing ? 'Open NiblGo' : 'Open in NiblGo'}</a>
      <a class="btn btn-secondary" href="/get">New here? Get NiblGo</a>
      ${invite}
    </div>`;
  const ctaOther = `
    <div class="cta only-other">
      <a class="btn btn-primary" href="${esc(BETA_PATH)}">Get NiblGo</a>
      <p class="fine">NiblGo is on iPhone for now. Open this link on your iPhone to see it in the app</p>
      ${invite}
    </div>`;

  const card = missing
    ? `<main class="card card-empty">
        <div class="empty-mark">${ICON_PLATE}</div>
        <h1 class="empty-title">This post isn’t available</h1>
        <p class="empty-text">It may have been deleted, or the link isn’t quite right</p>
        ${ctaIos}${ctaOther}
      </main>`
    : `<main class="card">
        <header class="who">
          ${avatar}
          <div class="who-text">
            <div class="name">${esc(c.name)}</div>
            ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
          </div>
        </header>
        ${c.photo ? `<img class="photo" src="${esc(c.photo)}" alt="${esc(ogAlt)}" referrerpolicy="no-referrer">` : `<div class="photo photo-none">${ICON_PLATE}</div>`}
        <div class="body">
          ${c.blurb ? `<p class="blurb">${esc(c.blurb)}</p>` : ''}
          ${chips ? `<div class="chips">${chips}</div>` : ''}
          ${recipe}
          ${post ? '' : '<p class="blurb muted">Open NiblGo to see this post</p>'}
          ${ctaIos}${ctaOther}
        </div>
      </main>`;

  return `<!doctype html>
<html lang="en" class="device-${device === 'ios' ? 'ios' : 'other'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#FFF8EC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#140E08" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="NiblGo">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:alt" content="${esc(ogAlt)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav class="bar">
  <a class="brand" href="/"><img src="/assets/favicon.png" alt="" width="28" height="28"><span>NiblGo</span></a>
  <a class="bar-get" href="${esc(getHref)}">Get the app</a>
</nav>
<div class="wrap">
${card}
<footer class="foot">Share what you eat with the people you actually know · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer>
</div>
<script>
(function () {
  // iPads in desktop mode say they're Macs; a touch screen gives them away.
  var d = document.documentElement;
  if (d.className.indexOf('device-other') !== -1 && /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) {
    d.className = d.className.replace('device-other', 'device-ios');
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (b) {
    b.addEventListener('click', function () {
      var text = b.getAttribute('data-copy');
      var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });
})();
</script>
</body>
</html>`;
}

const ICON_BOOK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
const ICON_PLATE = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/></svg>';

const CSS = `
:root{
  --bg:#FFF8EC; --surface:#FFFFFF; --text:#3D2409; --text-2:#7A5A38; --text-3:#A98F73;
  --brand:#E8862E; --brand-2:#F5A623; --brand-dark:#C96D1B; --brand-ink:#fff;
  --soft:#FFF1DC; --line:rgba(74,46,18,.12); --line-2:rgba(74,46,18,.06);
  --shadow:0 18px 46px -18px rgba(74,46,18,.34);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#140E08; --surface:#22170D; --text:#FCEFDB; --text-2:#CDB596; --text-3:#987F63;
    --brand:#F59A3E; --brand-2:#FFB65C; --brand-dark:#FFB65C; --brand-ink:#20140A;
    --soft:#2E2013; --line:rgba(252,239,219,.14); --line-2:rgba(252,239,219,.07);
    --shadow:0 22px 54px -20px rgba(0,0,0,.75);
    color-scheme:dark;
  }
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;min-height:100vh;background:var(--bg);color:var(--text);
  font:16px/1.5 Nunito,ui-rounded,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  font-weight:600;-webkit-font-smoothing:antialiased;
}
a{color:inherit}
.bar{
  position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;
  padding:12px 16px;padding-top:max(12px,env(safe-area-inset-top));
  background:color-mix(in srgb,var(--bg) 88%,transparent);
  -webkit-backdrop-filter:saturate(1.4) blur(14px);backdrop-filter:saturate(1.4) blur(14px);
  border-bottom:1px solid var(--line-2);
}
.brand{display:flex;align-items:center;gap:8px;text-decoration:none}
.brand img{border-radius:8px}
.brand span{font-family:"Baloo 2",Nunito,system-ui,sans-serif;font-weight:800;font-size:22px;letter-spacing:-.01em;line-height:1}
.bar-get{
  text-decoration:none;font-weight:800;font-size:14px;color:var(--brand-ink);
  background:var(--brand);padding:8px 14px;border-radius:999px;
}
.wrap{max-width:468px;margin:0 auto;padding:18px 16px 40px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:24px;overflow:hidden;box-shadow:var(--shadow)}
.who{display:flex;align-items:center;gap:12px;padding:14px 16px}
.avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;flex:0 0 auto;background:var(--soft)}
.avatar-letter{display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;
  color:var(--brand-ink);background:linear-gradient(140deg,var(--brand-2),var(--brand))}
.who-text{min-width:0}
.name{font-weight:800;font-size:16.5px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub{font-size:13.5px;color:var(--text-3);font-weight:700;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.photo{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--line-2)}
.photo-none{display:flex;align-items:center;justify-content:center;color:var(--text-3)}
.body{padding:16px 18px 20px}
.blurb{margin:0;font-size:16.5px;line-height:1.5;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
.blurb.muted{color:var(--text-2)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.chip{font-size:13px;font-weight:800;color:var(--brand-dark);background:var(--soft);
  border:1px solid var(--line-2);padding:4px 10px;border-radius:999px}
.chip-price{color:var(--text-2);letter-spacing:.06em}
.recipe{display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px 14px;
  border-radius:16px;background:var(--soft);border:1px solid var(--line-2)}
.recipe-icon{display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:12px;
  background:var(--surface);color:var(--brand-dark);flex:0 0 auto}
.recipe-text{min-width:0}
.recipe-title{font-weight:800;font-size:15.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.recipe-sub{font-size:13px;color:var(--text-3);font-weight:700}
.cta{margin-top:18px}
.device-ios .only-other,.device-other .only-ios{display:none}
.btn{display:block;text-align:center;text-decoration:none;font-weight:800;font-size:16.5px;
  padding:15px 20px;border-radius:999px}
.btn+.btn{margin-top:10px}
.btn-primary{background:linear-gradient(140deg,var(--brand-2),var(--brand));color:var(--brand-ink);
  box-shadow:0 10px 24px -12px rgba(232,134,46,.95)}
.btn-secondary{background:transparent;color:var(--text);border:1.5px solid var(--line)}
.btn:active{transform:translateY(1px)}
.invite{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;
  padding:12px 14px;border-radius:16px;border:1.5px dashed color-mix(in srgb,var(--brand) 55%,transparent)}
.invite-label{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
.invite-code{font-weight:800;font-size:17px;overflow-wrap:anywhere}
.invite-copy{font:inherit;font-weight:800;font-size:14px;color:var(--brand-ink);background:var(--brand);
  border:0;border-radius:999px;padding:8px 14px;cursor:pointer;flex:0 0 auto}
.fine{margin:10px 2px 0;font-size:13.5px;color:var(--text-3);font-weight:700;text-align:center}
.card-empty{padding:34px 22px 24px;text-align:center}
.empty-mark{color:var(--text-3);display:flex;justify-content:center}
.empty-title{font-family:"Baloo 2",Nunito,system-ui,sans-serif;font-weight:800;font-size:24px;line-height:1.2;margin:10px 0 4px}
.empty-text{margin:0;color:var(--text-2)}
.card-empty .cta{text-align:left}
.foot{margin:22px 4px 0;text-align:center;font-size:13px;color:var(--text-3);font-weight:700}
.foot a{color:var(--text-2)}
`;

// For the tests (scripts/__tests__): the page builder on its own.
export { shareHtml, inviteHandle, ago, cookTime };
