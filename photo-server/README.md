# Pin Together 사진 서버

사진은 `C:\Users\yunsu\Desktop\실시간지도공유\Pic`에 저장한다. 이 폴더와 SQLite 인덱스는 Git에 올리지 않는다.

## 실행

```powershell
cd "C:\Users\yunsu\Desktop\실시간지도공유\photo-server"
.\start-photo-server.ps1
```

서버는 `127.0.0.1:8788`에서 실행되며, Cloudflare Tunnel이 `https://phoths.pintogether-photo.com`으로 외부에 연결한다.

## 주의 사항

- 사진 서버가 꺼져 있으면 웹사이트에서는 사진만 보이지 않는다.
- 새 웹 도메인을 추가하면 `app.py`의 `APP_ORIGINS`에도 해당 `https://` 주소를 추가한 뒤 사진 서버를 재시작해야 한다.
- `.venv/`, `.env`, `Pic/`은 로컬 전용이다.
