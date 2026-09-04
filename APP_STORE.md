# Getting NiblGo onto the App Store

Everything between here and a live listing. Nothing in Part 1 is optional;
Apple rejects on any of it.

The honest shape of this: the **code** is done. What's left is one backend
afternoon, then account setup, artwork, two web pages you have to host, and
Apple's review queue. Budget a week if you start now, most of it waiting.

---

## Part 0: finish the backend (you, ~30 min)

None of this is code — it's the wiring the app already expects.

- [ ] `git pull`
- [ ] SQL Editor → run `supabase/migrations/0010_function_grants.sql` — **security fix, not optional**
- [ ] SQL Editor → run `supabase/migrations/0011_feedback.sql`
- [ ] SQL Editor → run `supabase/verify.sql` — first row must say PASS
- [ ] Edge Function secret named **`ANTHROPIC_API_KEY`** (underscores, not hyphens)
- [ ] Deploy `format-recipe` **and** `delete-account`
- [ ] Leave **email confirmation ON** (Authentication → Providers → Email). The app handles it now, and with it off anyone can sign up as anyone's address.

Then test on a real device, in this order, because each step gates the next:

1. Sign up → you get "check your email" → click the link → sign in → your profile exists
2. Post a photo → it appears in Supabase Storage
3. Write a cooking blurb → tap format → an editable recipe card appears
4. Settings → Your data → **Download my data** → a JSON file arrives
5. Settings → **Delete account** → the account is really gone (check Authentication → Users)

Steps 4 and 5 are the two Apple checks most likely to bounce you.

---

## Part 1: what Apple requires

### Account and tooling

- [ ] **Apple Developer Program** — $99/year, [developer.apple.com/programs](https://developer.apple.com/programs/). Enrolment can take 24–48 h, sometimes longer if they verify your identity. **Start this first**, it's the longest pole.
- [ ] Decide: enrol as an **individual** (your name shows as the seller) or an **organisation** (needs a D-U-N-S number, which itself takes days). If NiblGo is a company, start the D-U-N-S now.
- [ ] `npm install -g eas-cli`, then `eas login` and `eas build:configure`

### The build

- [ ] `eas build --platform ios --profile production`
- [ ] `eas submit --platform ios` (or upload the `.ipa` via Transporter)
- [ ] Bump `version` in `app.json` for every submission; EAS handles the build number

Note: `expo` and `expo-constants` are slightly behind the versions Expo expects
for this SDK — run `npx expo install --check` and take its advice before the
production build, so you're not debugging a version skew at submission time.

### Two web pages you must host

Apple will not accept placeholder URLs, and it checks that they load.

- [ ] **Privacy policy** — a real page on a real domain. It must state what you collect (email, handle, photos, posts, usage), that photos go to Supabase, that blurbs are sent to Anthropic for recipe formatting, how deletion works, and how to contact you.
- [ ] **Support URL** — can be simple, but it must exist and offer a way to reach you.

Both are ~an hour with a free host if you don't have a site.

### App Store Connect listing

- [ ] App name, subtitle, description, keywords
- [ ] **Screenshots** — 6.7" iPhone required (1290×2796). Simulator screenshots are fine.
- [ ] Category — Food & Drink, secondary Social Networking
- [ ] Age rating questionnaire — answer honestly about user-generated content
- [ ] Export compliance — you use standard HTTPS only, so "no non-exempt encryption"

### Privacy nutrition labels

Declare, at minimum: **email address** (account), **photos** (user content),
**user content** (posts, blurbs, messages), and **identifiers** (user ID).
Say they're linked to the user. Getting this wrong is a common rejection, and
it's checked against what the app actually does.

### Guideline 1.2 — user-generated content

This is the one that fails social apps. Apple wants **all** of:

| Requirement | Status |
| --- | --- |
| A way to filter objectionable content | ✅ report → moderation queue |
| A way to report content | ✅ posts, comments, DMs |
| A way to block abusive users | ✅ Settings → Blocked accounts |
| A published EULA | ⬜ **you must add this** — Apple's standard EULA is fine, link it in the listing |
| A commitment to act on reports within 24 h | ⬜ **you must state this** in the listing, and mean it |

That last one is a real operational promise. `MODERATION.md` has the queries
for working the queue — you need to actually check it daily.

### Account deletion

Required since 2022 for any app with accounts, and it must be reachable **in
the app**, not only by emailing you. Settings → Delete account does this — but
only once `delete-account` is deployed. Test it for real before submitting.

---

## Part 2: worth doing, not required

- [ ] **TestFlight** with a handful of real people first. Catches what you can't see in your own testing, and the feedback screen now collects it.
- [ ] Watch the `feedback` table for the first week (see MODERATION.md)
- [ ] Consider deep links (`GO_LIVE.md` §4) so shared posts open the app rather than a browser
- [ ] Set `ALLOWED_ORIGINS` and `AI_DAILY_LIMIT` on the edge function
- [ ] A crash reporter — Sentry has a free tier and an Expo plugin

---

## What typically goes wrong

**Rejections**, most common first:

1. Privacy labels don't match observed behaviour
2. Guideline 1.2 — missing EULA or the 24-hour commitment
3. Account deletion missing or hard to find
4. A support/privacy URL that 404s
5. "Spam" — thin apps. NiblGo is a real app; describe it as one.

**Review time** is usually 24–48 h. A rejection means you fix and resubmit;
it's a conversation, not a verdict, and most first submissions get one.

**Order matters.** Apple Developer enrolment and the D-U-N-S number (if you
need one) are the long poles — everything else can happen while you wait.

---

## The very short version

```
1. Start Apple Developer enrolment              ← today, it gates everything
2. Run 0010, 0011, verify.sql; deploy both functions
3. Test the five flows on a real device
4. Write the privacy policy + support page
5. eas build --platform ios --profile production
6. Fill in App Store Connect (screenshots, labels, EULA, 24 h commitment)
7. TestFlight with a few people
8. Submit
```
