# Moderation: working the report queue

How to see what users have reported and act on it. This is the operational
side of the in-app **Report** button.

There is no admin UI yet — you work the queue from the **Supabase dashboard**.
That is deliberate for now: an admin panel is a login surface with god-mode
over user data, and it isn't worth building until report volume justifies it.

---

## Where reports live

Table: **`public.reports`**. One row per person per post.

| Column | What it's for |
| --- | --- |
| `id` | Report id |
| `post_id` | The reported post. **Goes null if the post is deleted** |
| `reporter_id` | Who filed it. Never show this to the reported user |
| `reported_user_id` | Author of the reported post. Survives post deletion |
| `reason` | `spam`, `harassment`, `sexual`, `violence`, `self_harm`, `false_info`, `intellectual_property`, `other` |
| `detail` | Optional free text from the reporter |
| `post_blurb_snapshot` | The post's words, copied at report time |
| `post_photo_url_snapshot` | The post's photo URL, copied at report time |
| `status` | `open` → `reviewing` → `actioned` \| `dismissed` |
| `created_at` | When it was filed |
| `reviewed_at`, `reviewer_notes` | Your audit trail |

### Why the snapshots exist

`post_id` is `ON DELETE SET NULL`, not `CASCADE`. If a reported user deletes
their post, **the report survives** and the snapshot still shows what was
reported. Without this, deleting your own post would erase the evidence
against you — which is exactly what a bad actor would do.

So: a report with `post_id IS NULL` means *the author already deleted it*. That
is useful signal, not a broken row.

---

## Getting in

1. <https://supabase.com/dashboard> → your project.
2. **SQL Editor → New query** for the queries below, or **Table Editor →
   `reports`** to click around and edit rows by hand.

Both run as the service role, which bypasses RLS. That's the only way to read
this table — see [Who can see what](#who-can-see-what).

---

## The daily queue

Oldest open reports first, with everything you need to judge them:

```sql
select
  r.id,
  r.created_at,
  r.reason,
  r.detail,
  coalesce(r.post_blurb_snapshot, '(no text)') as reported_text,
  r.post_photo_url_snapshot as photo,
  r.post_id is null as author_already_deleted_it,
  u.handle    as reported_user,
  u.id        as reported_user_id
from public.reports r
left join public.users u on u.id = r.reported_user_id
where r.status = 'open'
order by r.created_at
limit 50;
```

Open `photo` in a browser tab to see the image (the bucket is public).

### Prioritise: same post, many reporters

Several independent people reporting one post is the strongest signal you get.

```sql
select
  post_id,
  count(*)                        as report_count,
  array_agg(distinct reason)      as reasons,
  min(created_at)                 as first_reported
from public.reports
where status = 'open' and post_id is not null
group by post_id
having count(*) > 1
order by report_count desc;
```

### Repeat offenders

```sql
select
  u.handle,
  u.id,
  count(*) filter (where r.status = 'actioned') as upheld,
  count(*)                                      as total_reports
from public.reports r
join public.users u on u.id = r.reported_user_id
group by u.handle, u.id
having count(*) > 1
order by upheld desc, total_reports desc;
```

`upheld` is what matters. A high `total_reports` with zero `upheld` can just
mean someone is being brigaded.

---

## Acting on a report

**1. Claim it** so you don't collide with your cofounder:

```sql
update public.reports set status = 'reviewing' where id = '<report-id>';
```

**2a. It's fine → dismiss:**

```sql
update public.reports
set status = 'dismissed', reviewed_at = now(), reviewer_notes = 'Within guidelines.'
where id = '<report-id>';
```

**2b. It breaks the rules → remove the post, then record it:**

```sql
-- Removing the post leaves every report about it intact (SET NULL + snapshot).
delete from public.posts where id = '<post-id>';

update public.reports
set status = 'actioned', reviewed_at = now(), reviewer_notes = 'Removed: harassment.'
where post_id is null and reported_user_id = '<user-id>' and status in ('open','reviewing');
```

Close **every** open report on that post, not just the one you opened.

**3. Repeat or severe offender → remove the account.** This cascades their
posts, comments, and follows:

```sql
-- Profile row and all their content.
delete from public.users where id = '<user-id>';
```

Their `auth.users` row is separate. Delete it in **Authentication → Users**, or
they can still sign in to an empty account.

> Reports they *filed* are removed with them (`reporter_id` cascades). Reports
> *against* them survive with `reported_user_id` set to null — the audit trail
> stays.

---

## Who can see what

RLS on `reports` is write-mostly, and this is a privacy guarantee, not a
convention:

- A user can **file** a report and **read back only their own**.
- A reported user **cannot see reports against them**, cannot see who filed,
  and **cannot delete them**.
- **Nobody** can change `status` from the app — there is no UPDATE policy.
  Only the dashboard/service role can.
- Reporting your own post is blocked (delete it instead).
- One report per person per post; a second attempt is silently ignored so the
  queue can't be flooded by one user.

All of the above is covered by tests in `supabase/tests/` — run them after any
schema change.

---

## Response-time expectations

App Store Guideline 1.2 and Google Play's UGC policy both expect reports to be
acted on in a **timely** manner, and the usual bar people commit to is **24
hours** for a first pass. Practical baseline while you're small:

- Check the open queue **once a day**.
- Anything under `self_harm` or `violence`: look immediately.
- Keep `reviewer_notes` filled in. If a platform or a lawyer ever asks how you
  handle reports, that column *is* your answer.

A standing alert is worth 5 minutes of setup — Supabase can email you on new
rows via a Database Webhook (Database → Webhooks → on `INSERT` to `reports`).

---

## Still missing before public launch

Reporting alone doesn't satisfy the UGC requirements. Also needed:

- [ ] **Block a user.** Apple explicitly requires the ability to block abusive
      users, not just report content. This is the biggest gap.
- [ ] **Published contact method** for moderation appeals (support email in the
      app and on the store listing).
- [ ] **Terms / community guidelines** the user accepts at sign-up, so
      "breaks the rules" points at something written down.
- [ ] **Appeals path** for people whose content was removed.
- [ ] Consider auto-hiding a post once it passes a report threshold, so bad
      content isn't live for a full day while you sleep.
