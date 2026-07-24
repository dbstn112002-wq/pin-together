-- Run once in the Supabase SQL Editor.
-- Only the owner can remove another member. The owner cannot remove themself.

drop policy if exists "owners manage members" on public.space_members;
drop policy if exists "owners remove other members" on public.space_members;

create policy "owners remove other members"
  on public.space_members for delete to authenticated
  using (public.is_space_owner(space_id) and user_id <> auth.uid());
