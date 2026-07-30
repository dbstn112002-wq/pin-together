-- Supabase SQL Editor에서 이 파일 전체를 실행하세요. 여러 번 실행해도 안전합니다.
create extension if not exists pg_net;

alter table public.notifications add column if not exists push_claimed_at timestamptz;
create index if not exists notifications_pending_push_claim_idx
  on public.notifications (created_at)
  where push_sent_at is null;

-- 공지는 어떤 기기·구버전 화면에서도 개별 또는 전체 삭제할 수 없습니다.
drop policy if exists "users delete own notifications" on public.notifications;
drop policy if exists "users delete own non-announcement notifications" on public.notifications;
create policy "users delete own non-announcement notifications"
  on public.notifications for delete to authenticated
  using (user_id = auth.uid() and body not like '공지: %' and body not like '[공지]%');

create or replace function public.request_immediate_push()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://pintogether-photo.com/internal/immediate-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('notification_id', new.id),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists notifications_immediate_push on public.notifications;
create trigger notifications_immediate_push
after insert on public.notifications
for each row execute function public.request_immediate_push();

do $$
begin
  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'notification_kind') then
    alter type public.notification_kind add value if not exists 'reaction';
  end if;
end;
$$;

-- 기존 알림도 행동 대상이 드러나도록 문구를 보완합니다.
create or replace function public.notify_space_members()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  target_space uuid;
  target_pin uuid;
  actor uuid;
  content text;
  event_kind text;
  actor_name text;
  pin_title text;
begin
  if TG_TABLE_NAME = 'pins' then
    if TG_OP = 'DELETE' then
      target_space := old.space_id; actor := old.author_id;
      content := old.title;
    else
      target_space := new.space_id; target_pin := new.id; actor := new.author_id;
      if TG_OP = 'INSERT' then content := new.title;
      elsif new.title is distinct from old.title or new.note is distinct from old.note or new.color is distinct from old.color or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude then content := new.title;
      else return new;
      end if;
    end if;
    event_kind := 'pin';
  elsif TG_TABLE_NAME = 'pin_comments' then
    select space_id, title into target_space, pin_title from public.pins where id = new.pin_id;
    target_pin := new.pin_id; actor := new.author_id; event_kind := 'comment';
    content := '「' || coalesce(pin_title, '핀') || '」에 ' || left(new.body, 80);
  elsif TG_TABLE_NAME = 'messages' then
    target_space := new.space_id; actor := new.author_id; event_kind := 'message';
    content := left(new.body, 80);
  elsif TG_TABLE_NAME = 'space_routes' then
    if TG_OP = 'DELETE' then target_space := old.space_id; actor := old.updated_by; content := old.name;
    elsif TG_OP = 'INSERT' then target_space := new.space_id; actor := new.updated_by; content := new.name;
    else target_space := new.space_id; actor := new.updated_by; content := new.name;
    end if;
    event_kind := 'route';
  else
    target_space := new.space_id; actor := new.user_id; event_kind := 'member'; content := '여행 공간에 참가했습니다.';
  end if;
  select nickname into actor_name from public.profiles where id = actor;
  content := coalesce(actor_name, '참여자') || ': ' || content;
  insert into public.notifications(user_id, space_id, kind, body, pin_id)
  select user_id, target_space, event_kind, content, target_pin
  from public.space_members where space_id = target_space and user_id <> actor;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.notify_pin_reaction()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  pin_owner uuid;
  target_space uuid;
  pin_title text;
  actor_name text;
  reaction_name text;
begin
  select author_id, space_id, title into pin_owner, target_space, pin_title
  from public.pins where id = new.pin_id;
  if pin_owner is null or pin_owner = new.user_id then return new; end if;
  select nickname into actor_name from public.profiles where id = new.user_id;
  reaction_name := case new.kind when 'like' then '좋아요' when 'neutral' then '보통' when 'dislike' then '싫어요' else '반응' end;
  insert into public.notifications (user_id, space_id, kind, body, pin_id)
  values (pin_owner, target_space, 'reaction', coalesce(actor_name, '참여자') || ': 「' || coalesce(pin_title, '핀') || '」에 ' || reaction_name || '를 눌렀습니다.', new.pin_id);
  return new;
end;
$$;

drop trigger if exists pin_reactions_notify on public.pin_reactions;
create trigger pin_reactions_notify
after insert or update on public.pin_reactions
for each row execute function public.notify_pin_reaction();
