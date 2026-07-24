-- Run once in Supabase SQL Editor.
-- Stores each user's last selected travel space so it can be restored after login.

alter table public.profiles
  add column if not exists last_space_id uuid references public.spaces(id) on delete set null;

create index if not exists profiles_last_space_idx on public.profiles(last_space_id)
  where last_space_id is not null;
