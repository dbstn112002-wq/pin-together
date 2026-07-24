# 핀투게더 현재 상태

최종 점검: 2026-07-24 KST

## 운영 주소

- 웹사이트: `https://pintogether-photo.com`
- 사진 서버: `https://phoths.pintogether-photo.com`
- GitHub: `https://github.com/dbstn112002-wq/pin-together`
- Cloudflare Worker: `dry-butterfly-8a6f`

웹사이트는 Cloudflare Workers Static Assets로 배포한다. 배포 명령은 다음과 같다.

```powershell
cd "C:\Users\yunsu\Desktop\실시간지도공유\webapp"
npx.cmd wrangler deploy
```

`pintogether-photo.com`은 Worker Custom Domain이며, `phoths.pintogether-photo.com`은 개인 PC의 사진 서버용 Cloudflare Tunnel 주소다. 둘은 서로 다른 용도이므로 유지한다.

## 사진 기능

- 댓글마다 최대 5장의 사진을 첨부할 수 있다.
- 사진은 `Pic/` 아래에만 저장되며 Git에 포함되지 않는다.
- 사진첩에는 현재 여행 공간의 댓글 사진이 보이고, 태그·원래 핀·댓글 위치를 확인할 수 있다.
- 사진 삭제 권한은 업로더와 공간 소유자에게 있다.
- 사진 파일에는 EXIF 촬영 시각·GPS 정보를 향후 활용할 수 있도록 로컬 인덱스에 보관한다.
- 사진 서버는 새 웹 도메인 `https://pintogether-photo.com`의 CORS 요청을 허용하도록 설정돼 있다.

사진 서버는 `photo-server/start-photo-server.ps1`로 실행한다. PC 또는 Cloudflare Tunnel이 꺼져 있으면 사진만 보이지 않고 지도·댓글 등 나머지 기능은 동작한다.

## 현재 구현된 주요 기능

- 초대 기반 여행 공간, 핀, 태그, 즐겨찾기, 경로, 채팅
- 댓글 및 댓글 사진, 읽지 않은 댓글 표시, 알림
- 모바일 핀 목록 닫기, 사진 전체보기·확대, 전체보기 뒤로가기 처리
- 프로필에서 로그아웃, 페이지 이탈 확인
- 알림 최신순 표시와 개별·전체 삭제 UI

## Supabase SQL 확인 필요

아래 SQL은 Supabase Dashboard의 **SQL Editor**에서 실행 여부를 확인해야 한다. 이미 실행했다면 다시 실행하지 말고, 실행하지 않은 파일만 실행한다.

1. `supabase/pin-comment-reads-migration.sql`
   - 핀별 읽지 않은 댓글 표시를 저장한다.
2. `supabase/notifications-delete-migration.sql`
   - 알림 개별 삭제와 전체 삭제 권한을 추가한다.
3. `supabase/realtime-reliability-migration.sql`
   - 핀·채팅·알림 등의 실시간 갱신 안정성을 보강한다.
4. `supabase/activity-notifications-migration.sql`
   - 핀·댓글·채팅·경로 활동 알림을 만든다.

`schema.sql` 및 `collaboration-migration.sql`은 기존 기능의 기반 파일이다. 이미 운영 중인 DB에서 다시 전체 실행하면 중복 정의 충돌 가능성이 있으므로, 처음 구축할 때만 사용한다.

## 마스터 계정 상태

- 앱은 `Master1`부터 `Master5` 입력을 각각 `master1@example.com`부터 `master5@example.com` 로그인으로 연결한다.
- `Master1`은 현재 로그인 가능하다.
- `Master2`~`Master5`는 Supabase Authentication의 Users에서 실제 계정으로 만들어져야 한다.
- 생성 시 이메일은 `master2@example.com` 등, 비밀번호는 `Master1`, **Auto Confirm User**는 켠다. `example.com`은 메일을 받을 수 없으므로 자동 확인이 필요하다.

사용자 활동의 작성자 ID(`author_id`, `created_by`, `user_id`)는 닉네임과 별개인 Supabase UUID로 저장된다. 따라서 닉네임을 바꿔도 핀·댓글·채팅 등의 작성 계정은 식별할 수 있다. 다만 삭제된 항목까지 별도의 관리자 감사 기록으로 보존하는 기능은 아직 없다.

## Git에 올릴 범위

커밋에는 웹앱 변경, 사진 서버 코드·실행 문서, Supabase SQL, 이 문서를 포함한다.

포함하지 않는 항목:

- `Pic/` 사진 파일과 로컬 사진 인덱스
- `photo-server/.venv/`, `.env`
- 개인 메모·스크린샷 폴더(`문제들/`, 별도 `.txt` 파일)
