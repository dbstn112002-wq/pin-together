-- Supabase SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 안전합니다.
-- 핀에 선택형 카테고리 아이콘을 저장합니다. null은 기존 기본 핀 모양입니다.

alter table public.pins
  add column if not exists icon_key text;

alter table public.pins
  drop constraint if exists pins_icon_key_check;

alter table public.pins
  add constraint pins_icon_key_check
  check (icon_key is null or icon_key in ('restaurant','cafe','lodging','shopping','sightseeing','transport','reservation','other'));

create index if not exists pins_icon_key_idx
  on public.pins (space_id, icon_key)
  where icon_key is not null;
