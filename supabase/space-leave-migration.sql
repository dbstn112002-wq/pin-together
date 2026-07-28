-- Run once in the Supabase SQL Editor after member-removal-migration.sql.
-- A regular member can leave only their own travel space membership.
-- The owner cannot leave, preventing a travel space without an owner.

drop policy if exists "members leave own spaces" on public.space_members;

create policy "members leave own spaces"
  on public.space_members for delete to authenticated
  using (user_id = auth.uid() and not public.is_space_owner(space_id));
