# CLAUDE.md — Build Guide for DropBite

This file instructs Claude Code on how to build this project. Read PROJECT_SCOPE.md first for full product context. This file is the how; that file is the why.

## What We're Building (One Paragraph)

A mobile-first, photo-first social app where users post meals in slots (breakfast / lunch / dinner / snack), get timezone-aware mealtime notifications, write casual blurbs that AI formats into editable recipe cards, tag restaurants via Google Places, and follow friends in a chronological feed. Phase 1 (MVP) only — no ads, no payments, no restaurant dashboard yet.

## Build Priorities (In Order)

1. **Retention mechanics over polish.** The posting flow (photo → blurb → post) must be fast and delightful before anything else gets attention.
2. **Structured data from day one.** Every post, recipe, and restaurant tag must write clean, queryable structured records. This is a core business asset, not an implementation detail.
3. **AI output is always editable.** Never ship an AI-generated recipe card the user can't correct field-by-field before posting.
4. **The user's voice is sacred.** The blurb they wrote displays prominently and untouched. AI recipe cards are supplementary UI, never a replacement for their words.

## MVP Feature Checklist (Phase 1 Only)

- [ ] Auth + user profiles (display name, avatar, bio)
- [ ] Friend/follow system
- [ ] Post creation: photo (required) + meal slot + blurb + optional restaurant tag
- [ ] Meal slots: breakfast, lunch, dinner, snack — user picks, sensible default by time of day
- [ ] AI recipe cleanup: send blurb to Claude API, get back structured recipe (title, ingredients[], steps[], est. cook time), render as editable card
- [ ] Restaurant tagging via Google Places API (search + attach place_id, name, location)
- [ ] Chronological friends feed with pull-to-refresh
- [ ] Push notifications: ~8:00 breakfast, ~12:00 lunch, ~18:00 dinner, local timezone, individually toggleable
- [ ] Streak counter (consecutive days with ≥1 post)
- [ ] Basic settings: notification prefs, account deletion, data export

Explicitly OUT of scope for MVP: ads, payments/premium tier, restaurant menu selection, restaurant claiming/dashboard, nutrition estimates, recipe book compilation, feed algorithm, DMs, comments beyond simple likes/reactions (likes only for MVP).

## Recommended Stack (Adjust Only With Good Reason)

- **App:** React Native + Expo (single codebase, fast iteration, easy push notifications via Expo)
- **Backend:** Supabase (Postgres, auth, storage for photos, row-level security) — or equivalent BaaS; avoid building custom auth/infrastructure for MVP
- **AI:** Anthropic API for recipe structuring. Use a small/cheap model for free-tier cleanup. One call per post creation, only when the user has a blurb and taps "format recipe" — never call automatically on every keystroke.
- **Places:** Google Places API for restaurant search/tagging
- **Push:** Expo Notifications

## Data Model (Core Tables — Keep This Shape)

- `users`: id, handle, display_name, avatar_url, timezone, created_at
- `follows`: follower_id, followee_id, created_at
- `posts`: id, user_id, meal_slot (enum: breakfast|lunch|dinner|snack), photo_url, blurb (text, verbatim user words), restaurant_place_id (nullable), restaurant_name (nullable), lat/lng (nullable), created_at
- `recipes`: id, post_id, title, ingredients (jsonb array of {item, quantity, unit}), steps (jsonb array), cook_time_minutes, ai_generated (bool), user_edited (bool)
- `reactions`: post_id, user_id, type, created_at
- `streaks`: user_id, current_streak, longest_streak, last_post_date

Rules:
- Ingredients must be parsed into structured {item, quantity, unit} — not a text blob. This structure is the long-term data asset.
- Store the original blurb verbatim forever; the recipe is derived, the blurb is source of truth.
- Track `user_edited` on recipes so we know AI accuracy over time.

## AI Recipe Formatting — Implementation Notes

- Prompt the model to return strict JSON: {title, ingredients: [{item, quantity, unit}], steps: [], cook_time_minutes}. Parse defensively; on parse failure, fall back gracefully (show blurb only, offer retry) — never block the post.
- The user reviews the card before posting and can edit every field inline (this is a hard requirement).
- If the blurb clearly isn't a recipe (restaurant meal, "just cereal lol"), skip the recipe card entirely — don't force it.
- Keep prompts and model choice in one config module so cost/quality tuning is easy later.

## Engineering Conventions

- TypeScript everywhere, strict mode.
- Keep components small; posting flow gets the most testing attention.
- Image handling: compress client-side before upload; store originals at reasonable max resolution (photos are the product — don't over-compress).
- All timestamps UTC in DB; convert to user timezone in UI.
- Feature-flag anything Phase 2/3 adjacent rather than half-building it.
- Write a seed script with fake users/posts so the feed is testable immediately.
- Privacy from day one: data export and account deletion must actually work in MVP.

## Definition of Done for MVP

A new user can: sign up → follow a friend → get a dinner notification → snap a photo → write "chicken thing with garlic and whatever" → see an editable AI recipe card → fix a quantity → post → it appears in their friend's feed with their blurb front and center → streak increments.

If that loop is smooth and fast, MVP is done. Everything else waits.
