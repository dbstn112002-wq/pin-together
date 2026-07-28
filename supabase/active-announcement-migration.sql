-- 알림창 상단에 고정할 최신 공지를 저장합니다.
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.

alter table public.notifications
  add column if not exists is_active_announcement boolean not null default false;

create index if not exists notifications_active_announcement_idx
  on public.notifications (is_active_announcement, created_at desc)
  where is_active_announcement = true;
