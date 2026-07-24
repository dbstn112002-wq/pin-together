$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

if (-not (Test-Path $python)) {
  throw '사진 서버 가상환경을 찾을 수 없습니다. photo-server 폴더에서 requirements 설치를 먼저 실행하세요.'
}

Set-Location $PSScriptRoot
& $python -m uvicorn app:app --host 127.0.0.1 --port 8788
