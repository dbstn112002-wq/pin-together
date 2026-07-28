# 핀투게더 현재 상태

최종 점검: 2026-07-28 KST

## 운영 환경

- 웹사이트: `https://pintogether-photo.com`
- 사진 서버: `https://phoths.pintogether-photo.com`
- Cloudflare Worker: `dry-butterfly-8a6f`
- 배포 명령: `webapp` 폴더에서 `npx.cmd wrangler deploy`
- Worker cron: 매분 푸시 발송 대기열·배포 버전·삭제 예정 공간을 처리

## 현재 기능

- 공간·초대·참가자 권한, 소유권 이전, 공간 나가기, 30일 보관 삭제·복구
- 핀/태그/메모/색상/배경 사진, 댓글·사진·읽지 않음, 반응·공통 즐겨찾기
- 핀 일정과 카운트다운, 공유 경로, 채팅·읽음, 위치 공유, 다크 모드
- PWA 설치와 Web Push, 알림별 수신 설정
- 공지와 시스템 업데이트 수신 설정 분리, 최신 공지 한 건 고정
- 핀·댓글·채팅·경로 등 활동 알림에 작성자 닉네임 표시
- Cloudflare 배포 버전별 업데이트 알림 자동 생성

## Supabase SQL

운영 DB에는 [supabase/README.md](supabase/README.md)의 실행 순서만 사용한다. 최근 기능에 필요한 추가 SQL은 다음과 같다.

1. `scheduled-pins-migration.sql`
2. `active-announcement-migration.sql`
3. `announcement-preferences-migration.sql`
4. `actor-nickname-notifications-migration.sql`

이미 실행한 파일은 다시 실행하지 않는다. 오류가 발생하면 다음 SQL을 실행하지 말고 오류 문구를 확인한다.

## Git 제외

- `Pic/`, 사진 서버 DB·가상환경·환경 변수
- 개인 메모·캡처: `문제들/`, 별도 `.txt` 파일
