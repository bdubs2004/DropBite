#!/usr/bin/env node
/**
 * Render the legal documents into the static site.
 *
 * The markdown in `legal/` is the source of truth — it is what gets reviewed,
 * and what the claim table in legal/README.md maps back to the code. Hand-
 * writing the HTML separately would guarantee the two drift, and a published
 * privacy policy that no longer matches the app is worse than none at all.
 *
 * Run: npm run build:site
 *
 * Deliberately zero dependencies. The converter below handles exactly the
 * markdown these documents use; it is not a general-purpose one.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'website');

const PAGES = [
  {
    src: 'legal/PRIVACY_POLICY.md',
    out: 'privacy.html',
    title: 'Privacy Policy',
    nav: 'Privacy',
    description:
      'What NiblGo collects, why, who we share it with, and the rights you have over it. No ads, no analytics SDKs, no selling your data.',
  },
  {
    src: 'legal/TERMS_OF_SERVICE.md',
    out: 'terms.html',
    title: 'Terms of Service',
    nav: 'Terms',
    description:
      'The terms you agree to by using NiblGo, including the end user licence agreement for user-generated content.',
  },
];

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline: code, bold, italic, links, bare URLs. Order matters. */
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // [text](url)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
    const clean = href.replace(/^&lt;|&gt;$/g, '');
    // Cross-links between the two rendered pages.
    const mapped = clean
      .replace(/^PRIVACY_POLICY\.md$/, 'privacy.html')
      .replace(/^TERMS_OF_SERVICE\.md$/, 'terms.html');
    return `<a href="${mapped}">${text}</a>`;
  });
  // <https://...>
  t = t.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, '<a href="$1">$1</a>');
  // bare mailto-able addresses
  t = t.replace(/\b([a-z0-9._%+-]+@niblgo\.com)\b/g, '<a href="mailto:$1">$1</a>');
  return t;
}

function convert(md) {
  const lines = md.split('\n');
  const html = [];
  let i = 0;
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      closeList();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      html.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    // table
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] ?? '')) {
      closeList();
      const cells = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      html.push(
        '<table><thead><tr>' +
          head.map((h) => `<th>${inline(h)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows
            .map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
            .join('') +
          '</tbody></table>',
      );
      continue;
    }

    // blockquote (possibly multi-line)
    if (/^>\s?/.test(line)) {
      closeList();
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }

    if (/^(---|\*\*\*)\s*$/.test(line)) {
      closeList();
      html.push('<hr>');
      i++;
      continue;
    }

    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      // continuation lines of the same bullet
      const parts = [li[1]];
      i++;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i])) {
        parts.push(lines[i++].trim());
      }
      html.push(`<li>${inline(parts.join(' '))}</li>`);
      continue;
    }

    if (line.trim() === '') {
      closeList();
      i++;
      continue;
    }

    // paragraph: gather until a blank line or a block starts
    closeList();
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|[-*]\s|\||>|```|---)/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    html.push(`<p>${inline(para.join(' '))}</p>`);
  }
  closeList();
  return html.join('\n');
}

