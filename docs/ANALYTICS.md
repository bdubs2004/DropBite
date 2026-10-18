# Analytics: NiblGo KPIs in Power BI

NiblGo's KPIs come straight from the database: what the app already stores
(sign-ups, posts, recipe cards, likes, comments, saves, follows) plus a few
things recorded for analytics (migration `0041_analytics.sql`): app opens,
posts by other people that came on screen, recipes opened, invites shared, who
invited whom, and labels you set by hand. Power BI Desktop reads a set of
**reporting views** through a read-only login that can see those views and
nothing else.

Files:
- `supabase/migrations/0041_analytics.sql`: the tables, recording functions and views
- `analytics/powerbi/measures.dax`: every KPI measure, pasted in one go
- `analytics/powerbi/report-layout.md`: the four report pages
- `analytics/powerbi/NiblGo-theme.json`: the report theme

## What counts as what

Defined once, in the views, so every chart agrees. Days are each person's own
days (their time zone), not UTC.

| Term | Definition |
| --- | --- |
| Active on a day | Opened the app (once per 30 minutes away counts as a new visit) or did anything: posted, liked, commented, saved, reposted, shared, followed, messaged, or saw someone's post |
| DAU / WAU | People active that day / in the 7 days up to the "as of" date |
| Activated | Posted their first meal within 7 days of signing up. Only people who signed up 7+ days ago are counted (younger ones are blank, not failures) |
| D1 retention | Active the day after the sign-up day |
| D7 retention | Active on any day 7 to 13 after the sign-up day |
| D30 retention | Active on any day 30 to 36 after the sign-up day |
| Mature cohort | Only people whose window has fully passed count toward D1/D7/D30 |
| Viewed another user's meal | At least one post by someone else was on their screen (most of the card, half a second) |
| Recipe save rate | People who saved a post with a recipe card ÷ people who opened a recipe on someone else's post |
| Repeat posting rate | People with 2+ posts ÷ people with 1+ |
| Weekly returning rate | Active this week and last week ÷ active this week (Monday to Sunday) |
| Referral | The new person typed a friend's handle as their invite code at sign-up |
| Stranger | `relationship` = `independent` (you label it) |
| Test account | `is_test` = true (you label it): left out of everything |

`kpi_daily` and `kpi_weekly` hold the same numbers day by day and week by week
(test accounts already left out), handy for a quick look in the SQL Editor:
`select * from analytics.kpi_daily order by day desc;`

## One-time setup

### 1. Database
Supabase → SQL Editor: run `supabase/upgrade_all.sql`, then `supabase/verify.sql`
(it should say **PASS**).

