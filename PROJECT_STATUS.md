# 핀투게더 프로젝트 현황

최종 업데이트: 2026-07-24 KST

## 운영 주소와 실행 상태

- 웹사이트: `https://pintogether-photo.com`
- 사진 서버: `https://phoths.pintogether-photo.com`
- GitHub: `https://github.com/dbstn112002-wq/pin-together`
- 배포 방식: Cloudflare Workers Static Assets
- 사진 저장 위치: `Pic/` (Git 제외)
- 로컬 사진 서버: `photo-server/app.py`, `127.0.0.1:8788`

사진 서버와 Cloudflare Tunnel이 실행 중이어야 댓글 사진과 핀 배경 사진이 보입니다. 서버가 꺼져 있으면 지도·댓글·채팅 등 나머지 기능은 계속 사용할 수 있습니다.

## 최근 구현 기능

- 핀 댓글 수·읽지 않은 댓글 표시, 댓글 편집·삭제
- 핀 이름·메모·태그·색상 편집 및 작성자 본인만 편집·삭제
- 핀 색상 10종
- 핀 반응: 좋아요(👍), 보통(😐), 싫어요(👎), 반응한 닉네임 표시
- 핀 클릭 말풍선 30초 유지 및 말풍선 안에서 반응·핀 편집
- 댓글 사진, 사진첩, 태그·원래 핀 위치 표시
- 핀 배경 사진: 핀 추가/편집에서 선택, 지도 말풍선과 댓글창 배경으로 사용
- 핀 배경 사진은 사진첩 탭에서 숨김
- 모바일 핀 목록 닫기, 전체화면 사진 뒤로가기 처리, 대화상자 자동 키보드 방지
- 모바일 지도 조작 버튼을 확대/축소 버튼 위로 정렬
- 기본 지도와 위성 지도 전환, 선택 지도 종류 저장
- 공간 참가자 탭, 초대 코드만 복사, 알림 개별·전체 삭제
- 사용자별 마지막 여행 공간 복원 (브라우저 저장 + DB 지원)
- Master1~Master5 로그인 식별자 및 닉네임 유지
- 핀 아이콘 분류, 공간 투표와 핀 연결, 개인·공간·핀 체크리스트 관리

## Supabase SQL 적용 상태

SQL 실행 기준은 `supabase/README.md`를 사용합니다. 아래 파일은 운영 DB에서 아직 실행하지 않았다면 **순서대로 한 번씩** 실행해야 합니다.

1. `supabase/collaboration-migration.sql`
2. `supabase/pin-author-snapshot-migration.sql`
3. `supabase/pin-comment-reads-migration.sql`
4. `supabase/realtime-reliability-migration.sql`
5. `supabase/activity-notifications-migration.sql`
6. `supabase/notifications-delete-migration.sql`
7. `supabase/pin-comment-management-migration.sql`
8. `supabase/pin-reactions-migration.sql`
9. `supabase/last-active-space-migration.sql`
10. `supabase/pin-icons-migration.sql`
11. `supabase/polls-migration.sql`
12. `supabase/checklists-migration.sql`

특히 7~9번은 핀 색상·편집 권한, 반응 버튼, 마지막 여행 공간 저장에 필요합니다. 구버전 파일인 `features-migration.sql`, `comments-migration.sql`, `space-delete-migration.sql`은 실행하지 않습니다.

## 아직 구현하지 않은 항목

- 휴대폰 푸시 알림(PWA Service Worker + Web Push)은 구현되어 있으며, 기기별 알림 권한과 수신 설정이 필요합니다.
- 실시간 위치 공유 채널은 서버 측 멤버 검증 강화가 필요합니다.
- Master2~Master5는 Supabase Authentication에 실제 계정을 만들어야 로그인할 수 있습니다.

## Git 제외 항목

- `Pic/` 및 사진 서버 DB
- `photo-server/.venv/`, `.env`
- 사용자 개인 메모·캡처 폴더
