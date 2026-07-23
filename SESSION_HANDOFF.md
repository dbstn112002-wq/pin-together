# 핀투게더 다음 세션 인수인계

최종 갱신: 2026-07-23 KST

## 배포와 저장소

- 공개 사이트: https://dry-butterfly-8a6f.ponr011.workers.dev
- Cloudflare Workers Static Assets 프로젝트: `dry-butterfly-8a6f`
- GitHub 비공개 저장소: https://github.com/dbstn112002-wq/pin-together
- 현재 Git 커밋 기준: `8de3002 Show pin author in map popup`
- 배포는 `webapp` 폴더에서 `npx.cmd wrangler deploy`로 수행한다.

## 주요 파일

| 경로 | 역할 |
| --- | --- |
| `webapp/index.html` | 웹 화면 구조 및 캐시 버전 쿼리 |
| `webapp/app.css` | PC/모바일/iPhone 반응형 UI |
| `webapp/app.js` | 로그인, 지도, 핀, 채팅, 경로, 위치 공유, Realtime |
| `webapp/config.js` | Supabase URL 및 publishable key |
| `webapp/wrangler.jsonc` | Cloudflare 배포 설정 |
| `supabase/schema.sql` | 최초 Supabase 스키마 |
| `supabase/collaboration-migration.sql` | 태그, 댓글, 경로, 읽음, 알림 기능 마이그레이션 |

## 구현 완료 기능

- 이메일 로그인/회원가입/비밀번호 재설정
- `Master1` 입력을 `master1@example.com` 내부 인증 계정으로 변환하는 마스터 로그인
  - 인증 서버에서 `Master1` / `Master1` 로그인 성공을 확인했다.
  - Master1 닉네임은 `sessionStorage`에 저장한다. 같은 탭 새로고침에는 다시 묻지 않고, 탭 종료 또는 로그아웃 후 재접속 시 다시 입력한다.
- 공간 생성, 초대, 참가, 공간 삭제, 핀/태그/메모/즐겨찾기/댓글
- 경로 지정 및 다른 멤버와 경로 공유
- 채팅, 읽음 표시, 알림 종 숫자 및 사이트 내부 토스트 알림
- 사용자 위치 공유: Supabase Presence + Broadcast 병행. 탭을 닫으면 공유가 사라진다.
- Realtime 연결이 불안정할 때 5초 주기의 안전 동기화로 채팅·핀·알림을 다시 맞춘다.
- 모바일/iPhone 레이아웃 및 채팅 입력/키보드/자동 하단 스크롤 보정
- 지도 핀 클릭 시 팝업 유지, 작성자 닉네임, 생성 시각, 즐겨찾기, `💬 댓글 보기` 표시
- 초대 링크로 참가한 뒤 URL의 `invite` 파라미터를 제거해 새로고침마다 참가창이 뜨지 않게 처리

## Supabase SQL 실행 상태

사용자가 실행 완료했다고 확인한 파일:

- `supabase/schema.sql`
- `supabase/collaboration-migration.sql`

다음 파일은 Supabase Dashboard → SQL Editor에서 실행이 필요하거나 실행 여부를 재확인해야 한다. 모두 중복 실행에 안전하도록 작성됐다.

1. `supabase/realtime-reliability-migration.sql`
   - 핀, 채팅, 읽음, 경로, 알림 테이블을 Realtime publication에 확실히 등록한다.
2. `supabase/pin-author-snapshot-migration.sql`
   - 핀 작성자 닉네임을 생성 시점 이름으로 고정한다.
   - 기존 핀도 실행 시점의 이름으로 채운다.
3. `supabase/message-reads-realtime-migration.sql`
   - 읽음 표시 즉시 반영을 보장한다.

## 다음 세션에서 우선 확인할 것

1. 위 SQL 3개 실행 여부를 확인하고, 실행 후 두 기기/두 계정으로 실시간 핀·채팅·알림을 검증한다.
2. 두 사용자가 반드시 같은 여행 공간에 참가한 상태에서 각각 `위치 공유 시작`과 브라우저 위치 권한 허용을 했는지 확인한다.
3. Master1을 여러 사람이 함께 쓸 경우, 핀/채팅/댓글 작성자 이름을 완전히 세션 닉네임 기준으로 저장할지 별도 설계가 필요하다. 현재 핀은 `pin-author-snapshot-migration.sql` 실행 후 DB 작성자 스냅샷으로 고정된다.
4. 새로고침 후 UI가 예전처럼 보이면 Cloudflare URL을 직접 열고 강력 새로고침/탭 재열기를 먼저 확인한다. `index.html`의 app.js/app.css 버전 쿼리를 올려 캐시를 피하고 있다.

## 로컬 실행

```powershell
cd "C:\Users\yunsu\Desktop\실시간지도공유\webapp"
node server.mjs
```

브라우저: `http://localhost:4173`

## 작업 공간 주의사항

- 루트에 추적되지 않은 개인 메모 텍스트 파일과 `해결1.png`가 있다. 사용자 파일이므로 커밋·삭제하지 않는다.
- `webapp/config.js`에는 publishable key만 있어야 하며, service role/secret key를 저장소나 프런트엔드에 넣지 않는다.
