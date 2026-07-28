-- 활동 알림 본문 앞에 행동한 사용자의 닉네임을 붙입니다.
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.

create or replace function public.notify_space_members()
returns trigger language plpgsql security definer set search_path = public
as $$
declare target_space uuid; target_pin uuid; actor uuid; content text; event_kind text; actor_name text;
begin
  if TG_TABLE_NAME = 'pins' then
    if TG_OP = 'DELETE' then target_space := old.space_id; target_pin := null; actor := old.author_id;
    else target_space := new.space_id; target_pin := new.id; actor := new.author_id; end if;
    event_kind := 'pin';
    if TG_OP = 'INSERT' then content := '새 핀: ' || new.title;
    elsif TG_OP = 'DELETE' then content := '핀 삭제: ' || old.title;
    elsif new.title is distinct from old.title or new.note is distinct from old.note or new.color is distinct from old.color or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude then content := '핀 수정: ' || new.title;
    else return new; end if;
  elsif TG_TABLE_NAME = 'pin_comments' then
    select space_id into target_space from public.pins where id = new.pin_id;
    target_pin := new.pin_id; actor := new.author_id; event_kind := 'comment'; content := left(new.body, 80);
  elsif TG_TABLE_NAME = 'messages' then
    target_space := new.space_id; actor := new.author_id; event_kind := 'message'; content := left(new.body, 80);
  elsif TG_TABLE_NAME = 'space_routes' then
    if TG_OP = 'DELETE' then target_space := old.space_id; actor := old.updated_by; else target_space := new.space_id; actor := new.updated_by; end if;
    event_kind := 'route'; content := case when TG_OP = 'INSERT' then '새 경로: ' || new.name when TG_OP = 'DELETE' then '경로 삭제: ' || old.name else '경로 변경: ' || new.name end;
  else
    target_space := new.space_id; actor := new.user_id; event_kind := 'member'; content := '여행 공간에 참가했습니다.';
  end if;
  select nickname into actor_name from public.profiles where id = actor;
  content := coalesce(actor_name, '참여자') || ': ' || content;
  insert into public.notifications(user_id, space_id, kind, body, pin_id)
  select user_id, target_space, event_kind, content, target_pin from public.space_members where space_id = target_space and user_id <> actor;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
