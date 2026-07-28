# 배포 업데이트 알림 규칙

Cloudflare Worker의 새 배포 버전은 자동으로 업데이트 알림을 한 번 생성한다.

1. 배포 전 `webapp/wrangler.jsonc`의 `RELEASE_ANNOUNCEMENT`를 이번 변경 내용으로 갱신한다.
2. `webapp` 폴더에서 `npx.cmd wrangler deploy`를 실행한다.
3. Worker cron이 최대 1분 안에 현재 버전 ID를 확인한다.
4. 같은 버전의 알림이 없으면 시스템 알림·업데이트를 켠 사용자에게만 푸시한다.

알림 제목은 `핀투게더 · 업데이트`이며, 목록에는 배포 식별 정보 없이 변경 내용만 표시한다. 동일 문구여도 배포 버전이 다르면 새 알림을 만든다.
