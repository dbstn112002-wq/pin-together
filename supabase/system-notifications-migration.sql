-- Run once in the Supabase SQL Editor.
-- Enables account-wide system/update notifications without a travel-space target.

do $$
begin
  -- Older installations use a text kind column; only enum-based installations need this value added.
  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'notification_kind') then
    alter type public.notification_kind add value if not exists 'system';
  end if;
end;
$$;

alter table public.notifications alter column space_id drop not null;

-- Text-based installations restrict kinds with this CHECK constraint.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('pin','message','comment','route','member','invite','reaction','favorite','location','system'));