const CSS = `
:root{--cream:#FFF4DE;--cream-dark:#F6E7C8;--white:#fff;--cocoa:#3D2B1F;
--cocoa-soft:#6B5544;--cocoa-faint:#9A8877;--amber:#F5952B;--amber-dark:#C86A12;--hairline:#EADFC8}
*{box-sizing:border-box}
body{margin:0;background:var(--cream);color:var(--cocoa);
font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{padding:20px 24px;border-bottom:1px solid var(--hairline);background:var(--cream);
position:sticky;top:0;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
header img{width:34px;height:34px}
header .name{font-weight:800;font-size:20px;letter-spacing:-.4px}
header nav{margin-left:auto;display:flex;gap:18px}
header nav a{color:var(--cocoa-soft);text-decoration:none;font-weight:600;font-size:15px}
header nav a:hover,header nav a[aria-current]{color:var(--amber-dark)}
main{max-width:760px;margin:0 auto;padding:32px 24px 96px}
h1{font-size:34px;line-height:1.15;letter-spacing:-.5px;margin:.2em 0 .5em}
h2{font-size:24px;margin:2em 0 .5em;letter-spacing:-.3px}
h3{font-size:18px;margin:1.6em 0 .4em}
p,li{color:#4A3728}
a{color:var(--amber-dark)}
strong{color:var(--cocoa)}
hr{border:0;border-top:1px solid var(--hairline);margin:2.5em 0}
code{background:var(--cream-dark);padding:2px 6px;border-radius:5px;font-size:.9em}
pre{background:var(--white);border:1px solid var(--hairline);border-radius:10px;
padding:14px 16px;overflow-x:auto}
pre code{background:none;padding:0}
blockquote{margin:1.5em 0;padding:14px 18px;background:var(--cream-dark);
border-left:4px solid var(--amber);border-radius:0 10px 10px 0}
blockquote p{margin:0}
table{width:100%;border-collapse:collapse;margin:1.5em 0;font-size:15px;display:block;overflow-x:auto}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--hairline);vertical-align:top}
th{background:var(--cream-dark);font-weight:700}
footer{border-top:1px solid var(--hairline);padding:28px 24px;text-align:center;
color:var(--cocoa-faint);font-size:14px}
footer a{color:var(--cocoa-soft)}
@media(max-width:600px){h1{font-size:27px}main{padding:24px 18px 72px}}
`;

