-- Per-member mute for a DM thread. Each member can mute a conversation for
-- themselves (one row in conversation_members per member), so muting is
-- naturally private and per-person. The DM push sender checks this flag before
-- notifying a recipient.
alter table public.conversation_members
  add column if not exists muted boolean not null default false;
