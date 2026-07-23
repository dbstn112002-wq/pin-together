-- 핀투게더: 핀 댓글 기능만 추가합니다.
-- 기존 schema.sql 실행 후, Supabase SQL Editor에서 이 파일 전체를 한 번 실행하세요.

create table if not exists public.pin_comments (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.pins(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists pin_comments_pin_idx on public.pin_comments(pin_id, created_at);
alter table public.pin_comments enable row level security;

create policy "members see pin comments" on public.pin_comments
for select to authenticated
using (exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));

create policy "members add pin comments" on public.pin_comments
for insert to authenticated
with check (author_id = auth.uid() and exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));

create policy "authors delete comments" on public.pin_comments
for delete to authenticated
using (author_id = auth.uid());

alter publication supabase_realtime add table public.pin_comments;
