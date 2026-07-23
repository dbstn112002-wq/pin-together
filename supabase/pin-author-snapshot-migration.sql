-- Run once in the Supabase SQL Editor.
-- Keeps the display name of a pin's creator fixed at the time the pin is made.
alter table public.pins add column if not exists author_nickname text;

update public.pins p
set author_nickname = pr.nickname
from public.profiles pr
where p.author_id = pr.id and p.author_nickname is null;

create or replace function public.keep_pin_author_nickname()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    select nickname into new.author_nickname from public.profiles where id = new.author_id;
  else
    new.author_nickname := old.author_nickname;
  end if;
  return new;
end;
$$;

drop trigger if exists pins_keep_author_nickname on public.pins;
create trigger pins_keep_author_nickname
before insert or update on public.pins
for each row execute procedure public.keep_pin_author_nickname();
