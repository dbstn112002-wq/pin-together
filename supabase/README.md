# Supabase SQL 실행 안내

이 폴더의 SQL은 한 번에 전부 실행하는 방식이 아닙니다. 같은 테이블의 초기 버전과 최신 버전이 함께 남아 있으므로, 아래 순서만 기준으로 사용합니다.

## 현재 운영 DB를 업데이트할 때

Supabase Dashboard의 **SQL Editor**에서 아래 파일을 순서대로 실행합니다.

1. `collaboration-migration.sql`
2. `pin-author-snapshot-migration.sql`
3. `pin-comment-reads-migration.sql`
4. `realtime-reliability-migration.sql`
5. `activity-notifications-migration.sql`
6. `notifications-delete-migration.sql`
7. `pin-comment-management-migration.sql`
8. `pin-reactions-migration.sql`
9. `last-active-space-migration.sql`
10. `notification-pin-link-migration.sql`
11. `member-removal-migration.sql`
12. `unique-nickname-migration.sql`
13. `shared-favorites-migration.sql`

`collaboration-migration.sql`은 현재의 핀 댓글, 경로, 채팅, 알림, 공간 멤버 구조를 만드는 기준 파일입니다. 정책과 트리거를 교체하는 구문이 있으므로, 데이터가 사라지지는 않지만 위 순서 이외의 구버전 파일과 섞어 실행하지 않습니다.

`message-reads-realtime-migration.sql`은 4번의 일부와 겹칩니다. 새로 실행할 필요가 없으며, 과거에 별도로 적용했던 기록용 파일로만 보관합니다.

## 새 Supabase 프로젝트를 처음 만들 때

빈 프로젝트일 때만 아래 순서로 실행합니다.

1. `schema.sql`
2. 위의 “현재 운영 DB를 업데이트할 때” 1~6번

이미 운영 중인 DB에는 `schema.sql`을 다시 실행하지 않습니다.

## 실행하지 않는 구버전 파일

아래 파일은 이전 구조를 남겨 둔 참고용입니다. 현재 DB에 실행하면 `space_routes`, `route_stops`, 알림, 정책 또는 제약조건이 현재 구조와 충돌할 수 있습니다.

- `features-migration.sql`
- `comments-migration.sql`
- `space-delete-migration.sql`
- `message-reads-realtime-migration.sql` (현재 기준으로는 중복)

특히 `features-migration.sql`은 현재와 다른 `space_routes`·`route_stops` 구조를 만들기 때문에 절대 실행하지 않습니다.

## 실행 후 확인

SQL Editor에서 오류 없이 완료되면 아래 조회로 핵심 테이블이 있는지 확인할 수 있습니다.

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'pin_comments', 'space_routes', 'route_stops', 'messages',
    'message_reads', 'notifications', 'pin_comment_reads'
  )
order by table_name;
```

오류가 난 경우에는 다른 SQL을 이어서 실행하지 말고, 오류 문구와 함께 확인합니다. 이미 일부만 적용된 DB에 임의로 구버전 SQL을 추가 실행하면 실제 DB 구조와 Git 기준이 다시 어긋날 수 있습니다.
