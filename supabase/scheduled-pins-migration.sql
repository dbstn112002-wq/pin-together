-- 여행 일정이 있는 핀의 날짜·시간을 저장합니다.
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.

alter table public.pins
  add column if not exists scheduled_at timestamptz;

create index if not exists pins_scheduled_at_idx
  on public.pins (space_id, scheduled_at)
  where scheduled_at is not null;
