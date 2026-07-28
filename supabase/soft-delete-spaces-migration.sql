-- Run once in the Supabase SQL Editor.
-- Deleted spaces are retained for 30 days, then the Worker permanently removes them.

alter table public.spaces add column if not exists deleted_at timestamptz;
alter table public.spaces add column if not exists purge_at timestamptz;
create index if not exists spaces_purge_at_idx on public.spaces(purge_at) where deleted_at is not null;

create or replace function public.soft_delete_space(target_space_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_space_owner(target_space_id) then raise exception '공간 소유자만 삭제할 수 있습니다.'; end if;
  update public.spaces set deleted_at = now(), purge_at = now() + interval '30 days', updated_at = now()
  where id = target_space_id and deleted_at is null;
  if not found then raise exception '삭제할 수 없는 공간입니다.'; end if;
end;
$$;

create or replace function public.restore_deleted_space(target_space_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_space_owner(target_space_id) then raise exception '공간 소유자만 복구할 수 있습니다.'; end if;
  update public.spaces set deleted_at = null, purge_at = null, updated_at = now()
  where id = target_space_id and deleted_at is not null;
  if not found then raise exception '복구할 삭제 예정 공간이 없습니다.'; end if;
end;
$$;

-- Keep the owner_id in sync when ownership is transferred before leaving.
create or replace function public.transfer_space_ownership_and_leave(target_space_id uuid, next_owner_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or next_owner_id = auth.uid() then raise exception '다른 참가자에게만 소유권을 넘길 수 있습니다.'; end if;
  if not exists (select 1 from public.space_members where space_id = target_space_id and user_id = auth.uid() and role = 'owner') then raise exception '현재 공간의 소유자만 소유권을 넘길 수 있습니다.'; end if;
  if not exists (select 1 from public.space_members where space_id = target_space_id and user_id = next_owner_id) then raise exception '선택한 참가자가 현재 공간에 없습니다.'; end if;
  update public.space_members set role = 'owner' where space_id = target_space_id and user_id = next_owner_id;
  update public.spaces set owner_id = next_owner_id, updated_at = now() where id = target_space_id;
  delete from public.space_members where space_id = target_space_id and user_id = auth.uid();
end;
$$;

-- No new invitations can be accepted after a space is marked for deletion.
create or replace function public.accept_invitation(invite_code text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare invitation public.invitations;
begin
  select * into invitation from public.invitations where code = invite_code for update;
  if invitation.id is null then raise exception '유효하지 않은 초대 코드입니다.'; end if;
  if exists (select 1 from public.spaces where id = invitation.space_id and deleted_at is not null) then raise exception '삭제 예정 공간에는 참가할 수 없습니다.'; end if;
  if invitation.expires_at is not null and invitation.expires_at < now() then raise exception '만료된 초대 코드입니다.'; end if;
  if invitation.max_uses is not null and invitation.use_count >= invitation.max_uses then raise exception '사용 횟수가 초과되었습니다.'; end if;
  insert into public.space_members(space_id, user_id, role) values (invitation.space_id, auth.uid(), invitation.role) on conflict (space_id, user_id) do nothing;
  update public.invitations set use_count = use_count + 1 where id = invitation.id;
  return invitation.space_id;
end;
$$;

grant execute on function public.soft_delete_space(uuid), public.restore_deleted_space(uuid), public.transfer_space_ownership_and_leave(uuid,uuid), public.accept_invitation(text) to authenticated;

-- Use the sender nickname in new chat notifications.
create or replace function public.notify_space_members()
returns trigger language plpgsql security definer set search_path = public
as $$
declare target_space uuid; target_pin uuid; actor uuid; content text; event_kind text; actor_name text;
begin
  if TG_TABLE_NAME = 'pins' then
    if TG_OP = 'DELETE' then target_space := old.space_id; target_pin := null; actor := old.author_id; else target_space := new.space_id; target_pin := new.id; actor := new.author_id; end if;
    event_kind := 'pin';
    if TG_OP = 'INSERT' then content := '새 핀: ' || new.title;
    elsif TG_OP = 'DELETE' then content := '핀 삭제: ' || old.title;
    elsif new.title is distinct from old.title or new.note is distinct from old.note or new.color is distinct from old.color or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude then content := '핀 수정: ' || new.title;
    else return new; end if;
  elsif TG_TABLE_NAME = 'pin_comments' then
    select space_id into target_space from public.pins where id = new.pin_id; target_pin := new.pin_id; actor := new.author_id; event_kind := 'comment'; content := '새 댓글: ' || left(new.body, 80);
  elsif TG_TABLE_NAME = 'messages' then
    target_space := new.space_id; actor := new.author_id; event_kind := 'message';
    select nickname into actor_name from public.profiles where id = actor;
    content := coalesce(actor_name, '참여자') || ': ' || left(new.body, 80);
  elsif TG_TABLE_NAME = 'space_routes' then
    if TG_OP = 'DELETE' then target_space := old.space_id; actor := old.updated_by; else target_space := new.space_id; actor := new.updated_by; end if;
    event_kind := 'route'; content := case when TG_OP = 'INSERT' then '새 경로: ' || new.name when TG_OP = 'DELETE' then '경로 삭제: ' || old.name else '경로 변경: ' || new.name end;
  else
    target_space := new.space_id; actor := new.user_id; event_kind := 'member'; content := '새 멤버가 참가했습니다.';
  end if;
  insert into public.notifications(user_id, space_id, kind, body, pin_id)
  select user_id, target_space, event_kind, content, target_pin from public.space_members where space_id = target_space and user_id <> actor;
  if TG_OP = 'DELETE' then return old; end if; return new;
end;
$$;
