-- 여행 공간 삭제 권한과 이름 중복 방지
-- Supabase SQL Editor에서 이 파일 전체를 한 번 실행하세요.

-- LEGACY — DO NOT RUN. Space deletion policies and the name constraint were consolidated into collaboration-migration.sql.
-- Use collaboration-migration.sql and the order in supabase/README.md instead.

create policy "owners delete spaces" on public.spaces
for delete to authenticated
using (public.is_space_owner(id));

alter table public.spaces
add constraint spaces_owner_name_unique unique (owner_id, name);
