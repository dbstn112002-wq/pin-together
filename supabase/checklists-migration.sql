-- 체크리스트 기능: 개인/공간 목록, 항목, 공간 생성 알림

create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('personal','space','pin')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  pin_id uuid references public.pins(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  icon text not null default '✅' check (char_length(icon) between 1 and 8),
  created_at timestamptz not null default now(),
  constraint checklists_scope_target check ((scope = 'personal' and space_id is null and pin_id is null) or (scope = 'space' and space_id is not null and pin_id is null) or (scope = 'pin' and space_id is not null and pin_id is not null))
);
create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 200),
  position integer not null default 0,
  is_checked boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists checklists_owner_idx on public.checklists(owner_id, created_at desc);
create index if not exists checklists_space_idx on public.checklists(space_id, created_at desc);
create index if not exists checklists_pin_idx on public.checklists(pin_id, created_at desc);
create index if not exists checklist_items_checklist_idx on public.checklist_items(checklist_id, position);

alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
drop policy if exists "users read visible checklists" on public.checklists;
drop policy if exists "users create checklists" on public.checklists;
drop policy if exists "owners or space owners delete checklists" on public.checklists;
create policy "users read visible checklists" on public.checklists for select to authenticated using (owner_id = auth.uid() or (space_id is not null and public.is_space_member(space_id)));
create policy "users create checklists" on public.checklists for insert to authenticated with check (owner_id = auth.uid() and (scope = 'personal' or public.is_space_member(space_id)));
create policy "owners or space owners delete checklists" on public.checklists for delete to authenticated using (owner_id = auth.uid() or (space_id is not null and exists (select 1 from public.space_members where space_id = checklists.space_id and user_id = auth.uid() and role = 'owner')));
drop policy if exists "users read visible checklist items" on public.checklist_items;
drop policy if exists "users edit visible checklist items" on public.checklist_items;
create policy "users read visible checklist items" on public.checklist_items for select to authenticated using (exists (select 1 from public.checklists c where c.id = checklist_id and (c.owner_id = auth.uid() or (c.space_id is not null and public.is_space_member(c.space_id)))));
create policy "users edit visible checklist items" on public.checklist_items for all to authenticated using (exists (select 1 from public.checklists c where c.id = checklist_id and (c.owner_id = auth.uid() or (c.space_id is not null and public.is_space_member(c.space_id))))) with check (exists (select 1 from public.checklists c where c.id = checklist_id and (c.owner_id = auth.uid() or (c.space_id is not null and public.is_space_member(c.space_id)))));

alter table public.notification_preferences add column if not exists checklist boolean not null default true;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('pin','message','comment','reply','route','member','invite','reaction','favorite','location','system','checklist'));
do $$ begin
  if exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='notification_kind') then alter type public.notification_kind add value if not exists 'checklist'; end if;
end $$;

create or replace function public.notify_space_checklist_created() returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  if new.scope <> 'space' then return new; end if;
  select nickname into actor_name from public.profiles where id = new.owner_id;
  insert into public.notifications(user_id, space_id, kind, body)
  select sm.user_id, new.space_id, 'checklist', coalesce(actor_name, '참여자') || ' : ' || new.title || ' 체크리스트가 생성되었습니다.'
  from public.space_members sm left join public.notification_preferences np on np.user_id = sm.user_id
  where sm.space_id = new.space_id and sm.user_id <> new.owner_id and coalesce(np.checklist, true);
  return new;
end $$;
drop trigger if exists checklists_notify_created on public.checklists;
create trigger checklists_notify_created after insert on public.checklists for each row execute function public.notify_space_checklist_created();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='checklists') then alter publication supabase_realtime add table public.checklists; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='checklist_items') then alter publication supabase_realtime add table public.checklist_items; end if;
end $$;
