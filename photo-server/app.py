"""Pin Together local photo server.

Photo files and private EXIF metadata stay under ../Pic and never enter Git.
Every API call validates the caller's Supabase access token and space membership.
"""

from __future__ import annotations

import io
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import Body, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi import FastAPI
from PIL import ExifTags, Image
from pillow_heif import register_heif_opener

register_heif_opener()

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = PROJECT_ROOT / "Pic"
DATABASE_PATH = STORAGE_ROOT / "photo-index.sqlite3"
MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "image/heic": ".jpg", "image/heif": ".jpg",
}
ALLOWED_SOURCE_TYPES = {"comment", "pin", "route", "message"}
GPS_INFO = next(key for key, value in ExifTags.TAGS.items() if value == "GPSInfo")


def read_web_config() -> tuple[str, str]:
    text = (PROJECT_ROOT / "webapp" / "config.js").read_text(encoding="utf-8")
    url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", text)
    key = re.search(r"SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'", text)
    if not url or not key or url.group(1).startswith("YOUR_") or key.group(1).startswith("YOUR_"):
        raise RuntimeError("webapp/config.js needs a Supabase URL and publishable key.")
    return url.group(1).rstrip("/"), key.group(1)


SUPABASE_REST_URL, SUPABASE_KEY = read_web_config()
SUPABASE_ROOT_URL = re.sub(r"/rest/v1$", "", SUPABASE_REST_URL)
APP_ORIGINS = [
    "https://dry-butterfly-8a6f.ponr011.workers.dev",
    "https://pintogether-photo.com",
    "http://localhost:4173", "http://127.0.0.1:4173",
]
APP_ORIGINS.extend(origin.strip() for origin in os.getenv("PHOTO_ALLOWED_ORIGINS", "").split(",") if origin.strip())

app = FastAPI(title="Pin Together Photo Server", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=APP_ORIGINS, allow_credentials=False,
                   allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
                   allow_headers=["Authorization", "Content-Type"])


def connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_column(conn: sqlite3.Connection, name: str, definition: str) -> None:
    columns = {row[1] for row in conn.execute("pragma table_info(photos)")}
    if name not in columns:
        conn.execute(f"alter table photos add column {name} {definition}")


def initialize_storage() -> None:
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    with connection() as conn:
        conn.execute("""create table if not exists photos (
            id text primary key, space_id text not null, filename text not null,
            content_type text not null, byte_size integer not null, created_at text not null
        )""")
        ensure_column(conn, "source_type", "text not null default 'comment'")
        ensure_column(conn, "source_id", "text not null default ''")
        ensure_column(conn, "uploaded_by", "text not null default ''")
        ensure_column(conn, "tags_json", "text not null default '[]'")
        ensure_column(conn, "latitude", "real")
        ensure_column(conn, "longitude", "real")
        ensure_column(conn, "captured_at", "text")
        conn.execute("create index if not exists photos_space_created_idx on photos(space_id, created_at desc)")


def rational(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(value[0]) / float(value[1])


def gps_coordinate(values: Any, reference: Any) -> float | None:
    if not values or len(values) != 3:
        return None
    coordinate = rational(values[0]) + rational(values[1]) / 60 + rational(values[2]) / 3600
    direction = reference.decode() if isinstance(reference, bytes) else str(reference or "")
    return -coordinate if direction.upper() in {"S", "W"} else coordinate


def image_metadata(content: bytes) -> tuple[float | None, float | None, str | None, Image.Image | None]:
    try:
        image = Image.open(io.BytesIO(content))
        exif = image.getexif()
        gps = exif.get_ifd(GPS_INFO) if GPS_INFO in exif else {}
        latitude = gps_coordinate(gps.get(2), gps.get(1))
        longitude = gps_coordinate(gps.get(4), gps.get(3))
        captured = exif.get(36867) or exif.get(306)
        if isinstance(captured, bytes):
            captured = captured.decode(errors="ignore")
        return latitude, longitude, str(captured) if captured else None, image
    except Exception:
        return None, None, None, None


def normalize_tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise HTTPException(400, "태그 형식이 올바르지 않습니다.")
    tags = []
    for tag in value:
        cleaned = str(tag).strip().replace("#", "").replace("\n", " ")
        cleaned = re.sub(r"\s+", " ", cleaned)
        if cleaned and cleaned not in tags:
            tags.append(cleaned[:30])
    return tags[:10]


async def require_space_member(authorization: str | None, space_id: str) -> tuple[str, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "로그인이 필요합니다.")
    headers = {"apikey": SUPABASE_KEY, "Authorization": authorization}
    async with httpx.AsyncClient(timeout=10) as client:
        user_response = await client.get(f"{SUPABASE_ROOT_URL}/auth/v1/user", headers=headers)
        if user_response.status_code != 200:
            raise HTTPException(401, "로그인 세션이 만료되었습니다.")
        user_id = user_response.json().get("id")
        member_response = await client.get(f"{SUPABASE_REST_URL}/space_members", headers=headers, params={
            "select": "role", "space_id": f"eq.{space_id}", "user_id": f"eq.{user_id}",
        })
        rows = member_response.json() if member_response.status_code == 200 else []
        if not rows:
            raise HTTPException(403, "이 여행 공간의 사진에 접근할 권한이 없습니다.")
    return user_id, rows[0]["role"]


def record_to_public(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "source_type": row["source_type"], "source_id": row["source_id"],
        "uploaded_by": row["uploaded_by"], "tags": json.loads(row["tags_json"] or "[]"),
        "byte_size": row["byte_size"], "created_at": row["created_at"],
    }


@app.on_event("startup")
def startup() -> None:
    initialize_storage()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "storage": str(STORAGE_ROOT)}


