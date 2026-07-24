-- Run once in Supabase SQL Editor after collaboration-migration.sql.
-- One reaction per user per pin: like, neutral, or dislike.

create table if not exists public.pin_reactions (
  pin_id uuid not null references public.pins(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('like', 'neutral', 'dislike')),
  created_at timestamptz not null default now(),
  primary key (pin_id, user_id)
);

create index if not exists pin_reactions_pin_idx on public.pin_reactions(pin_id, created_at);
alter table public.pin_reactions enable row level security;

drop policy if exists "members see pin reactions" on public.pin_reactions;
drop policy if exists "users add own pin reactions" on public.pin_reactions;
drop policy if exists "users update own pin reactions" on public.pin_reactions;
drop policy if exists "users remove own pin reactions" on public.pin_reactions;

create policy "members see pin reactions" on public.pin_reactions
for select to authenticated
using (exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));

create policy "users add own pin reactions" on public.pin_reactions
for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));

create policy "users update own pin reactions" on public.pin_reactions
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));

create policy "users remove own pin reactions" on public.pin_reactions
for delete to authenticated
using (user_id = auth.uid());

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pin_reactions'
  ) then
    alter publication supabase_realtime add table public.pin_reactions;
  end if;
end $$;
