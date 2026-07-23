# 핀투게더 — 다음 세션 인수인계

최종 갱신: 2026-07-23 KST

## 서비스 목적

초대받은 사람만 가입·접속해 여행/모임별 지도 공간에서 핀, 메모, 채팅, 즐겨찾기, 직선거리와 경로를 함께 보는 웹서비스다.

## 현재 공개 사이트

- 공개 URL: `https://dry-butterfly-8a6f.ponr011.workers.dev`
- 호스팅: Cloudflare Workers Static Assets (무료)
- 데이터·로그인·실시간: Supabase (무료)
- 지도: Leaflet + OpenStreetMap
- 공개 주소는 외부 네트워크·휴대폰에서도 접속 가능하다.

## 폴더 구조

| 경로 | 설명 |
| --- | --- |
| `webapp/index.html` | 실제 웹 화면 |
| `webapp/app.css` | 반응형 PC/모바일 스타일 |
| `webapp/app.js` | Supabase 로그인, 지도, 핀, 채팅 등의 로직 |
| `webapp/config.js` | Supabase Project URL과 publishable key. 비밀키는 절대 넣지 않는다. |
| `webapp/wrangler.jsonc` | Cloudflare Worker 배포 설정. Worker 이름은 `dry-butterfly-8a6f` |
| `webapp/server.mjs` | 로컬 개발 서버 |
| `supabase/schema.sql` | 최초 DB 테이블·RLS·초대·실시간 설정 |
| `supabase/comments-migration.sql` | 텍스트 핀 댓글 기능 SQL |
| `supabase/space-delete-migration.sql` | 공간 삭제 권한·공간 이름 중복 방지 SQL |
| `SETUP.md` | Supabase 연결 기본 안내 |
| `WORKLOG.md` | 초기 작업 기록 |
| `FEATURES.md` | 사진/링크/태그/실제 도로 경로 설계 메모 |

## 구현된 기능

- 이메일·비밀번호 로그인과 회원가입, 닉네임
- 여행 공간 생성, 초대 코드 생성·참가, 전체 지도
- 공간별 핀 추가, 제목·메모·색상, 즐겨찾기
- 핀 두 개의 직선거리
- 핀을 순서대로 연결하는 경로(현재 브라우저 자동 저장)
- 공간별 실시간 채팅
- 현재 위치 권한 요청
- OpenStreetMap 장소 검색
- 모바일 핀 목록 버튼(`☰ 핀 목록`)과 작은 모바일 UI
- 외부 공개 Cloudflare 배포

## Supabase SQL 실행 상태

1. `schema.sql`: 사용자가 실행한 것으로 전제한다. 로그인·기본 핀·채팅이 이 SQL에 의존한다.
2. `comments-migration.sql`: 핀 댓글을 사용하려면 별도로 실행해야 한다.
3. `space-delete-migration.sql`: 공간 삭제와 같은 이름 중복 방지를 사용하려면 별도로 실행해야 한다.

위 두 추가 SQL은 Supabase Dashboard > SQL Editor에서 파일 내용을 전부 붙여 넣고 Run 한다.

## 배포 방법

현재 자동 배포는 설정되지 않았다. `webapp` 파일을 수정한 뒤 아래 명령으로 수동 배포한다.

```powershell
cd "$env:USERPROFILE\Desktop\실시간지도공유\webapp"
npx.cmd wrangler deploy
```

Cloudflare Wrangler 로그인은 이 PC에서 완료되어 있다. Cloudflare 계정은 `ponr011@naver.com` 계정으로 로그인된 상태였다.

## 로컬 실행 방법

```powershell
cd "$env:USERPROFILE\Desktop\실시간지도공유\webapp"
node server.mjs
```

브라우저 주소: `http://localhost:4173`

## Supabase 인증에서 확인할 설정

외부 사이트에서 이메일 인증 후 돌아오게 하려면 Supabase Dashboard > Authentication > URL Configuration에 아래를 추가한다.

```text
https://dry-butterfly-8a6f.ponr011.workers.dev
```

`Site URL`과 `Redirect URLs`에 넣는다.

## 중요한 보안 규칙

- `webapp/config.js`에는 publishable key만 있어도 된다.
- `sb_secret_...` 또는 `service_role` 키는 절대 브라우저 코드, Cloudflare 정적 파일, GitHub에 넣지 않는다.
- 접근 제어는 Supabase RLS 정책이 담당한다.

## 현재 주의/알려진 상태

- 최근 수정 사항은 Cloudflare에 2026-07-23에 수동 재배포했다.
- 이전에 미실행 고급 기능의 `sort_order` 조회가 핀·채팅을 막는 문제가 있었고, 기본 생성일 정렬로 되돌려 해결했다.
- 사진·링크 첨부는 무료 플랜 용량을 고려해 구현하지 않았다.
- 경로의 DB 공유 저장, 핀 수정·삭제·정렬, 영구 알림은 `features-migration.sql`에 설계돼 있으나 아직 완전 연결·검증하지 않았다. 다음 세션에서 이 기능을 하나씩 연결하고 각 SQL을 실행한 뒤 검증한다.
- 지도 이동/확대 화면은 각자 독립이다. 핀·채팅·댓글·공유 경로 같은 데이터만 멤버 간 공유하는 것이 원래 요구사항이다.

## 다음 세션 우선 작업

1. `comments-migration.sql` 실행 여부 확인 후 핀 댓글 실사용 테스트
2. `space-delete-migration.sql` 실행 후 2단계 삭제와 중복 이름 생성 테스트
3. 핀 수정·삭제를 별도 UI로 개선하고 권한별 테스트
4. 공유 경로를 Supabase DB에 저장하도록 연결
5. Cloudflare 배포 후 모바일·외부 기기 테스트
6. 원하면 GitHub 연결로 자동 배포 설정

## 다음 세션 시작 문장

`바탕화면 실시간지도공유 폴더의 SESSION_HANDOFF.md를 읽고, 현재 공개 배포 상태를 유지하면서 다음 우선 작업부터 이어서 진행해줘.`
