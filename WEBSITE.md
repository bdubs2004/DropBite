# niblgo.com — the site, and the email addresses

Two things Apple and Google both check before they will look at the app: the
legal pages load at a public URL, and the support email you give them actually
receives mail. This is how to get both done.

---

## Part 1 — What is built

`website/` is a plain static site. No framework, no build step beyond one Node
script, nothing to keep updated.

| Page | URL it will live at | Where it comes from |
| --- | --- | --- |
| Home | `niblgo.com` | Hand-written in `scripts/build-site.js` — a holding page until the marketing site replaces it |
| Privacy Policy | `niblgo.com/privacy` | **Generated** from `legal/PRIVACY_POLICY.md` |
| Terms of Service | `niblgo.com/terms` | **Generated** from `legal/TERMS_OF_SERVICE.md` |
| Support | `niblgo.com/support` | Hand-written in `scripts/build-site.js` |

```bash
npm run build:site
```

The two legal pages are rendered from the markdown in `legal/`, deliberately.
Editing the HTML directly would let the published policy drift away from the
version that was reviewed against the code — and a privacy policy that no longer
describes the app is worse than not having one. **Edit the markdown, re-run the
build.**

`/privacy` and `/terms` work without the `.html`, because those are the URLs you
will paste into App Store Connect and the Play Console, and short URLs age
better than long ones.

### The contracting party is filled in

Both documents name the party you are contracting as, and that has to be a real
name and address. This is now filled in — the live site and `legal/*.md` both
name **Bryce and Cameron**, 4500 E. 33rd St., Sioux Falls, South Dakota 57110,
USA — so the build no longer prints the unfilled-placeholder warning.

This is the personal-names option: a claim against NiblGo is a claim against you
both. Forming a South Dakota LLC (Articles of Organization with the Secretary of
State, about $150 online, processed in a day or two) would move that liability to
the company and let you use a registered agent's address instead of your own. For
a free app with no revenue the personal-names choice is defensible; if you form
the LLC later, update the name and address in `legal/*.md` and re-run the build.

---

## Part 2 — Which email addresses to use

**Use two addresses on your own domain, not your Gmail accounts:**

| Address | For | Where it is already named |
| --- | --- | --- |
| `support@niblgo.com` | Help, bugs, content reports, everything general | Terms, support page, site footer, App Store Connect support URL |
| `privacy@niblgo.com` | Data requests, deletion, corrections, anything GDPR/CCPA | Privacy policy, and **Google Play's data-deletion field**, which requires a route that works outside the app |

Both should deliver to **both of you**. Three reasons this is the right shape,
and not over-engineering:

1. **The clock does not care who is on holiday.** GDPR gives you 30 days to
   answer an access request and Apple expects content reports triaged within 24
   hours. If either address lands in one person's inbox and that person is
   busy, you have missed a legal deadline and neither of you knows.
2. **You can hand the app over without changing the documents.** A personal
   Gmail address in a published privacy policy is permanent — changing it later
   means republishing the policy and re-submitting to both stores.
3. **`privacy@` separate from `support@` is worth it.** Privacy requests have a
   legal deadline and a paper trail; "the app crashed" does not. Mixing them
   means the one that matters gets lost in the one that does not.

Do **not** publish `bk.axionsystems@gmail.com` or `camjax2004@gmail.com` in the
store listings or the policy. They are fine as the destination the role
addresses forward to — that is exactly the point.

---

## Part 3 — Setting the email up

Pick one. All three work; they differ in whether you can *send* as
`@niblgo.com`, which matters more than it sounds like it does.

### Option A — Cloudflare Email Routing (free, receive only)

Fastest and costs nothing. Mail to `@niblgo.com` forwards into your Gmail.

1. Add `niblgo.com` to Cloudflare (free plan) and point the domain's
   nameservers at Cloudflare at your registrar.
2. Cloudflare dashboard → your domain → **Email** → **Email Routing** →
   **Get started**. It adds the MX and SPF records itself.
3. Create two custom addresses:
   - `support@niblgo.com` → forward to both Gmail accounts
   - `privacy@niblgo.com` → forward to both Gmail accounts
4. Click the confirmation link Cloudflare sends to each destination address.
   **Forwarding does not start until you do**, and this is the step people
   forget and then think the domain is broken.

**The catch:** you can receive but not send. Replying comes from your Gmail
address, so a user who wrote to `privacy@niblgo.com` gets an answer from a
personal Gmail account. That looks unprofessional and, for a formal GDPR
response, slightly undermines it.

You can partly fix this in Gmail: Settings → Accounts → **Send mail as** → add
`support@niblgo.com`. Gmail requires an SMTP server to send through, which
Cloudflare does not provide — so this only works combined with option B or C, or
a free SMTP relay. If you want proper send-as, skip to B.

