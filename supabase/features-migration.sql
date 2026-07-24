-- 핀투게더 고급 기능 마이그레이션
-- 기존 schema.sql 실행 후, Supabase SQL Editor에서 이 파일 전체를 한 번 실행합니다.

-- LEGACY — DO NOT RUN. This file contains the previous schema.
-- Use collaboration-migration.sql and the order in supabase/README.md instead.
-- Its space_routes and route_stops definitions conflict with the current schema.

alter table public.spaces add constraint spaces_owner_name_unique unique (owner_id, name);
alter table public.spaces enable row level security;
create policy "owners delete spaces" on public.spaces for delete to authenticated using (public.is_space_owner(id));

alter table public.pins add column sort_order bigint not null default 0;
update public.pins set sort_order = extract(epoch from created_at) * 1000 where sort_order = 0;
create index pins_space_order_idx on public.pins(space_id, sort_order, created_at);

create table public.pin_comments (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.pins(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index pin_comments_pin_idx on public.pin_comments(pin_id, created_at);
alter table public.pin_comments enable row level security;
create policy "members see pin comments" on public.pin_comments for select to authenticated using (exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));
create policy "members add pin comments" on public.pin_comments for insert to authenticated with check (author_id = auth.uid() and exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));
create policy "authors delete comments" on public.pin_comments for delete to authenticated using (author_id = auth.uid());

create table public.space_routes (
  space_id uuid primary key references public.spaces(id) on delete cascade,
  updated_by uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create table public.route_stops (
  space_id uuid not null references public.spaces(id) on delete cascade,
  pin_id uuid not null references public.pins(id) on delete cascade,
  stop_order integer not null check (stop_order > 0),
  primary key (space_id, pin_id),
  unique (space_id, stop_order)
);
alter table public.space_routes enable row level security;
alter table public.route_stops enable row level security;
create policy "members see routes" on public.space_routes for select to authenticated using (public.is_space_member(space_id));
create policy "editors upsert routes" on public.space_routes for insert to authenticated with check (public.can_edit_space(space_id) and updated_by = auth.uid());
create policy "editors update routes" on public.space_routes for update to authenticated using (public.can_edit_space(space_id)) with check (public.can_edit_space(space_id));
create policy "editors delete routes" on public.space_routes for delete to authenticated using (public.can_edit_space(space_id));
create policy "members see route stops" on public.route_stops for select to authenticated using (public.is_space_member(space_id));
create policy "editors add route stops" on public.route_stops for insert to authenticated with check (public.can_edit_space(space_id));
create policy "editors delete route stops" on public.route_stops for delete to authenticated using (public.can_edit_space(space_id));

create type public.notification_kind as enum ('pin','message','comment','route');
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  kind public.notification_kind not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
create policy "users see own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "users update own notifications" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.notify_space_members()
returns trigger language plpgsql security definer set search_path = public
as $$ declare target_space uuid; actor uuid; content text; event_kind public.notification_kind; begin
  if TG_TABLE_NAME = 'pins' then target_space := new.space_id; actor := new.author_id; content := '새 핀: ' || new.title; event_kind := 'pin';
  elsif TG_TABLE_NAME = 'messages' then target_space := new.space_id; actor := new.author_id; content := '새 채팅: ' || left(new.body, 80); event_kind := 'message';
  elsif TG_TABLE_NAME = 'pin_comments' then select space_id into target_space from public.pins where id = new.pin_id; actor := new.author_id; content := '새 댓글: ' || left(new.body, 80); event_kind := 'comment';
  else target_space := new.space_id; actor := new.updated_by; content := '공유 경로가 변경되었습니다.'; event_kind := 'route';
  end if;
  insert into public.notifications(user_id, space_id, kind, body)
  select user_id, target_space, event_kind, content from public.space_members where space_id = target_space and user_id <> actor;
  return new;
end; $$;
create trigger pins_notify after insert on public.pins for each row execute procedure public.notify_space_members();
create trigger messages_notify after insert on public.messages for each row execute procedure public.notify_space_members();
create trigger comments_notify after insert on public.pin_comments for each row execute procedure public.notify_space_members();
create trigger routes_notify after insert or update on public.space_routes for each row execute procedure public.notify_space_members();

alter publication supabase_realtime add table public.pin_comments, public.space_routes, public.route_stops, public.notifications;
