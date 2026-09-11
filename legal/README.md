# Legal documents

- **[PRIVACY_POLICY.md](PRIVACY_POLICY.md)** — required by Apple, Google, GDPR and CCPA
- **[TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md)** — also serves as the EULA Apple requires for user-generated content

## Status

Filled in: dates, both contact emails, South Dakota governing law and Minnehaha
County venue, the USD 100 liability cap, Supabase region, and — now published —
the contracting party and its address.

**Contracting party (now set):** both documents and the live site name
**Bryce and Cameron**, 4500 E. 33rd St., Sioux Falls, South Dakota 57110, USA.
That resolves the two placeholders the build used to warn about. Two things about
that choice are still worth knowing:

### 1. `Bryce and Cameron` — who is on the hook

This is the **personal-names** option, and personal liability is exactly what it
means: a claim against NiblGo is a claim against you and your co-founder as
individuals, reaching your own assets.

A South Dakota LLC is the ordinary fix. Filing with the SD Secretary of State is
around **$150 online**, and you can do it yourself in an afternoon — no lawyer
needed for a simple two-member LLC. Given you are shipping a social app that
hosts other people's photos and prints cooking instructions, this is still the
single highest-value hour you can spend. If you form it, put the LLC's name in
both `legal/*.md` files and re-run `npm run build:site`.

### 2. `4500 E. 33rd St.` — the registered address is public

GDPR requires a contactable address, and it is public now that the policy is
published. If you would rather not have this address public, the alternatives,
cheapest first, are a USPS PO box in Sioux Falls (~$20–90/year); a virtual
mailbox; or, if you form the LLC, your registered agent's address, which is
public anyway. Change it in both `legal/*.md` files and re-run the build.

### Do you need an EU representative?

Art. 27 GDPR requires one if you offer services to people in the EU and have no
establishment there. In practice: if you are not marketing to Europe and have no
EU users, you can leave that line out. If you get EU users, revisit it. Note the
policy already names the EU rights and the 72-hour breach rule, which is the
part that actually matters day to day.

## Hosting them

Apple and Google both need public URLs, and both check that they load.

1. The pages are built for you — see `website/`. `npm run build:site` renders
   these documents to `website/privacy.html` and `website/terms.html`, so the
   markdown here stays the single source of truth.
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

Google requires a deletion route reachable **outside** the app as well.
`privacy@niblgo.com` is already named in the privacy policy for exactly
that; put the same address in the Play Console's data-deletion field.

## Things in the app these documents depend on

If you change any of these, update the documents to match:

| Document says | Because the code does this |
| --- | --- |
| No ads, analytics or tracking | There is no analytics or ad SDK in `package.json` — verified |
| Photos are publicly reachable by URL | The `photos` bucket is public-read (`schema.sql`) |
| Blurb text goes to Anthropic for recipe cards | `supabase/functions/format-recipe` sends the blurb and nothing else |
| Ingredient lists go to Anthropic, food names go to USDA, for nutrition | `supabase/functions/lookup-nutrition`. The model is asked only for weights and search terms — the prompt explicitly forbids it returning nutrient values — and USDA supplies the figures |
| Notifications don't phone home | Mealtime reminders are local notifications; no push token is sent anywhere |
| Deleting your account deletes your photos | `delete-account` sweeps the user's storage folder before deleting the auth user |
| Reports outlive the account | `reports` and `feedback` use `ON DELETE SET NULL` and keep content snapshots |
| No other *user* can read your DMs | Enforced in row-level security, tested in `supabase/tests/dm_test.sql`. The policy also states plainly that you, as operator, hold admin access that reaches everything — do not remove that paragraph |
| In-app reporting covers posts, comments, DMs and accounts | Report entry points: `usePostActions.ts` (posts), `CommentsScreen.tsx` (comments), `ChatScreen.tsx` (DMs), `ProfileScreen.tsx` (accounts). Email is an additional route, not the only one for comments and accounts. If you add or remove an entry point, update the Terms |
| Time zone is visible to signed-in users | `users` is readable by any authenticated user and `timezone` is a column on it |
| Follower lists can be private | `users.follows_private`, enforced in RLS |
| Location isn't collected | `LOCATION_TAGGING_ENABLED = false` in `src/config.ts` |

## Going without a lawyer

You have decided not to have these reviewed. That is your call, and these drafts
are more specific to your app than most reviewed policies are — every claim maps
to code in the table above. Three things are worth knowing about what that
choice does and does not cost you:

**What review would most likely have changed.** The dispute-resolution clause
(Terms § 11.1) is the one a lawyer would go at hardest, because how far you can
limit claims varies by state and a clause drafted too aggressively gets struck
in its entirety. The version here is deliberately conservative: individual
claims only, small-claims court expressly preserved, and a 30-day opt-out. Those
last two are what courts look for, and they are why this version is likelier to
survive than a harsher one.

**What no document can fix.** A policy does not create a company. If you skip the
LLC, the strongest terms in the world still leave you personally liable. The LLC
matters more than the paperwork.

**What makes these dangerous rather than protective.** A policy that describes
something you do not do — or omits something you do — is worse than having none,
because you have now put it in writing. The table above exists so that when you
change the app, you can find every claim that has to change with it. Re-read it
whenever you add a service, a permission, or a piece of data.

## The one that will bite you

The Terms commit you to reviewing reports **within 24 hours**. Apple asks for
that commitment for user-generated content, and it is a promise to your users
once published. `MODERATION.md` has the queries. Someone has to actually look.
