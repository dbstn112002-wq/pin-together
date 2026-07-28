# 핀투게더

여행 공간을 초대 기반으로 공유하며 지도 핀, 일정, 채팅, 댓글, 사진, 경로와 알림을 함께 관리하는 PWA 웹앱입니다.

- 운영 사이트: https://pintogether-photo.com
- GitHub: https://github.com/dbstn112002-wq/pin-together
- 배포: Cloudflare Workers Static Assets
- 데이터·인증·Realtime: Supabase
- 지도: Leaflet + OpenStreetMap

## 주요 기능

- 여행 공간 생성·초대 코드 참가·소유권 이전·공간 나가기·30일 보관 삭제/복구
- 지도 핀, 메모, 태그, 색상, 배경 사진, 댓글·댓글 사진, 공통 즐겨찾기와 반응
- 핀 일정 날짜·시간 지정 및 남은 시간/지난 시간 표시
- 공유 경로, 실시간 채팅, 읽음 표시, 사용자 선택형 위치 공유
- PC·Android·iPhone 대응, 다크 모드, 홈 화면 설치(PWA), Web Push
- 활동 알림의 작성자 닉네임 표시, 공지와 시스템 업데이트 알림 수신 설정 분리
- 최신 공지 하나 고정, 이전 공지는 일반 알림 기록으로 보관
- 각 Cloudflare 배포 버전마다 업데이트 알림 자동 생성

## 빠른 실행

```powershell
cd "C:\Users\yunsu\Desktop\실시간지도공유\webapp"
node server.mjs
```

브라우저에서 `http://localhost:4173`을 엽니다. 운영 배포는 같은 폴더에서 `npx.cmd wrangler deploy`를 실행합니다.

## 프로젝트 구조

| 경로 | 설명 |
| --- | --- |
| `webapp/` | 실제 운영 웹앱·PWA·Cloudflare Worker |
| `supabase/` | 운영 DB 마이그레이션과 실행 순서 |
| `photo-server/` | 댓글·핀 배경 사진을 제공하는 로컬 사진 서버 |
| `Pic/` | 사진 저장 위치, Git 제외 |
| `CURRENT_STATUS.md` | 현재 운영 상태와 확인할 SQL |
| `SESSION_HANDOFF.md` | 다음 작업을 위한 인수인계 |

## 중요한 운영 안내

- Supabase `service_role`/secret key는 브라우저 코드나 Git에 넣지 않습니다.
- 운영 DB SQL은 [supabase/README.md](supabase/README.md)의 순서만 따릅니다.
- 개인 메모·캡처(`문제들/`, 별도 `.txt`)와 `Pic/` 사진은 커밋하지 않습니다.
- 사진 서버 또는 Cloudflare Tunnel이 꺼진 경우 사진만 보이지 않으며 나머지 기능은 동작합니다.

자세한 연결·실행 방법은 [SETUP.md](SETUP.md)를 확인하세요.
