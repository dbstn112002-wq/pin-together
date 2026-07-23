-- 핀투게더: Supabase SQL Editor에서 한 번 실행합니다.
-- 실행 전: Authentication > Providers에서 Email을 켜고, 필요하면 Google도 설정합니다.

create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'editor', 'viewer');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 16),
  pin_color text not null default 'coral' check (pin_color in ('coral','blue','amber','green','purple')),
  created_at timestamptz not null default now()
);

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'viewer',
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  code text not null unique default encode(gen_random_bytes(18), 'hex'),
  role public.member_role not null default 'editor',
  created_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz,
  max_uses integer,
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.pins (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  note text not null default '' check (char_length(note) <= 1000),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  color text not null default 'coral' check (color in ('coral','blue','amber','green','purple')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.favorite_pins (
  pin_id uuid not null references public.pins(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pin_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index pins_space_id_idx on public.pins(space_id, created_at desc);
create index messages_space_id_idx on public.messages(space_id, created_at desc);
create index members_user_id_idx on public.space_members(user_id);

-- 아래 함수는 RLS 정책에만 쓰며, 멤버십 테이블을 직접 노출하지 않습니다.
create or replace function public.is_space_member(target_space_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.space_members where space_id = target_space_id and user_id = auth.uid()) $$;

create or replace function public.can_edit_space(target_space_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.space_members where space_id = target_space_id and user_id = auth.uid() and role in ('owner','editor')) $$;

create or replace function public.is_space_owner(target_space_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.space_members where space_id = target_space_id and user_id = auth.uid() and role = 'owner') $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.profiles (id, nickname) values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'nickname',''), '여행자'));
  return new;
end; $$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.create_space(space_name text)
returns uuid language plpgsql security definer set search_path = public
as $$ declare new_id uuid; begin
  insert into public.spaces(name, owner_id) values (space_name, auth.uid()) returning id into new_id;
  insert into public.space_members(space_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return new_id;
end; $$;

create or replace function public.accept_invitation(invite_code text)
returns uuid language plpgsql security definer set search_path = public
as $$ declare invitation public.invitations; begin
  select * into invitation from public.invitations where code = invite_code for update;
  if invitation.id is null then raise exception '유효하지 않은 초대 코드입니다.'; end if;
  if invitation.expires_at is not null and invitation.expires_at < now() then raise exception '만료된 초대 코드입니다.'; end if;
  if invitation.max_uses is not null and invitation.use_count >= invitation.max_uses then raise exception '사용 횟수가 초과되었습니다.'; end if;
  insert into public.space_members(space_id, user_id, role) values (invitation.space_id, auth.uid(), invitation.role) on conflict (space_id, user_id) do nothing;
  update public.invitations set use_count = use_count + 1 where id = invitation.id;
  return invitation.space_id;
end; $$;

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.invitations enable row level security;
alter table public.pins enable row level security;
alter table public.favorite_pins enable row level security;
alter table public.messages enable row level security;

create policy "signed in users see profiles" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "members see spaces" on public.spaces for select to authenticated using (public.is_space_member(id));
create policy "owners update space" on public.spaces for update to authenticated using (public.is_space_owner(id)) with check (public.is_space_owner(id));
create policy "members see members" on public.space_members for select to authenticated using (public.is_space_member(space_id));
create policy "owners manage members" on public.space_members for delete to authenticated using (public.is_space_owner(space_id));
create policy "owners see invitations" on public.invitations for select to authenticated using (public.is_space_owner(space_id));
create policy "owners create invitations" on public.invitations for insert to authenticated with check (public.is_space_owner(space_id) and created_by = auth.uid());
create policy "owners delete invitations" on public.invitations for delete to authenticated using (public.is_space_owner(space_id));
create policy "members see pins" on public.pins for select to authenticated using (public.is_space_member(space_id));
create policy "editors add pins" on public.pins for insert to authenticated with check (public.can_edit_space(space_id) and author_id = auth.uid());
create policy "authors or owners update pins" on public.pins for update to authenticated using (author_id = auth.uid() or public.is_space_owner(space_id)) with check (public.can_edit_space(space_id));
create policy "authors or owners delete pins" on public.pins for delete to authenticated using (author_id = auth.uid() or public.is_space_owner(space_id));
create policy "members see favorites" on public.favorite_pins for select to authenticated using (exists (select 1 from public.pins p where p.id = pin_id and public.is_space_member(p.space_id)));
create policy "users manage own favorites" on public.favorite_pins for insert to authenticated with check (user_id = auth.uid());
create policy "users remove own favorites" on public.favorite_pins for delete to authenticated using (user_id = auth.uid());
create policy "members see messages" on public.messages for select to authenticated using (public.is_space_member(space_id));
create policy "members send messages" on public.messages for insert to authenticated with check (public.is_space_member(space_id) and author_id = auth.uid());

grant execute on function public.create_space(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.is_space_member(uuid) to authenticated;
grant execute on function public.can_edit_space(uuid) to authenticated;
grant execute on function public.is_space_owner(uuid) to authenticated;

alter publication supabase_realtime add table public.pins, public.messages, public.space_members;
