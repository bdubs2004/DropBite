# Testing NiblGo for real, before Apple sees it

Everything in this repo has been tested one of three ways: pure logic in Node,
SQL against a scratch Postgres, or the app driven in a browser. **None of that
is a phone.** This document is how you close that gap, and which parts have
never run on real hardware.

---

## The three ways to run it, and what each proves

| | What it proves | Cost | Speed |
| --- | --- | --- | --- |
| **Expo Go** | Layout, navigation, most flows | Free | Seconds |
| **Development build** | The real native binary — notifications, camera, deep links | Free on Android; needs the $99 account for an iPhone | ~20 min per build |
| **TestFlight** | **The exact binary you will submit** | Needs the $99 account | ~20 min + upload |

**TestFlight is the answer to your question.** The build you test there is
byte-for-byte the build you submit — nothing is recompiled in between. Internal
testing (up to 100 people on your team) needs **no Apple review** and is live
minutes after upload. Only external testing (up to 10,000) needs a short Beta
App Review.

---

## Start on Android — it costs nothing and you can do it today

Apple Developer enrolment takes days. Android needs **no account, no review, no
fee**, and NiblGo is one codebase, so nearly everything you would verify on
iPhone behaves the same:

```bash
npm install -g eas-cli
eas login                       # a free Expo account, not Apple
eas build:configure
eas build --platform android --profile preview
```

That produces an installable `.apk`. Download it on any Android phone, allow
install from unknown sources, and you have the real app with real notifications,
a real camera, and your real backend.

Use this to clear the whole checklist below while Apple processes your
enrolment. Then repeat only the iOS-specific parts on TestFlight.

---

## Before any of it will work

The checklist assumes the backend is finished. From `APP_STORE.md` Part 0:

- [ ] Migrations `0010` and `0011` run; `verify.sql` says PASS
- [ ] `ANTHROPIC_API_KEY` set (underscores), key scoped to a workspace
- [ ] `format-recipe` **and** `delete-account` deployed
- [ ] Email confirmation ON

Without these, half the list below fails for reasons that have nothing to do
with the app.

---

## Never run on real hardware — test these first

These are implemented and reviewed, and several have automated tests behind
them, but **not one has executed on a phone or against your live backend.**
If something is broken, it is most likely here.

| What | Why it is untested | What "working" looks like |
| --- | --- | --- |
| **Mealtime notifications** | Notifications are a no-op on web. The duplicate-buzz fix was tested as pure logic in Node | Set dinner 3 minutes out, lock the phone, wait. **Exactly one** notification. Not two |
| **Notification permission prompt** | Never shown | Appears once, on first launch after sign-in |
| **Camera capture** | The browser has no camera | Compose → Camera → permission prompt → photo attaches |
| **Photo upload** | Never uploaded to your Supabase | Post a photo → it appears in Storage → photos → `<your-user-id>/` |
| **Recipe cards** | The Anthropic call has never succeeded — the first key was unscoped and nothing was deployed | Blurb → format → an editable card. If nothing appears, read the function logs |
| **Nutrition figures** | The USDA API has never been called from this project; the shared demo key was rate-limited during development, so only the demo table has ever produced numbers | Estimate nutrition on a real recipe. The label should say "using USDA FoodData Central", **not** "sample data" |
| **Email confirmation** | Tested against a stub only | Sign up → email arrives → click → sign in → your profile exists |
| **Account deletion** | The function is not deployed | Settings → Delete account → gone from Authentication → Users |
| **Photo cleanup on deletion** | **My fix; only ever simulated in SQL** | After deleting the account, `<user-id>/` in the photos bucket is **empty**. If files remain, tell me |
| **Post-success animation** | Animated WebP renders differently on device | The fork animation plays once after posting |
| **Native share sheet** | Web uses a download instead | Share a post → the iOS/Android sheet appears |
| **Deep links** | Needs a real install | Send `niblgo://post/<id>` to yourself; tapping opens the app on that post |

---

## The full pass

Work top to bottom — each step sets up the next.

### Account
- [ ] Sign up → "check your email" screen names the right address
- [ ] The email arrives; the link works
- [ ] Sign in → your profile exists with the handle you chose
- [ ] Force-quit and reopen → still signed in
- [ ] Sign out, sign back in

### Posting
- [ ] Camera: prompt, capture, crop, attach
- [ ] Library: pick, crop, attach
- [ ] Post with a blurb → appears in the feed with your words intact
- [ ] Blurb → format → editable card; change a quantity → it saves as edited
- [ ] A non-recipe blurb ("just cereal lol") → no card is forced
- [ ] Estimate nutrition → a label appears; set servings to 4 → every number quarters
- [ ] The label names its source, and says "sample data" only in demo mode
- [ ] Turn airplane mode on and post → it fails gracefully, no data loss

### Feed and profile
- [ ] Pull to refresh; scroll — header hides going down, returns coming up
- [ ] Tap the logo → jumps to top
- [ ] Like, comment, repost, save; each count updates
- [ ] Long-press your own post → Share / Delete; someone else's → Share / Report
- [ ] Profile grid, capitalised stats, side drawer opens and drags

### Social
- [ ] Follow someone → their posts appear in your feed
- [ ] Message someone you follow; send a photo in the thread
- [ ] Confirm you **cannot** start a thread with someone you do not follow
- [ ] Long-press a message → Report; long-press a conversation → Delete
- [ ] Block someone → they vanish from your feed, search and DMs
- [ ] Unblock → they come back (they are **not** re-followed; that is correct)

### Notifications — the one that had the bug
- [ ] Set all three mealtimes a few minutes out
- [ ] Lock the phone; wait
- [ ] **Exactly one notification per meal.** Two means the fix did not take
- [ ] Change dinner's time → the old one does not also fire
- [ ] Turn lunch off → nothing at lunch
- [ ] In-app: have a second account like your post → the bell shows 1

### Settings and the Apple checks
- [ ] Every settings section reachable from the drawer, scrolled to correctly
- [ ] Help → Send feedback and Report a problem both file (check the `feedback` table)
- [ ] Terms and Privacy links on sign-up open your hosted pages
- [ ] **Delete account** → really gone, and the photos bucket folder is empty

### The two-device test
Worth doing once with a friend or a second phone, because it is the only way to
see the app as a user sees it:
- [ ] They see your post; you see their like
- [ ] Messages arrive in both directions
- [ ] Blocking is symmetric — neither of you sees the other

---

## What to do when something breaks

- **App crashes:** device logs. `eas build` output tells you where; on Android,
  `adb logcat` filtered to your package.
- **A backend call fails:** Supabase dashboard → Logs, and Edge Functions →
  *function* → Logs. The recipe function logs the real Anthropic error while
  returning an opaque one to the app, deliberately.
- **Recipe cards silently missing:** that is by design — a failure never blocks a
  post. The reason is in the function logs. `GO_LIVE.md` has the table mapping
  each log line to its cause.
- **Notifications not firing:** check the OS gave permission, and that you are
  not on Expo Go (Android limits notifications there).

---

## Before you press submit

- [ ] Every box above ticked on a real device
- [ ] At least one other person has used it for a day via TestFlight
- [ ] Their feedback read from the `feedback` table
- [ ] `npm run typecheck` and `npm run test:reminders` clean
- [ ] `supabase/verify.sql` says PASS
