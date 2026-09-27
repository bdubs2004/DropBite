/**
 * Cloudflare Pages advanced-mode Worker for the NiblGo site.
 *
 * Its whole job is the rich preview behind a shared post link. A request to
 * /post/<id> is answered here with a branded HTML page carrying Open Graph
 * tags (the food photo, the caption, who posted it), so pasting the link into
 * iMessage, Instagram, WhatsApp, etc. unfurls into a proper card instead of a
 * bare URL — and an "Open in NiblGo" button deep-links into the app, the same
 * idea as the email-confirm page's button.
 *
 * Every other path is an ordinary static file, served straight from the
 * uploaded site through the ASSETS binding.
 *
 * This file is generated into website/_worker.js by scripts/build-site.js; edit
 * it here, not there. Cloudflare Pages picks up a _worker.js at the site root
 * automatically (advanced mode) on a Direct Upload — no build command needed.
 *
 * Two Pages environment variables make the per-post photo work
 * (Pages project -> Settings -> Environment variables):
 *   SUPABASE_URL       e.g. https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY  the project's public anon key (safe to expose; it is
 *                      already shipped inside the mobile app)
 * Without them the page still renders — just with the NiblGo logo instead of
 * the real photo.
 */

const MEAL_LABEL = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/post\/([^/]+)\/?$/);
    if (match) {
      return renderPost(decodeURIComponent(match[1]), url, env);
    }
    // Everything else is a normal static asset.
    return env.ASSETS.fetch(request);
  },
};

async function renderPost(id, url, env) {
  let post = null;
  try {
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/get_post_preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: env.SUPABASE_ANON_KEY,
          authorization: 'Bearer ' + env.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ pid: id }),
      });
      if (res.ok) {
        const rows = await res.json();
        post = Array.isArray(rows) ? rows[0] : rows;
      }
    }
  } catch (e) {
    // Fall through to the generic (photo-less) card.
  }
  return new Response(renderHtml(id, post, url.origin), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Cache briefly at the edge so repeated unfurls are fast, but a fresh
      // caption/photo still shows within a few minutes.
      'cache-control': 'public, max-age=300',
    },
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(id, post, origin) {
  const appLink = 'niblgo://post/' + encodeURIComponent(id);
  const pageUrl = origin + '/post/' + encodeURIComponent(id);
  const name =
    post && post.display_name
      ? post.display_name
      : post && post.handle
        ? '@' + post.handle
        : 'A meal';
  const blurb = post && post.blurb ? post.blurb : 'Shared a meal on NiblGo';
  const meal =
    post && post.meal_slot && MEAL_LABEL[post.meal_slot] ? MEAL_LABEL[post.meal_slot] : '';
  const photo = post && post.photo_url ? post.photo_url : origin + '/icon.png';
  const title = name + ' on NiblGo';
  const desc = blurb.length > 160 ? blurb.slice(0, 157) + '…' : blurb;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="/icon.png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="NiblGo">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(photo)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(photo)}">
<style>
:root{--cream:#FFF4DE;--white:#fff;--cocoa:#3D2B1F;--cocoa-soft:#6B5544;
--amber:#F5952B;--amber-dark:#C86A12;--hairline:#EADFC8}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:var(--cream);color:var(--cocoa);padding:24px;
font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.card{background:var(--white);border:1px solid var(--hairline);border-radius:22px;
max-width:420px;width:100%;overflow:hidden;box-shadow:0 12px 34px rgba(61,43,31,.10)}
.photo{width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--cream);display:block}
.body{padding:20px}
.who{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.brand{width:26px;height:26px;border-radius:7px}
.name{font-weight:700}
.pill{display:inline-block;background:var(--cream);color:var(--amber-dark);
font-weight:700;font-size:12px;padding:4px 10px;border-radius:999px;margin-bottom:10px}
.blurb{margin:0 0 18px;color:#4A3728}
.btn{display:block;text-align:center;background:var(--amber);color:#fff;text-decoration:none;
font-weight:700;font-size:16px;padding:14px 20px;border-radius:999px}
.btn:active{opacity:.85}
.muted{color:var(--cocoa-soft);font-size:13px;text-align:center;margin-top:14px}
.muted a{color:var(--amber-dark)}
</style>
</head>
<body>
<main class="card">
  <img class="photo" src="${esc(photo)}" alt="A meal shared on NiblGo">
  <div class="body">
    <div class="who">
      <img class="brand" src="/icon.png" alt="NiblGo">
      <span class="name">${esc(name)}</span>
    </div>
    ${meal ? `<span class="pill">${esc(meal)}</span>` : ''}
    <p class="blurb">${esc(blurb)}</p>
    <a class="btn" href="${esc(appLink)}">Open in NiblGo</a>
    <p class="muted">Don't have the app yet? <a href="/">Get NiblGo</a></p>
  </div>
</main>
</body>
</html>`;
}
