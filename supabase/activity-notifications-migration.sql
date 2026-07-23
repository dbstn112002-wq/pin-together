-- Run once after collaboration-migration.sql in the Supabase SQL Editor.
-- Sends in-app notifications to other members for shared-space activity.
create or replace function public.notify_space_members()
returns trigger language plpgsql security definer set search_path = public
as $$
declare target_space uuid; actor uuid; content text; event_kind text;
begin
  if TG_TABLE_NAME = 'pins' then
    if TG_OP = 'DELETE' then target_space := old.space_id; actor := old.author_id;
    else target_space := new.space_id; actor := new.author_id;
    end if;
    event_kind := 'pin';
    if TG_OP = 'INSERT' then content := '새 핀: ' || new.title;
    elsif TG_OP = 'DELETE' then content := '핀 삭제: ' || old.title;
    elsif new.title is distinct from old.title or new.note is distinct from old.note or new.color is distinct from old.color or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude then content := '핀 수정: ' || new.title;
    else return new;
    end if;
  elsif TG_TABLE_NAME = 'messages' then
    target_space := new.space_id; actor := new.author_id; event_kind := 'message'; content := '새 채팅: ' || left(new.body, 80);
  elsif TG_TABLE_NAME = 'pin_comments' then
    select space_id into target_space from public.pins where id = new.pin_id;
    actor := new.author_id; event_kind := 'comment'; content := '새 댓글: ' || left(new.body, 80);
  elsif TG_TABLE_NAME = 'space_routes' then
    if TG_OP = 'DELETE' then target_space := old.space_id; actor := old.updated_by;
    else target_space := new.space_id; actor := new.updated_by;
    end if;
    event_kind := 'route';
    if TG_OP = 'INSERT' then content := '새 경로: ' || new.name;
    elsif TG_OP = 'DELETE' then content := '경로 삭제: ' || old.name;
    else content := '경로 수정: ' || new.name;
    end if;
  else
    target_space := new.space_id; actor := new.user_id; event_kind := 'message'; content := '새 멤버가 참가했습니다.';
  end if;
  insert into public.notifications(user_id, space_id, kind, body)
  select user_id, target_space, event_kind, content from public.space_members where space_id = target_space and user_id <> actor;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists pins_notify on public.pins;
drop trigger if exists messages_notify on public.messages;
drop trigger if exists comments_notify on public.pin_comments;
drop trigger if exists routes_notify on public.space_routes;
drop trigger if exists members_notify on public.space_members;
create trigger pins_notify after insert or update or delete on public.pins for each row execute procedure public.notify_space_members();
create trigger messages_notify after insert on public.messages for each row execute procedure public.notify_space_members();
create trigger comments_notify after insert on public.pin_comments for each row execute procedure public.notify_space_members();
create trigger routes_notify after insert or update or delete on public.space_routes for each row execute procedure public.notify_space_members();
create trigger members_notify after insert on public.space_members for each row execute procedure public.notify_space_members();
