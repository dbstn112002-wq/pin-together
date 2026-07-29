# 다음 작업 세션 인수인계

## 프로젝트

- 경로: `C:\Users\yunsu\Desktop\실시간지도공유`
- 운영 사이트: `https://pintogether-photo.com`
- 프론트/Worker: `webapp/`
- DB: Supabase
- 배포: Cloudflare Worker `dry-butterfly-8a6f`

## 기본 명령

```powershell
cd C:\Users\yunsu\Desktop\실시간지도공유
node --check webapp\app.js
node --check webapp\worker.js
git diff --check
cd webapp
npx.cmd wrangler deploy
```

`npx.cmd wrangler deploy`는 사이트만 배포하며 시스템 업데이트 푸시는 보내지 않는다.

일반 푸시는 DB의 `immediate-push-migration.sql` 트리거로 즉시 전송한다. 이 트리거가 적용되지 않은 경우에도 Worker가 매분 미전송 알림을 재시도한다.

```powershell
npm.cmd run deploy:production
```

위 명령은 배포 후 현재 `RELEASE_ANNOUNCEMENT` 문구가 실제 Worker에 적용된 것을 확인하고 시스템 업데이트 푸시까지 보낸다. 업데이트 푸시가 필요할 때만 사용한다.

## 체크리스트 기능 상태

- 개인/공간 체크리스트, 항목, 체크 상태 SQL: `supabase/checklists-migration.sql`
- 사용 전 Supabase SQL Editor에서 위 파일 전체를 실행해야 한다.
- 메뉴 체크리스트 탭은 목록만 표시하며, 목록을 누르면 별도 상세창에서 항목을 관리한다.
- 개인·공간·핀 체크리스트 모두 항목 추가, 문구 수정, 삭제, 순서 변경, 개별·전체 체크를 지원한다.
- 핀 체크리스트 화면은 상단의 연결된 목록 관리와 하단의 개인·공간 원본 목록 가져오기를 분리한다. 핀에 복사한 목록을 삭제해도 원본은 유지된다.
- 핀 생성 시에도 기존 개인·공간 체크리스트를 여러 개 선택해 독립 복사할 수 있다.
- 체크리스트 알림 설정을 켠 참여자에게는 공간·핀 목록 생성·삭제·가져오기와 항목 추가·수정·삭제·체크/해제 알림을 보낸다. 개인 목록은 공간에 속하지 않아 알리지 않는다.
- 투표 알림 설정을 켠 현재 공간 참여자에게는 새 투표 생성 알림을 보내며, 투표 생성자만 상세창에서 투표를 삭제할 수 있다.
- 지도 핀 정보창은 댓글·체크리스트 핵심 버튼과 더보기 메뉴(즐겨찾기·투표·핀 편집), 최하단 반응 이모지 영역으로 구성된다.

## 다음 작업 전 확인

1. Supabase SQL Editor에서 `pin-icons-migration.sql`, `polls-migration.sql`, `checklists-migration.sql`을 실행했는지 확인한다.
2. 두 계정으로 공간 체크리스트 활동 알림과 새 투표 알림, 핀 체크리스트 복사와 항목 편집을 검증한다.
3. `RELEASE_ANNOUNCEMENT`를 배포 변경 내용에 맞게 갱신한 뒤 업데이트 푸시가 필요한 경우에만 `npm.cmd run deploy:production`을 사용한다.

## 주의

- 개인 메모·이미지 폴더와 별도 `.txt` 파일은 건드리지 않는다.
- 현재 변경사항은 아직 Git 커밋/푸시되지 않았을 수 있으므로 `git status --short`로 먼저 확인한다.
- 배포 시스템 알림 문구는 `webapp/wrangler.jsonc`의 `RELEASE_ANNOUNCEMENT`에서 변경한다.