function page({ title, nav, body, description }) {
  const link = (href, label) =>
    `<a href="${href}"${label === nav ? ' aria-current="page"' : ''}>${label}</a>`;
  // The home page is already called NiblGo; don't title it "NiblGo — NiblGo".
  const docTitle = title === 'NiblGo' ? 'NiblGo' : `${title} — NiblGo`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${docTitle}</title>
<meta name="description" content="${description ?? `NiblGo ${title}.`}">
<link rel="icon" href="icon.png">
<style>${CSS}</style>
</head>
<body>
<header>
  <img src="icon.png" alt="">
  <span class="name">NiblGo</span>
  <nav>${link('index.html', 'Home')}${link('privacy.html', 'Privacy')}${link('terms.html', 'Terms')}${link('support.html', 'Support')}</nav>
</header>
<main>
${body}
</main>
<footer>
  NiblGo · Sioux Falls, South Dakota ·
  <a href="mailto:support@niblgo.com">support@niblgo.com</a>
</footer>
</body>
</html>
`;
}

/**
 * The two hand-written pages. They go through the same template as the
 * generated ones so there is exactly one stylesheet and one header to maintain.
 *
 * `index.html` is deliberately a holding page. The marketing site replaces it;
 * until then it exists so the nav is not broken and so a visitor who types the
 * domain in finds the support and legal links rather than a 404.
 */
const STATIC_PAGES = [
  {
    out: 'support.html',
    title: 'Support',
    nav: 'Support',
    description:
      'How to get help with NiblGo, report content, block someone, delete your account, or request a copy of your data.',
    body: `
<h1>Support</h1>
<p>Something broken, a question, or an account you need dealt with — write to us
and a person will read it.</p>

<h2>Email us</h2>
<ul>
  <li><strong>General help, bugs, account problems:</strong> <a href="mailto:support@niblgo.com">support@niblgo.com</a></li>
  <li><strong>Privacy requests</strong> — a copy of your data, corrections, or deletion: <a href="mailto:privacy@niblgo.com">privacy@niblgo.com</a></li>
  <li><strong>Reporting content or a user:</strong> <a href="mailto:support@niblgo.com">support@niblgo.com</a>, or use the in-app report — long-press a post, a message, or open a profile</li>
</ul>
<p>We answer within <strong>three business days</strong>. Reports of illegal
content, harassment, or content involving a minor are triaged within
<strong>24 hours</strong>.</p>

<h2>Things you can do yourself, in the app</h2>
<ul>
  <li><strong>Report a post, message, or person</strong> — long-press it, or use the menu on a profile.</li>
  <li><strong>Block someone</strong> — from their profile. They disappear from your feed, search and messages, and cannot start a conversation with you.</li>
  <li><strong>Turn mealtime reminders off</strong> — Settings, from the drawer on your profile. Each meal toggles separately.</li>
  <li><strong>Delete your account</strong> — Settings, then Delete account. It removes your posts, photos, messages and profile. It cannot be undone.</li>
  <li><strong>Send feedback or report a problem</strong> — the Help section at the bottom of the profile drawer.</li>
</ul>

<h2>Getting a copy of your data</h2>
<p>There is no download button in the app — by design. Ask us at
<a href="mailto:privacy@niblgo.com">privacy@niblgo.com</a> from the email address on your account and we will put your
data together and send it to you, free, within 30 days (45 if it is complicated,
and we will tell you if so). The <a href="privacy.html">Privacy Policy</a>,
section 7, sets out every right you have and how to use it.</p>

<h2>Before you write in</h2>
<p>It helps to include your handle, your phone and OS version, and what you were
doing when it went wrong. A screenshot is worth several paragraphs.</p>
`,
  },
  {
    out: 'index.html',
    title: 'NiblGo',
    nav: 'Home',
    description:
      'NiblGo is a photo-first way to share what you eat with the people you actually know. No algorithm, no ads, no strangers.',
    body: `
<h1>NiblGo</h1>
<p>A photo-first way to share what you eat with the people you actually know.
Snap the meal, say a few words about it, and it lands in your friends' feed —
no algorithm, no ads, no strangers.</p>
<p>NiblGo is in development. This page will grow into the full thing; for now,
here is what you probably came for:</p>
<ul>
  <li><a href="privacy.html">Privacy Policy</a></li>
  <li><a href="terms.html">Terms of Service</a> — which is also the EULA</li>
  <li><a href="support.html">Support</a></li>
</ul>
<p>Anything else: <a href="mailto:support@niblgo.com">support@niblgo.com</a>.</p>
`,
  },
];

fs.mkdirSync(OUT, { recursive: true });

for (const p of STATIC_PAGES) {
  fs.writeFileSync(path.join(OUT, p.out), page(p));
  console.log(`  (static)              -> website/${p.out}`);
}

// The favicon and header mark. Copied rather than referenced so the site
// directory is self-contained and can be dropped on any static host.
fs.copyFileSync(path.join(ROOT, 'assets/icon.png'), path.join(OUT, 'icon.png'));
console.log('  assets/icon.png       -> website/icon.png');

for (const p of PAGES) {
  const md = fs.readFileSync(path.join(ROOT, p.src), 'utf8');
  // The "fill these in before publishing" note is for the repo, not the public
  // page. If placeholders survive, the check below refuses to build.
  const cleaned = md.replace(/^> \*\*Two items still need[\s\S]*?\n\n/m, '');
  const body = convert(cleaned);
  fs.writeFileSync(path.join(OUT, p.out), page({ ...p, body }));
  console.log(`  ${p.src} -> website/${p.out}`);
}

// Refuse to ship a page with an unfilled placeholder in it. Publishing
// "[LEGAL ENTITY NAME]" to a page Apple loads is worse than not publishing.
const problems = [];
for (const p of PAGES) {
  const html = fs.readFileSync(path.join(OUT, p.out), 'utf8');
  const found = html.match(/\[[A-Z][A-Z_ ]+\]/g);
  if (found) problems.push(`${p.out}: ${[...new Set(found)].join(', ')}`);
}
if (problems.length) {
  console.log('');
  console.log('  ⚠ UNFILLED PLACEHOLDERS — do not publish these pages yet:');
  for (const p of problems) console.log(`     ${p}`);
  console.log('     See legal/README.md.');
}
