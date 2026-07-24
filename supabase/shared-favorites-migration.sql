-- Run once in the Supabase SQL Editor.
-- One shared favorite setting per pin, visible to every member of the space.

create table if not exists public.shared_favorite_pins (
  pin_id uuid primary key references public.pins(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  set_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.shared_favorite_pins(pin_id, space_id, set_by)
select distinct on (f.pin_id) f.pin_id, p.space_id, f.user_id
from public.favorite_pins f join public.pins p on p.id = f.pin_id
on conflict (pin_id) do nothing;

alter table public.shared_favorite_pins enable row level security;
drop policy if exists "members see shared favorites" on public.shared_favorite_pins;
create policy "members see shared favorites" on public.shared_favorite_pins
  for select to authenticated using (public.is_space_member(space_id));

create or replace function public.set_shared_pin_favorite(target_pin uuid, make_favorite boolean)
returns boolean language plpgsql security definer set search_path = public
as $$
declare target_space uuid;
begin
  select space_id into target_space from public.pins where id = target_pin;
  if target_space is null or not public.is_space_member(target_space) then
    raise exception '핀을 찾을 수 없거나 권한이 없습니다.';
  end if;
  if make_favorite then
    insert into public.shared_favorite_pins(pin_id, space_id, set_by)
    values (target_pin, target_space, auth.uid()) on conflict (pin_id) do nothing;
  else
    delete from public.shared_favorite_pins where pin_id = target_pin;
  end if;
  return make_favorite;
end;
$$;

grant execute on function public.set_shared_pin_favorite(uuid, boolean) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_favorite_pins') then
    alter publication supabase_realtime add table public.shared_favorite_pins;
  end if;
end $$;
