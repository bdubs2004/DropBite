-- NiblGo: stop anon from calling the SECURITY DEFINER helpers
--
-- Run this on any existing database. A fresh `schema.sql` already includes it.
-- Safe to run more than once.
--
-- Found by probing a live project: every helper below answered an anonymous
-- request over PostgREST. `revoke ... from public` in the original schema did
-- not cover it, because Supabase separately grants EXECUTE on functions in
-- `public` to anon and authenticated via ALTER DEFAULT PRIVILEGES, and PUBLIC
-- and `anon` are different grantees.

-- ------------------------------------------------ function execute grants
-- These have to be explicit. Supabase sets ALTER DEFAULT PRIVILEGES so every
-- new function in `public` is executable by anon and authenticated, and
-- `revoke ... from public` does NOT remove those role grants — PUBLIC and
-- `anon` are different grantees. Without the revokes below, anyone holding the
-- app's anon key (which is public by design) can call these SECURITY DEFINER
-- helpers directly over PostgREST and they answer, bypassing RLS:
--
--   * is_following()      would expose the follow graph of private accounts
--   * is_blocked_pair()   would reveal that someone blocked you, which
--                         SECURITY.md promises is never visible
--   * consume_ai_quota()  would let anyone burn another user's daily AI
--                         allowance and switch their recipe cards off
--
-- The five policy helpers genuinely need `authenticated`: an RLS policy
-- expression runs as the caller, so the caller must be able to execute what the
-- policy calls. Everything else gets nothing.
revoke all on function public.is_blocked_pair(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

revoke all on function public.is_conversation_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

revoke all on function public.conversation_is_empty(uuid) from public, anon, authenticated;
grant execute on function public.conversation_is_empty(uuid) to authenticated;

revoke all on function public.conversation_has_block(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conversation_has_block(uuid, uuid) to authenticated;

revoke all on function public.is_following(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_following(uuid, uuid) to authenticated;

-- Called directly by the app. Follower counts are public by design.
revoke all on function public.follow_counts(uuid) from public, anon, authenticated;
grant execute on function public.follow_counts(uuid) to authenticated;

-- Only the format-recipe edge function calls this, and it uses the service
-- role key. No client should ever be able to move another user's meter.
revoke all on function public.consume_ai_quota(uuid, integer) from public, anon, authenticated;

-- Trigger functions. Postgres does not check EXECUTE on a trigger function when
-- the trigger fires — only when the trigger is created — so revoking here costs
-- nothing and removes two more entry points.
revoke all on function public.notify_post_interaction() from public, anon, authenticated;
revoke all on function public.notify_comment() from public, anon, authenticated;
