-- Run once in the Supabase SQL Editor.
-- Atomically transfers ownership to an existing participant, then removes the current owner.

create or replace function public.transfer_space_ownership_and_leave(target_space_id uuid, next_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if next_owner_id = auth.uid() then
    raise exception '다른 참가자에게만 소유권을 넘길 수 있습니다.';
  end if;

  if not exists (
    select 1 from public.space_members
    where space_id = target_space_id and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception '현재 공간의 소유자만 소유권을 넘길 수 있습니다.';
  end if;

  if not exists (
    select 1 from public.space_members
    where space_id = target_space_id and user_id = next_owner_id
  ) then
    raise exception '선택한 참가자가 현재 공간에 없습니다.';
  end if;

  update public.space_members
    set role = 'owner'
    where space_id = target_space_id and user_id = next_owner_id;

  delete from public.space_members
    where space_id = target_space_id and user_id = auth.uid();
end;
$$;

grant execute on function public.transfer_space_ownership_and_leave(uuid, uuid) to authenticated;
