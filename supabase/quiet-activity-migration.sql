-- Supabase SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 안전합니다.
-- 조용히 활동하기를 켠 사용자의 일반 활동 알림 생성을 막습니다.

alter table public.notification_preferences
  add column if not exists quiet_mode boolean not null default false;

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
  actor_quiet boolean;
begin
  if TG_TABLE_NAME = 'pins' then
    if TG_OP = 'DELETE' then
      target_space := old.space_id; actor := old.author_id; content := old.title;
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
    target_space := new.space_id; actor := new.author_id; event_kind := 'message'; content := left(new.body, 80);
  elsif TG_TABLE_NAME = 'space_routes' then
    if TG_OP = 'DELETE' then target_space := old.space_id; actor := old.updated_by; content := old.name;
    elsif TG_OP = 'INSERT' then target_space := new.space_id; actor := new.updated_by; content := new.name;
    else target_space := new.space_id; actor := new.updated_by; content := new.name;
    end if;
    event_kind := 'route';
  else
    target_space := new.space_id; actor := new.user_id; event_kind := 'member'; content := '여행 공간에 참가했습니다.';
  end if;

  select quiet_mode into actor_quiet from public.notification_preferences where user_id = actor;
  if coalesce(actor_quiet, false) then
    if TG_OP = 'DELETE' then return old; end if;
    return new;
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
  actor_quiet boolean;
begin
  select author_id, space_id, title into pin_owner, target_space, pin_title from public.pins where id = new.pin_id;
  if pin_owner is null or pin_owner = new.user_id then return new; end if;
  select quiet_mode into actor_quiet from public.notification_preferences where user_id = new.user_id;
  if coalesce(actor_quiet, false) then return new; end if;
  select nickname into actor_name from public.profiles where id = new.user_id;
  reaction_name := case new.kind when 'like' then '좋아요' when 'neutral' then '보통' when 'dislike' then '싫어요' else '반응' end;
  insert into public.notifications (user_id, space_id, kind, body, pin_id)
  values (pin_owner, target_space, 'reaction', coalesce(actor_name, '참여자') || ': 「' || coalesce(pin_title, '핀') || '」에 ' || reaction_name || '를 눌렀습니다.', new.pin_id);
  return new;
end;
$$;
