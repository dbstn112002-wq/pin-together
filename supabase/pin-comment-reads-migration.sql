-- 핀투게더: 사용자별 핀 댓글 읽음 상태
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.

create table if not exists public.pin_comment_reads (
  pin_id uuid not null references public.pins(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (pin_id, user_id)
);

create index if not exists pin_comment_reads_user_idx on public.pin_comment_reads(user_id, last_read_at desc);

alter table public.pin_comment_reads enable row level security;

drop policy if exists "users see own pin comment reads" on public.pin_comment_reads;
drop policy if exists "users add own pin comment reads" on public.pin_comment_reads;
drop policy if exists "users update own pin comment reads" on public.pin_comment_reads;

create policy "users see own pin comment reads" on public.pin_comment_reads
  for select to authenticated using (user_id = auth.uid());
create policy "users add own pin comment reads" on public.pin_comment_reads
  for insert to authenticated with check (user_id = auth.uid());
create policy "users update own pin comment reads" on public.pin_comment_reads
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
