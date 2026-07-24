-- Run once in the Supabase SQL Editor.
-- Makes nicknames globally unique, ignoring letter case.
-- If a requested nickname is already used, a number is appended automatically.

create or replace function public.make_unique_nickname()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  base_name text;
  candidate text;
  suffix integer := 1;
  suffix_text text;
begin
  base_name := left(trim(coalesce(new.nickname, '여행자')), 16);
  if char_length(base_name) < 2 then base_name := '여행자'; end if;
  candidate := base_name;

  while exists (
    select 1 from public.profiles
    where id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and lower(nickname) = lower(candidate)
  ) loop
    suffix := suffix + 1;
    suffix_text := suffix::text;
    candidate := left(base_name, 16 - char_length(suffix_text)) || suffix_text;
  end loop;

  new.nickname := candidate;
  return new;
end;
$$;

drop trigger if exists profiles_unique_nickname on public.profiles;
create trigger profiles_unique_nickname
  before insert or update of nickname on public.profiles
  for each row execute procedure public.make_unique_nickname();

-- Normalizes any existing duplicates before creating the unique index.
update public.profiles set nickname = nickname;

create unique index if not exists profiles_nickname_unique_idx
  on public.profiles (lower(nickname));
