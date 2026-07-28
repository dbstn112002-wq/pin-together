# 핀투게더 인수인계

최종 갱신: 2026-07-28 KST

## 배포

- 운영 사이트: https://pintogether-photo.com
- Worker: `dry-butterfly-8a6f`
- 배포: `cd webapp; npx.cmd wrangler deploy`
- `version_metadata` 바인딩을 사용한다. 새 배포 버전은 cron에서 한 번만 시스템 업데이트 알림을 생성한다.
- 배포 안내 문구는 `webapp/wrangler.jsonc`의 `RELEASE_ANNOUNCEMENT`를 현재 변경 내용으로 갱신한다.

## 주요 파일

| 경로 | 역할 |
| --- | --- |
| `webapp/app.js` | 인증, 지도, 핀, 댓글, 채팅, 알림, PWA 화면 로직 |
| `webapp/worker.js` | Web Push, 전체 공지, 배포 업데이트 알림, 공간 영구 삭제 |
| `webapp/sw.js` | 푸시 클릭과 앱 화면 이동 |
| `webapp/wrangler.jsonc` | Worker·cron·배포 알림 문구 설정 |
| `supabase/README.md` | 운영 DB SQL 실행 기준 |

## 최근 반영 사항

- 핀 일정 날짜·시간 지정과 카운트다운
- 공지/시스템 업데이트 수신 설정 분리
- 최신 공지 한 건 고정, 새 공지 등록 시 이전 공지는 일반 알림으로 유지
- 활동 알림 본문에 작성자 닉네임 표시
- 배포 버전별 자동 업데이트 알림

## 다음 작업 전 확인

1. Supabase SQL Editor에서 미실행 최신 마이그레이션을 실행했는지 확인한다.
2. 두 계정으로 공지·시스템 알림 수신 설정과 푸시를 검증한다.
3. `RELEASE_ANNOUNCEMENT`를 배포 변경 내용에 맞게 갱신한 뒤 배포한다.

## 작업 공간 주의

개인 메모·스크린샷·`Pic/` 사진은 사용자 파일이다. 커밋·삭제하지 않는다.
