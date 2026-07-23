-- 핀투게더 협업 기능 마이그레이션 (schema.sql 실행 후 한 번 실행)
-- 댓글, 공간 삭제, 태그, 공유 경로, 채팅 읽음, 알림을 함께 추가합니다.
-- 기존 features-migration.sql은 실행하지 마세요. 이 파일이 이름 있는 여러 경로를 지원합니다.

-- 공간 삭제와 소유자별 공간 이름 중복 방지
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'spaces_owner_name_unique') then
    alter table public.spaces add constraint spaces_owner_name_unique unique (owner_id, name);
  end if;
end $$;
drop policy if exists "owners delete spaces" on public.spaces;
create policy "owners delete spaces" on public.spaces for delete to authenticated using (public.is_space_owner(id));

-- 핀 태그
create table if not exists public.pin_tags (
  pin_id uuid not null references public.pins(id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 24),
  created_at timestamptz not null default now(),
  primary key (pin_id, tag)
);
create index if not exists pin_tags_tag_idx on public.pin_tags(tag);
alter table public.pin_tags enable row level security;
drop policy if exists "members see pin tags" on public.pin_tags;
drop policy if exists "pin authors manage tags" on public.pin_tags;
create policy "members see pin tags" on public.pin_tags for select to authenticated using (exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));
create policy "pin authors manage tags" on public.pin_tags for all to authenticated using (exists (select 1 from public.pins p where p.id = pin_id and (p.author_id = auth.uid() or public.is_space_owner(p.space_id)))) with check (exists (select 1 from public.pins p where p.id = pin_id and public.can_edit_space(p.space_id)));

-- 핀 댓글
create table if not exists public.pin_comments (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.pins(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists pin_comments_pin_idx on public.pin_comments(pin_id, created_at);
alter table public.pin_comments enable row level security;
drop policy if exists "members see pin comments" on public.pin_comments;
drop policy if exists "members add pin comments" on public.pin_comments;
drop policy if exists "authors delete comments" on public.pin_comments;
create policy "members see pin comments" on public.pin_comments for select to authenticated using (exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));
create policy "members add pin comments" on public.pin_comments for insert to authenticated with check (author_id = auth.uid() and exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));
create policy "authors delete comments" on public.pin_comments for delete to authenticated using (author_id = auth.uid());

-- 이름 있는 공유 경로와 경유지
create table if not exists public.space_routes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references public.profiles(id) on delete cascade,
  updated_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, name)
);
create table if not exists public.route_stops (
  route_id uuid not null references public.space_routes(id) on delete cascade,
  pin_id uuid not null references public.pins(id) on delete cascade,
  stop_order integer not null check (stop_order > 0),
  primary key (route_id, pin_id),
  unique (route_id, stop_order)
);
create index if not exists space_routes_space_idx on public.space_routes(space_id, created_at);
alter table public.space_routes enable row level security;
alter table public.route_stops enable row level security;
drop policy if exists "members see routes" on public.space_routes;
drop policy if exists "editors create routes" on public.space_routes;
drop policy if exists "editors update routes" on public.space_routes;
drop policy if exists "editors delete routes" on public.space_routes;
drop policy if exists "members see route stops" on public.route_stops;
drop policy if exists "editors add route stops" on public.route_stops;
drop policy if exists "editors delete route stops" on public.route_stops;
create policy "members see routes" on public.space_routes for select to authenticated using (public.is_space_member(space_id));
create policy "editors create routes" on public.space_routes for insert to authenticated with check (public.can_edit_space(space_id) and created_by = auth.uid() and updated_by = auth.uid());
create policy "editors update routes" on public.space_routes for update to authenticated using (public.can_edit_space(space_id)) with check (public.can_edit_space(space_id) and updated_by = auth.uid());
create policy "editors delete routes" on public.space_routes for delete to authenticated using (public.can_edit_space(space_id));
create policy "members see route stops" on public.route_stops for select to authenticated using (exists (select 1 from public.space_routes r where r.id = route_id and public.is_space_member(r.space_id)));
create policy "editors add route stops" on public.route_stops for insert to authenticated with check (exists (select 1 from public.space_routes r where r.id = route_id and public.can_edit_space(r.space_id)));
create policy "editors delete route stops" on public.route_stops for delete to authenticated using (exists (select 1 from public.space_routes r where r.id = route_id and public.can_edit_space(r.space_id)));

-- 채팅 읽음 표시. 한 메시지는 한 사용자당 한 번만 읽음 처리됩니다.
create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reads_user_idx on public.message_reads(user_id, read_at desc);
alter table public.message_reads enable row level security;
drop policy if exists "members see message reads" on public.message_reads;
drop policy if exists "users add own message reads" on public.message_reads;
create policy "members see message reads" on public.message_reads for select to authenticated using (exists (select 1 from public.messages m where m.id = message_id and public.is_space_member(m.space_id)));
create policy "users add own message reads" on public.message_reads for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_space_member(m.space_id)));

-- 새 핀·채팅·댓글·경로 알림
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  kind text not null check (kind in ('pin','message','comment','route')),
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "users see own notifications" on public.notifications;
drop policy if exists "users update own notifications" on public.notifications;
create policy "users see own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "users update own notifications" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.notify_space_members()
returns trigger language plpgsql security definer set search_path = public
as $$
declare target_space uuid; actor uuid; content text; event_kind text;
begin
  if TG_TABLE_NAME = 'pins' then target_space := new.space_id; actor := new.author_id; content := '새 핀: ' || new.title; event_kind := 'pin';
  elsif TG_TABLE_NAME = 'messages' then target_space := new.space_id; actor := new.author_id; content := '새 채팅: ' || left(new.body, 80); event_kind := 'message';
  elsif TG_TABLE_NAME = 'pin_comments' then select space_id into target_space from public.pins where id = new.pin_id; actor := new.author_id; content := '새 댓글: ' || left(new.body, 80); event_kind := 'comment';
  else target_space := new.space_id; actor := new.updated_by; content := '공유 경로가 변경되었습니다: ' || new.name; event_kind := 'route';
  end if;
  insert into public.notifications(user_id, space_id, kind, body)
  select user_id, target_space, event_kind, content from public.space_members where space_id = target_space and user_id <> actor;
  return new;
end;
$$;
drop trigger if exists pins_notify on public.pins;
drop trigger if exists messages_notify on public.messages;
drop trigger if exists comments_notify on public.pin_comments;
drop trigger if exists routes_notify on public.space_routes;
create trigger pins_notify after insert on public.pins for each row execute procedure public.notify_space_members();
create trigger messages_notify after insert on public.messages for each row execute procedure public.notify_space_members();
create trigger comments_notify after insert on public.pin_comments for each row execute procedure public.notify_space_members();
create trigger routes_notify after insert or update on public.space_routes for each row execute procedure public.notify_space_members();

-- Realtime publication에 아직 없을 때만 추가합니다.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pin_comments') then alter publication supabase_realtime add table public.pin_comments; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='space_routes') then alter publication supabase_realtime add table public.space_routes; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='route_stops') then alter publication supabase_realtime add table public.route_stops; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then alter publication supabase_realtime add table public.notifications; end if;
end $$;
