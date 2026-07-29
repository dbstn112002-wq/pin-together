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
alter table public.notifications add constraint notifications_kind_check check (kind in ('pin','message','comment','reply','route','member','invite','reaction','favorite','location','system','checklist','poll'));
do $$ begin
  if exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='notification_kind') then alter type public.notification_kind add value if not exists 'checklist'; end if;
end $$;

-- 공간 또는 핀에 연결된 체크리스트의 모든 변경을 알립니다. 개인 목록은 공간에 속하지 않으므로 제외합니다.
create or replace function public.notify_checklist_activity(p_checklist_id uuid, p_message text) returns void language plpgsql security definer set search_path = public as $$
declare target_space_id uuid;
declare actor_id uuid;
declare actor_name text;
begin
  select c.space_id, coalesce(auth.uid(), c.owner_id) into target_space_id, actor_id from public.checklists c where c.id = p_checklist_id;
  if target_space_id is null then return; end if;
  select nickname into actor_name from public.profiles where id = actor_id;
  insert into public.notifications(user_id, space_id, kind, body)
  select sm.user_id, target_space_id, 'checklist', coalesce(actor_name, '참여자') || ' : ' || p_message
  from public.space_members sm left join public.notification_preferences np on np.user_id = sm.user_id
  where sm.space_id = target_space_id and sm.user_id <> actor_id and coalesce(np.checklist, true);
end $$;

create or replace function public.notify_checklist_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify_checklist_activity(new.id, new.title || case when new.scope = 'pin' then ' 체크리스트를 핀에 추가했습니다.' else ' 체크리스트를 생성했습니다.' end);
    return new;
  end if;
  perform public.notify_checklist_activity(old.id, old.title || ' 체크리스트를 삭제했습니다.');
  return old;
end $$;

create or replace function public.notify_checklist_item_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare checklist_title text;
declare target_id uuid;
declare message text;
begin
  -- 상위 체크리스트 삭제에 의해 실행된 cascade 항목 삭제는 별도 알림으로 보내지 않습니다.
  if pg_trigger_depth() > 1 then if tg_op = 'DELETE' then return old; else return new; end if; end if;
  if tg_op = 'DELETE' then target_id := old.checklist_id; else target_id := new.checklist_id; end if;
  select title into checklist_title from public.checklists where id = target_id;
  -- 상위 체크리스트 삭제에 따른 cascade 삭제는 상위 목록 삭제 알림 한 건으로만 처리합니다.
  if checklist_title is null then if tg_op = 'DELETE' then return old; else return new; end if; end if;
  if tg_op = 'INSERT' then
    message := checklist_title || '에 항목을 추가했습니다: ' || new.label;
  elsif tg_op = 'DELETE' then
    message := checklist_title || '에서 항목을 삭제했습니다: ' || old.label;
  elsif new.is_checked is distinct from old.is_checked then
    message := checklist_title || ' 항목을 ' || case when new.is_checked then '체크했습니다: ' else '체크 해제했습니다: ' end || new.label;
  else
    message := checklist_title || ' 항목을 수정했습니다: ' || new.label;
  end if;
  perform public.notify_checklist_activity(target_id, message);
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists checklists_notify_created on public.checklists;
drop trigger if exists checklists_notify_changed on public.checklists;
create trigger checklists_notify_changed after insert or delete on public.checklists for each row execute function public.notify_checklist_changed();
drop trigger if exists checklist_items_notify_changed on public.checklist_items;
create trigger checklist_items_notify_changed after insert or update or delete on public.checklist_items for each row execute function public.notify_checklist_item_changed();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='checklists') then alter publication supabase_realtime add table public.checklists; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='checklist_items') then alter publication supabase_realtime add table public.checklist_items; end if;
end $$;
