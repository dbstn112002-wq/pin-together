# 핀투게더 운영 연결 안내

이 문서는 현재 만들어진 실제 웹앱을 무료 기준으로 연결하고 실행하는 순서다.

## 1. Supabase 무료 프로젝트 만들기

1. [Supabase](https://supabase.com)에서 계정을 만들고 새 프로젝트를 만든다.
2. 프로젝트가 준비되면 `SQL Editor`에서 `supabase/schema.sql` 전체를 붙여 넣고 실행한다.
3. `Authentication > Providers`에서 Email을 켠다. 이메일 인증을 쓸 경우 `Authentication > URL Configuration`에 실제 웹사이트 주소를 추가한다.
4. `Project Settings > API`에서 Project URL과 publishable key(또는 anon key)를 확인한다.
5. `webapp/config.js`의 두 placeholder를 해당 값으로 교체한다.

절대로 `service_role` key를 `config.js`에 넣지 않는다. 이 키는 모든 권한 규칙을 우회하므로 서버 관리자만 보관해야 한다.

## 2. 내 컴퓨터에서 실행

PowerShell에서 다음을 실행한다.

```powershell
cd "$env:USERPROFILE\Desktop\실시간지도공유\webapp"
node server.mjs
```

브라우저에서 `http://localhost:4173`을 연다. 가입 후 `새 여행 공간`을 만들고 핀을 추가해 본다.

## 3. 무료 배포

이 앱은 정적 파일이므로 Cloudflare Pages, Netlify, GitHub Pages 등 정적 호스팅에 배포할 수 있다.

배포 전 주의사항:

- `webapp` 폴더의 파일을 배포한다.
- 배포 주소를 Supabase Authentication의 Redirect URL 목록에 추가한다.
- `config.js`의 publishable key는 브라우저에 있어도 되지만 service_role key는 절대 배포하지 않는다.
- OpenStreetMap 공개 타일과 Nominatim 검색은 소규모 개인 서비스에 적합하다. 사용자가 크게 늘면 타일·검색 제공자를 별도로 계약하거나 자체 호스팅한다.

## 4. 작동 확인 목록

- 회원가입 또는 로그인 후 닉네임이 보인다.
- 새 여행 공간을 만들면 해당 공간만의 핀과 채팅이 보인다.
- `전체 지도`에서는 접근 권한이 있는 모든 공간의 핀이 보인다.
- 공간 소유자가 초대 버튼으로 만든 링크로 다른 계정이 참여한다.
- 두 브라우저에서 핀과 채팅이 즉시 갱신된다.

## 문제 해결

- `config.js` 설정 화면이 보임: URL/key placeholder가 아직 남아 있다.
- 가입 이메일이 오지 않음: Supabase Authentication의 Email 설정과 스팸함을 확인한다.
- 초대·핀 저장이 거부됨: `schema.sql`을 빠짐없이 실행했는지와 로그인 상태를 확인한다.
- 지도가 안 보임: 인터넷 연결과 브라우저 개발자 도구의 네트워크 오류를 확인한다.