### 2. A login for Power BI
SQL Editor, with a long password of your own (a password manager's 32+
characters; it's never stored anywhere in the code):

```sql
create role powerbi with login password 'PASTE-A-LONG-RANDOM-PASSWORD-HERE' in role analytics_reader;
```

That login can read the reporting views and nothing else: no profiles, emails,
captions or messages (the security tests check this). To change the password
later: `alter role powerbi with password '...';`. To remove it:
`drop role powerbi;`.

### 3. Recipe cards
The `format-recipe` function now records each card it makes. Redeploy it:
```powershell
supabase functions deploy format-recipe --project-ref lmmuevnvshcqaqxjosbe
```

### 4. Label your beta testers
In the SQL Editor, one line per person (leave out what you don't want to set):

```sql
select analytics.label('JoeMama', source => 'direct', relationship => 'family_friend', campus => 'UNL');
select analytics.label('your_own_handle', is_test => true);
select * from analytics.label_overview order by signed_up;   -- everyone, with their labels
```

- source: `direct`, `referral`, `tiktok`, `instagram`, `campus`, `app_store`, `other`
- relationship: `family_friend`, `acquaintance`, `independent`
- campus: any short name, e.g. `UNL`
- is_test: `true` for your own and any test accounts

People who used an invite code are counted as `referral` automatically unless
you label them otherwise. Anyone unlabelled shows as `unknown`.

### 5. The app
App opens, views, recipe opens and invites are recorded from the next build:
```powershell
git pull
npm install
eas build -p ios --profile production --auto-submit
```
Sign-ups, posts, likes, comments and saves already have their full history.

## Connecting Power BI Desktop

1. **Install** Power BI Desktop (free, from the Microsoft Store).
2. **Find the address:** Supabase dashboard → **Connect** (top of the
   project) → **Session pooler**. Note the host
   (`aws-0-<region>.pooler.supabase.com`) and port **5432**.
3. **Connect:** Power BI → **Get data → More… → PostgreSQL database**.
   - Server: `aws-0-<region>.pooler.supabase.com:5432`
   - Database: `postgres`
   - Data connectivity mode: **Import**
   - Credentials: **Database**, user name `powerbi.lmmuevnvshcqaqxjosbe`
     (the login's name, a dot, your project ref), and your password.
4. **If it says the certificate isn't trusted** ("The remote certificate is
   invalid"):
   1. In Supabase, go to **Project Settings → Database → SSL Configuration →
      Download certificate**.
   2. Double-click the downloaded file, then **Install Certificate → Local
      Machine → Place all certificates in the following store → Trusted Root
      Certification Authorities**.
   3. Restart Power BI and connect again.
5. **Pick the views:** in the Navigator, open `analytics` and tick **dim_users,
   fact_activity_days, fact_posts, fact_post_hashtags, fact_interactions,
   fact_events, fact_post_views, fact_referrals, kpi_daily, kpi_weekly** →
   **Load**.
6. **Rename** each table to drop the `analytics ` prefix. Do this in the Data
   pane: right-click the table → Rename (e.g. `analytics dim_users` →
   `dim_users`).
7. **Calendar table:** Modeling → New table:
   ```dax
   Calendar = ADDCOLUMNS ( CALENDAR ( DATE ( 2026, 1, 1 ), TODAY () ),
       "Week", [Date] - WEEKDAY ( [Date], 3 ),
       "Month", DATE ( YEAR ( [Date] ), MONTH ( [Date] ), 1 ) )
   ```
   Then Table tools → **Mark as date table** → `Date`.
8. **Relationships** (Model view; drag, single direction, many-to-one):
   - `dim_users[user_id]` → `user_id` on `fact_activity_days`, `fact_posts`,
     `fact_interactions`, `fact_events`, `fact_post_views`
   - `dim_users[user_id]` → `fact_referrals[new_user_id]`
   - `fact_posts[post_id]` → `fact_post_hashtags[post_id]`
   - `'Calendar'[Date]` → `fact_activity_days[activity_date]`,
     `fact_posts[created_date]`, `fact_interactions[created_date]`,
     `fact_events[occurred_date]`, `fact_post_views[viewed_date]`,
     `fact_referrals[created_date]`
   - `'Calendar'[Date]` → `dim_users[signup_date]`: create it, then set it to
     **inactive** (untick "Make this relationship active"). The sign-up
     measures switch it on themselves.
   - Delete any relationship Power BI guessed on its own that isn't in this list.
9. **Measures:** DAX query view → paste all of
   `analytics/powerbi/measures.dax` → **Update model with changes**.
10. **Theme:** View → Themes → Browse for themes →
    `analytics/powerbi/NiblGo-theme.json`.
11. **Test accounts out:** Filters pane → Filters on all pages →
    `dim_users[is_test]` = **False**.
12. **Build the pages** in `analytics/powerbi/report-layout.md`, then save the
    `.pbix` somewhere safe (it isn't kept in the repository).

**Refreshing:** Home → **Refresh** pulls the latest numbers. Power BI Desktop
doesn't refresh on its own. Scheduled refresh needs the Power BI Service (Pro),
and possibly a data gateway for the database connection.

## Privacy

- Power BI only ever sees ids, dates, counts and categories (meal slot, price,
  hashtags, labels): no emails, names, handles, captions or messages. The
  `powerbi` login can't read anything else (tested).
- Recording goes through functions that act only as the signed-in person; the
  app's users can't read or write the analytics schema, and it isn't exposed
  through the API at all.
- Deleting an account deletes its analytics rows too (tested). So retention
  numbers for a past cohort can drop slightly when someone deletes their account.
- The privacy policy says the app records this usage to improve NiblGo, never
  for ads, and deletes it with the account. App Store Connect → App Privacy:
  **Usage Data → Product Interaction**, linked to the user, purpose
  **Analytics**, not used for tracking.
- Keep the `.pbix` file private: it holds a copy of the numbers.

## Later

- **Landing-page visitors and sign-up conversion:** turn on Cloudflare Web
  Analytics for niblgo.com, then bring visits into Power BI from Cloudflare's
  analytics API.
- **Spend:** a small `campaigns` table (channel, campus, spend, dates) for cost
  per sign-up and per activated user.
- **Sources without labelling by hand:** an optional "How did you hear about
  NiblGo?" question at sign-up, and invite links that fill in the code.
