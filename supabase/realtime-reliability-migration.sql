-- Run once in the Supabase SQL Editor.
-- Makes the shared tables available to Supabase Realtime.
do $$
declare table_name text;
begin
  foreach table_name in array array['pins','messages','message_reads','space_routes','route_stops','notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
