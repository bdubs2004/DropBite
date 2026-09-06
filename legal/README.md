# Legal documents

- **[PRIVACY_POLICY.md](PRIVACY_POLICY.md)** — required by Apple, Google, GDPR and CCPA
- **[TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md)** — also serves as the EULA Apple requires for user-generated content

## Read this first

**These are drafts, not legal advice.** They were written against what the code
actually does — which is more than a template can claim — but nobody has
reviewed them for the law that applies to you, and where and how you operate
changes what they should say. **Have a lawyer read them before you publish.**
An hour of a solicitor's time on documents that are already 90% specific to your
app is a very different bill from having them drafted from scratch.

Publishing a policy does not by itself protect you. What protects you is the
policy being **true** — a privacy policy that describes something you don't do,
or omits something you do, is worse than none at all, because it is now evidence.
If you change what the app collects, change these.

## Fill in every bracket

Neither document is publishable until every `[BRACKETED]` item is replaced.

| Placeholder | What goes there |
| --- | --- |
| `[LEGAL ENTITY NAME]` | The person or company operating NiblGo. If you have not formed a company, this is you, personally — and so is the liability |
| `[Registered address]` | A real postal address. Required by GDPR; a PO box is usually acceptable |
| `[PRIVACY EMAIL]` | Where access and deletion requests go. Must be monitored — the clock runs whether or not you read it |
| `[SUPPORT EMAIL]` | General support. Can be the same address |
| `[DATE]` | Publication date, in both files |
| `[YOUR SUPABASE REGION]` | From your Supabase dashboard, e.g. "US East" |
| `[JURISDICTION]` | Where you are based, e.g. "the State of Ohio, USA" |
| `[AMOUNT, e.g. USD 100]` | The liability cap |

Also decide whether you need an EU or UK representative (Art. 27 GDPR) — usually
required if you have EU/UK users and no establishment there. That line is at the
bottom of the privacy policy.

## Hosting them

Apple and Google both need public URLs, and both check that they load.

1. Put them on a domain you control, as HTML — `niblgo.app/privacy` and
   `niblgo.app/terms`. GitHub Pages is free and fine.
2. They must be reachable **without logging in**.
3. Link both in App Store Connect and Google Play Console.
4. Link them in the app too — the sign-up screen is the usual place, and it
   strengthens the argument that the user agreed.

## Filling in Apple's and Google's forms

Both stores ask you to declare your data collection separately from the policy,
and **a mismatch between the form and the app's behaviour is a common rejection**.
Based on what NiblGo actually does:

### Apple — App Privacy

| Category | Collected? | Linked to user? | Tracking? |
| --- | --- | --- | --- |
| Contact Info → Email Address | Yes | Yes | No |
| User Content → Photos | Yes | Yes | No |
| User Content → Other (posts, blurbs, messages) | Yes | Yes | No |
| Identifiers → User ID | Yes | Yes | No |
| Diagnostics → Crash/Performance | **No** | — | — |
| Usage Data | **No** | — | — |
| Location | **No** | — | — |

Answer **No** to "Do you use data for tracking?" — there is no tracking SDK, no
advertising identifier, and no data shared with data brokers. That also means
**no App Tracking Transparency prompt is needed**.

### Google Play — Data safety

- Data collected: email, photos, other user-generated content, user IDs
- Data shared with third parties: **yes** — blurb text goes to Anthropic when a
  user requests a recipe card. Declare it under "App functionality"
- Encrypted in transit: **yes**
- Users can request deletion: **yes** — in-app, plus an email route
- Data used for advertising or tracking: **no**

Google requires a deletion route reachable **outside** the app as well, so put
your `[PRIVACY EMAIL]` on the privacy policy page and name it in the console.

## Things in the app these documents depend on

If you change any of these, update the documents to match:

| Document says | Because the code does this |
| --- | --- |
| No ads, analytics or tracking | There is no analytics or ad SDK in `package.json` — verified |
| Photos are publicly reachable by URL | The `photos` bucket is public-read (`schema.sql`) |
| Only blurb text goes to Anthropic | `supabase/functions/format-recipe` sends the blurb and nothing else |
| Notifications don't phone home | Mealtime reminders are local notifications; no push token is sent anywhere |
| Deleting your account deletes your photos | `delete-account` sweeps the user's storage folder before deleting the auth user |
| Reports outlive the account | `reports` and `feedback` use `ON DELETE SET NULL` and keep content snapshots |
| Nobody can read your DMs | Enforced in row-level security, tested in `supabase/tests/dm_test.sql` |
| Follower lists can be private | `users.follows_private`, enforced in RLS |
| Location isn't collected | `LOCATION_TAGGING_ENABLED = false` in `src/config.ts` |

## The one that will bite you

The Terms commit you to reviewing reports **within 24 hours**. Apple asks for
that commitment for user-generated content, and it is a promise to your users
once published. `MODERATION.md` has the queries. Someone has to actually look.