@app.post("/photos")
async def upload_photo(
    space_id: str = Form(...), source_type: str = Form(...), source_id: str = Form(...), tags: str = Form("[]"),
    file: UploadFile = File(...), authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id, _ = await require_space_member(authorization, space_id)
    if source_type not in ALLOWED_SOURCE_TYPES or not source_id:
        raise HTTPException(400, "사진 연결 정보가 올바르지 않습니다.")
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(415, "JPG, PNG, WEBP, GIF, HEIC 사진만 올릴 수 있습니다.")
    content = await file.read(MAX_FILE_SIZE + 1)
    if not content or len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "사진은 10MB 이하만 올릴 수 있습니다.")
    latitude, longitude, captured_at, image = image_metadata(content)
    content_type = file.content_type
    extension = ALLOWED_CONTENT_TYPES[content_type]
    if content_type in {"image/heic", "image/heif"}:
        if image is None:
            raise HTTPException(415, "HEIC 사진을 읽지 못했습니다.")
        output = io.BytesIO()
        image.convert("RGB").save(output, format="JPEG", quality=90, optimize=True)
        content, content_type, extension = output.getvalue(), "image/jpeg", ".jpg"
    try:
        photo_tags = normalize_tags(json.loads(tags))
    except json.JSONDecodeError:
        raise HTTPException(400, "사진 태그 형식이 올바르지 않습니다.")
    photo_id = str(uuid.uuid4())
    filename = f"{photo_id}{extension}"
    target_dir = STORAGE_ROOT / space_id
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / filename).write_bytes(content)
    created_at = datetime.now(timezone.utc).isoformat()
    with connection() as conn:
        conn.execute("""insert into photos
            (id, space_id, filename, content_type, byte_size, created_at, source_type, source_id, uploaded_by, tags_json, latitude, longitude, captured_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (photo_id, space_id, filename, content_type, len(content), created_at, source_type, source_id, user_id, json.dumps(photo_tags, ensure_ascii=False), latitude, longitude, captured_at))
    return {"id": photo_id, "source_type": source_type, "source_id": source_id, "tags": photo_tags, "byte_size": len(content), "created_at": created_at}


@app.get("/spaces/{space_id}/photos")
async def list_space_photos(space_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    await require_space_member(authorization, space_id)
    with connection() as conn:
        rows = conn.execute("select * from photos where space_id = ? order by created_at desc", (space_id,)).fetchall()
    return {"items": [record_to_public(row) for row in rows]}


@app.get("/photos/{photo_id}")
async def get_photo(photo_id: str, authorization: str | None = Header(default=None)) -> FileResponse:
    with connection() as conn:
        row = conn.execute("select * from photos where id = ?", (photo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "사진을 찾을 수 없습니다.")
    await require_space_member(authorization, row["space_id"])
    path = STORAGE_ROOT / row["space_id"] / row["filename"]
    if not path.is_file():
        raise HTTPException(404, "사진 파일을 찾을 수 없습니다.")
    return FileResponse(path, media_type=row["content_type"], filename=row["filename"])


@app.patch("/photos/{photo_id}")
async def update_photo(photo_id: str, payload: dict[str, Any] = Body(...), authorization: str | None = Header(default=None)) -> dict[str, Any]:
    with connection() as conn:
        row = conn.execute("select * from photos where id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "사진을 찾을 수 없습니다.")
        user_id, role = await require_space_member(authorization, row["space_id"])
        if row["uploaded_by"] != user_id and role != "owner":
            raise HTTPException(403, "사진 태그를 수정할 권한이 없습니다.")
        tags = normalize_tags(payload.get("tags", []))
        conn.execute("update photos set tags_json = ? where id = ?", (json.dumps(tags, ensure_ascii=False), photo_id))
        updated = conn.execute("select * from photos where id = ?", (photo_id,)).fetchone()
    return record_to_public(updated)


@app.delete("/photos/{photo_id}")
async def delete_photo(photo_id: str, authorization: str | None = Header(default=None)) -> dict[str, bool]:
    with connection() as conn:
        row = conn.execute("select * from photos where id = ?", (photo_id,)).fetchone()
        if not row:
            return {"deleted": True}
        user_id, role = await require_space_member(authorization, row["space_id"])
        if row["uploaded_by"] != user_id and role != "owner":
            raise HTTPException(403, "사진을 삭제할 권한이 없습니다.")
        conn.execute("delete from photos where id = ?", (photo_id,))
    path = STORAGE_ROOT / row["space_id"] / row["filename"]
    path.unlink(missing_ok=True)
    return {"deleted": True}
