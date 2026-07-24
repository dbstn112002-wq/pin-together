-- Run once in Supabase SQL Editor after collaboration-migration.sql.
-- Adds the 10 supported pin colors and enforces author-only pin management.

alter table public.profiles drop constraint if exists profiles_pin_color_check;
alter table public.profiles add constraint profiles_pin_color_check
  check (pin_color in ('coral','red','orange','amber','lime','green','teal','blue','purple','pink'));

alter table public.pins drop constraint if exists pins_color_check;
alter table public.pins add constraint pins_color_check
  check (color in ('coral','red','orange','amber','lime','green','teal','blue','purple','pink'));

drop policy if exists "authors or owners update pins" on public.pins;
drop policy if exists "authors update pins" on public.pins;
create policy "authors update pins" on public.pins
for update to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());

drop policy if exists "authors or owners delete pins" on public.pins;
drop policy if exists "authors delete pins" on public.pins;
create policy "authors delete pins" on public.pins
for delete to authenticated
using (author_id = auth.uid());

drop policy if exists "pin authors manage tags" on public.pin_tags;
create policy "pin authors manage tags" on public.pin_tags
for all to authenticated
using (exists (
  select 1 from public.pins p
  where p.id = pin_id and p.author_id = auth.uid()
))
with check (exists (
  select 1 from public.pins p
  where p.id = pin_id and p.author_id = auth.uid()
));

drop policy if exists "authors delete comments" on public.pin_comments;
drop policy if exists "authors or owners update comments" on public.pin_comments;
drop policy if exists "authors or owners delete comments" on public.pin_comments;
create policy "authors or owners update comments" on public.pin_comments
for update to authenticated
using (author_id = auth.uid() or exists (
  select 1 from public.pins p where p.id = pin_id and public.is_space_owner(p.space_id)
))
with check (author_id = auth.uid() or exists (
  select 1 from public.pins p where p.id = pin_id and public.is_space_owner(p.space_id)
));
create policy "authors or owners delete comments" on public.pin_comments
for delete to authenticated
using (author_id = auth.uid() or exists (
  select 1 from public.pins p where p.id = pin_id and public.is_space_owner(p.space_id)
));
