# Moderation: working the report queue

How to see what users have reported and act on it. This is the operational
side of the in-app **Report** button.

There is no admin UI yet — you work the queue from the **Supabase dashboard**.
That is deliberate for now: an admin panel is a login surface with god-mode
over user data, and it isn't worth building until report volume justifies it.

---

## Where reports live

Table: **`public.reports`**. One row per person per reported thing — a post,
or a direct message. Exactly one of `post_id` / `message_id` is set; everything
else in the row works the same either way.

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
| `message_id` | The reported DM. **Goes null if the sender deletes it** |
| `message_text_snapshot` | The message's words, copied at report time |
| `message_image_url_snapshot` | The message's attached photo, copied at report time |
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

`message_id` works exactly the same way, for the same reason. **You cannot read
the rest of the thread** — the snapshot is all the context there is, by design:
a moderator shouldn't be able to open anyone's private conversations. Judge the
reported message on its own, and if it isn't judgeable alone, dismiss it and
watch for repeat reports against the same sender.

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
  case when r.message_id is not null or r.message_text_snapshot is not null
       then 'direct message' else 'post' end as kind,
  coalesce(r.post_blurb_snapshot, r.message_text_snapshot, '(no text)') as reported_text,
  coalesce(r.post_photo_url_snapshot, r.message_image_url_snapshot) as photo,
  coalesce(r.post_id, r.message_id) is null as author_already_deleted_it,
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

### DM reports only

Harassment usually shows up in DMs before it shows up in a feed, so it's worth
a separate pass.

```sql
select
  r.id,
  r.created_at,
  r.reason,
  r.detail,
  coalesce(r.message_text_snapshot, '(photo only)') as message,
  r.message_image_url_snapshot as photo,
  r.message_id is null as sender_already_deleted_it,
  u.handle as reported_user
from public.reports r
left join public.users u on u.id = r.reported_user_id
where r.status = 'open' and (r.message_id is not null or r.message_text_snapshot is not null)
order by r.created_at;
```

Someone with several DM reports from **different** reporters is the pattern to
act on — one person reporting one message is often a falling-out, not abuse.

```sql
select
  u.handle,
  count(*)                          as dm_reports,
  count(distinct r.reporter_id)     as distinct_reporters
from public.reports r
join public.users u on u.id = r.reported_user_id
where r.status in ('open', 'reviewing')
  and (r.message_id is not null or r.message_text_snapshot is not null)
group by u.handle
having count(distinct r.reporter_id) > 1
order by distinct_reporters desc;
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


---

## Feedback and bug reports

Separate table, separate purpose: `public.reports` is a moderation queue about
other people's content and carries legal weight. **`public.feedback`** is users
telling you the app itself is wrong, from Help at the bottom of the profile
drawer.

| Column | What it's for |
| --- | --- |
| `kind` | `feedback` (an idea) or `bug` (something broken) |
| `message` | What they wrote |
| `user_id` | Who filed it. **Goes null if they delete their account** |
| `handle_snapshot` | Their handle, kept readable after the account is gone |
| `app_version`, `platform` | Attached automatically — a bug report without these usually isn't actionable |
| `status` | `new` → `triaged` → `resolved` |
| `reviewed_at`, `reviewer_notes` | Your audit trail |

Nobody can read anyone else's, and **nobody can edit or delete a filed report**,
including its author — there is deliberately no update or delete policy, so
what you read is what was sent. Triage through the service role.

```sql
select
  created_at,
  kind,
  message,
  coalesce(handle_snapshot, '(deleted account)') as who,
  platform,
  app_version
from public.feedback
where status = 'new'
order by created_at;
```

Bug reports clustering on one platform or one app version is the signal worth
acting on:

```sql
select platform, app_version, count(*) as reports
from public.feedback
where kind = 'bug' and created_at > now() - interval '14 days'
group by platform, app_version
order by reports desc;
```
