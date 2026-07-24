-- LEGACY/REDUNDANT — do not run for a new setup.
-- Its messages/message_reads Realtime registration is already included in realtime-reliability-migration.sql.
-- Kept only as a historical record.
-- Run once after collaboration-migration.sql.
-- Ensures chat and read receipts are delivered to every open client immediately.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reads'
  ) then
    alter publication supabase_realtime add table public.message_reads;
  end if;
end $$;
