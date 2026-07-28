-- 공지와 시스템 알림 수신 설정을 분리합니다.
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.

alter table public.notification_preferences
  add column if not exists announcement boolean not null default true;
