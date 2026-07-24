-- 알림 수신자는 자신의 알림을 개별 또는 전체 삭제할 수 있습니다.
drop policy if exists "users delete own notifications" on public.notifications;
create policy "users delete own notifications"
  on public.notifications for delete to authenticated
  using (user_id = auth.uid());