### Option B — Zoho Mail free tier (free, send and receive) — recommended

Real mailboxes, on your domain, at no cost. The limit is five users and no
IMAP/POP on the free plan, which for two people using the webmail or the Zoho
app is not a limit you will feel.

1. Sign up at zoho.com/mail, choose the **Forever Free** plan, and enter
   `niblgo.com` as your domain.
2. Verify ownership — Zoho gives you a TXT record to add at your registrar.
3. Add the MX records Zoho gives you (and the SPF and DKIM records; do not skip
   DKIM, it is what stops your replies going to spam).
4. Create `support@niblgo.com` as a user, and `privacy@niblgo.com` as a second
   user or as a **group** with both of you as members. A group is better: both
   of you see the mail, and either can reply as the group.
5. Optional: in Zoho, forward a copy to your Gmail so you get the push
   notification, but **reply from Zoho** so the reply comes from the domain.

### Option C — Google Workspace (~$7 per user per month)

If you want it to be Gmail, in the Gmail app, with the Gmail search — this is
that. Same setup shape as Zoho: verify the domain, add MX records, create
`support@` as a user and `privacy@` as a **group** so it reaches both of you
(groups do not cost a seat). Two seats is about $14/month.

Worth it once you are answering mail daily. Not worth it before launch.

### Whichever you pick, test it before you submit

From a phone, not the account you set up:

- [ ] Send to `support@niblgo.com` — it arrives, for both of you
- [ ] Send to `privacy@niblgo.com` — it arrives, for both of you
- [ ] Reply to one — check what address the reply comes *from*
- [ ] Check the spam folder. If your reply landed there, DKIM is not set up

Apple has rejected apps for a support email that bounces. It is a two-minute
test and it is the last thing anyone thinks to do.

---

## Part 4 — Deploying the site

### Netlify, free tier

1. Push this branch. At app.netlify.com, **Add new site → Import an existing
   project**, and pick the repo.
2. Netlify reads `netlify.toml` — build command `node scripts/build-site.js`,
   publish directory `website`. Do not override them in the UI.
3. Deploy. You get a URL like `niblgo-xyz.netlify.app`. **The legal pages work
   at that URL immediately** — if you are in a hurry to submit, you can use it
   and switch to the domain later. Apple only checks that the URL loads.
4. **Domain management → Add a domain → `niblgo.com`.** Netlify tells you which
   records to set at your registrar (either point the nameservers at Netlify, or
   add an `A` record to Netlify's load balancer plus a `CNAME` for `www`).
5. HTTPS is issued automatically once DNS resolves. Wait for the certificate
   before pasting the URL anywhere — an https URL that fails its certificate
   check reads as broken.

Every push to the branch redeploys. Changing a legal document means editing the
markdown and pushing; the site follows.

### What `netlify.toml` already handles

- **`apple-app-site-association` served as `application/json`.** When you set up
  universal links (`https://niblgo.com/post/<id>` opening the app instead of
  Safari), Apple fetches that file and *requires* that content type. Netlify
  guesses from the file extension, and that file deliberately has none — so it
  would go out as `text/plain` and Apple would ignore it silently. No error, no
  warning, links just do not work. This is the single most common way universal
  links quietly fail, and the header is already in place for when you get there.
- The Android equivalent, `assetlinks.json`.
- `nosniff`, `DENY` framing, HSTS, and a sane referrer policy.
- `/privacy`, `/terms` and `/support` without the `.html`.

### Other hosts

Cloudflare Pages, Vercel and GitHub Pages all serve this fine — it is static
HTML. Only Netlify's config is written; on another host you would need to
re-create the header rules yourself, and on GitHub Pages you cannot set headers
at all, which rules it out once you want universal links.

---

## Part 5 — Then paste these in

Once the domain resolves and the mailboxes work:

| Where | What |
| --- | --- |
| App Store Connect → App Privacy | `https://niblgo.com/privacy` |
| App Store Connect → App Information → Support URL | `https://niblgo.com/support` |
| App Store Connect → licence agreement | `https://niblgo.com/terms` (or paste the text) |
| Play Console → Store listing → Privacy Policy | `https://niblgo.com/privacy` |
| Play Console → Data safety → data deletion | `privacy@niblgo.com` |
| Play Console → Store listing → contact email | `support@niblgo.com` |

The app itself already links `PRIVACY_URL` and `TERMS_URL` from `src/config.ts`,
which resolve to `https://niblgo.com/privacy` and `/terms`. Nothing to change
there.

---

## Still to build

The marketing pages — what NiblGo is, screenshots, and the App Store badges once
you have a listing. `index.html` is a holding page until then.
