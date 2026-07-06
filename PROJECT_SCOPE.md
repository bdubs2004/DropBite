# Project Scope — DropBite (Working Title: TBD)

## 1. Vision

A photo-first social app where people share what they actually cook and eat, meal by meal. Think BeReal's authenticity and in-the-moment energy, restructured around the natural rhythm of food: breakfast, lunch, dinner, and snacks. Home cooks show off what they made, diners tag where they ate, and AI turns casual descriptions into beautiful recipe cards.

**Core insight:** Food logging apps fail because logging is a chore. Social food apps fail because Instagram already exists. This app wins by making posting feel like sharing with friends (not performing for strangers) and by removing the friction of recipe writing entirely.

**Target audience:** Home-cooking enthusiasts — the Facebook-food-group demographic is the beachhead (heavily middle-aged women who love to cook and share), but the product is designed for anyone who wants to post their sourdough, their meal prep, or their lunch. Nothing in the design should feel exclusionary.

**Long-term goal:** Grow an engaged user base generating structured food-consumption data, positioning the company for acquisition. North star metrics are DAU and posts-per-user-per-day, not early revenue.

---

## 2. Core Product Loop

1. User gets a gentle push notification at mealtime (~8am breakfast, ~noon lunch, ~6pm dinner, timezone-aware; snacks anytime).
2. User snaps a photo of their meal.
3. **If home-cooked:** user writes a casual blurb or chats a rambling description of what they made ("threw in some garlic, browned the chicken..."). AI formats it into a clean, structured recipe card. **User can edit anything the AI got wrong** (e.g., 1 tbsp → 2 tbsp) before posting.
4. **If eating out:** user tags the restaurant (Google Places-backed). Later phases: select the actual dish from the restaurant's menu.
5. Post appears in a friends feed. The user's own voice/blurb stays front and center — AI structures the recipe but never replaces their words.

### Key design principles
- **Photo-first, always.** No photo, no post.
- **Meal slots, not a single daily timer.** 3–4 posting occasions per day = more content and engagement than BeReal's one.
- **Soft simultaneity.** Notification windows create the "everyone's posting dinner right now" feeling without punishing anyone.
- **AI assists, humans own.** All AI output is editable. The person's blurb is the content; the recipe card is the utility.
- **Streaks / gentle habit mechanics** to drive retention.

---

## 3. Phased Roadmap

### Phase 1 — Free, Minimal, Habit-Forming (MVP)
Goal: prove retention. Success = users posting 3+ times/week after one month.
- Account creation, profiles, friend/follow system
- Meal-slot posting (breakfast / lunch / dinner / snack) with photo upload
- Casual blurb field on every post
- Basic AI recipe cleanup (light formatting of the blurb into readable structure)
- Restaurant tagging via Google Places API (no custom location DB)
- Friends feed (chronological)
- Mealtime push notifications (timezone-aware)
- Streaks
- **No ads. No paywall.** Retention is the only job.

### Phase 2 — Native Advertising
Only after Phase 1 retention is proven.
- Sponsored/featured restaurant placements in tags and feed ("trending near you")
- Sponsored dishes
- No banner ads — native placements only; ads must fit the content, not interrupt it

### Phase 3 — Premium Tier + Restaurant Platform
**Consumer premium (~$4–6/mo)** — extra convenience for the most engaged 5–10%, never a gate on the core loop:
- Full AI recipe card generation (fancy formatting, ingredient parsing, cook times)
- Nutrition estimates
- Personal "recipe book" compiled from post history
- Meal history / exports ("what did I eat this month?")

**Restaurant side:**
- Menus enter the system via existing APIs and user crowdsourcing (free)
- Restaurants pay to **claim and manage** their page: edit menus, respond to tags, access analytics ("your grilled nuggets got tagged 400x this month, here's the breakdown")
- Menu selection on tag: user tags Chick-fil-A → picks "Market Salad" from the real menu → structured consumption data

---

## 4. Monetization & Exit Strategy

- **Revenue lines (in order of expected size):** native restaurant advertising → restaurant SaaS (claimed pages + analytics) → consumer premium.
- **Acquisition thesis:** acquirers (delivery platforms, review platforms, nutrition apps, social/discovery platforms) buy engaged users and proprietary structured data, not small revenue. The structured what-people-actually-ate dataset (recipes + menu-level restaurant selections) is the moat.
- **Implication:** don't let early monetization slow growth. Modest revenue proves the mechanism; scale and data make the exit.

---

## 5. Data & Legal Foundations (Day One, Non-Negotiable)

- Privacy policy and ToS drafted so that aggregated/anonymized consumption-data use is actually permitted — the acquisition data room depends on this.
- Clean, structured data models from the start: every recipe card and menu selection should produce queryable structured data (ingredients, cuisine, dish, restaurant, timestamp, location).
- User trust preserved: transparent policies, easy data export/deletion. Sloppy data practices kill acquisitions.
- (Have a lawyer review the ToS/privacy policy before launch — this document is planning, not legal advice.)

---

## 6. Funding, Credits & Cost Reality (South Dakota)

**Cost picture:** building is the cheap part. AI recipe formatting on a budget model costs a fraction of a cent per post (~$2 per 1,000 posts); the Anthropic API is pay-as-you-go prepaid credits with no subscription. Real early costs: Apple Developer ($99/yr), Google Play ($25 one-time), Google Places API beyond free tier, photo storage/bandwidth at scale. Marketing is the eventual big cost — see MARKETING_STRATEGY.md.

**Subsidies to pursue (in order of ease):**
1. **Cloud/tool startup credits** (location-agnostic, apply immediately): AWS Activate, Google for Startups, Microsoft for Startups, Supabase startup program, Anthropic startup/API credit programs. Can realistically cover infrastructure for year one.
2. **South Dakota Proof of Concept Fund (GOED):** up to $25,000, rolling applications, 10% match. Funds consultant contracts, materials, non-principal SD employee salaries, and feasibility/marketing studies — NOT founder salaries or general operating expenses. Frame the application around the structured food-data platform, not "a social app."
3. **Governor's Giant Vision competition:** ~$20k top prize + investor exposure. Free to enter.
4. **Sioux Falls ecosystem:** Startup Sioux Falls, Zeal Center for Entrepreneurship — mentorship, programs, and the path to regional angels.

**Notes:** incorporate with South Dakota as home base (state programs require in-state commercialization — confirm details with a lawyer/accountant at formation). Grants won't cover ad spend; growth capital comes from angels/investors once retention is proven. Not financial advice — a map of what exists.

## 7. Brand Identity (Decided)

- **Name:** DropBite — "drop" = the BeReal-style posting mechanic; "bite" = food. A known fishing-lure brand shares the name in an unrelated trademark class; low confusion risk, but run USPTO clearance with an attorney before filing. Verify App Store name, domain, and social handles.
- **Logo:** "The Bitten Drop" — a droplet with a bite taken out and crumbs floating away. Master files: `dropbite-logo.svg` (lockup), `dropbite-icon.svg` (mark only), `dropbite-appicon.svg` (1024×1024 store icon).
- **Palette:** Amber `#E8862E`, Cream `#FFF4DE`, Cocoa ink `#4A2E12`.
- **Wordmark type:** Baloo 2 ExtraBold, lowercase ("dropbite"). Convert text to outlines before print/production use.
- **Motif:** bite-and-crumbs carries through the product — bitten corners on recipe cards, crumb-trail loaders, etc.

## 8. Open Questions / Decisions Deferred

- Platform: mobile-first is assumed (iOS first? React Native/Flutter for both?) — decide before build
- App name and branding
- Feed algorithm beyond chronological (defer; chronological is fine for MVP)
- Content moderation approach (photo moderation needed before scale)
- AI cost management: which model tier for free-tier cleanup vs. premium generation
- Menu data sourcing: which APIs, crowdsourcing UX
