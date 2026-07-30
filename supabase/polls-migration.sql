-- Supabase SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 안전합니다.

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  allow_multiple boolean not null default false,
  is_anonymous boolean not null default false,
  allow_change boolean not null default true,
  closes_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 100),
  position integer not null default 0
);
create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, voter_id)
);
create table if not exists public.poll_pin_links (
  poll_id uuid not null references public.polls(id) on delete cascade,
  pin_id uuid not null references public.pins(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, pin_id)
);
create index if not exists polls_space_created_idx on public.polls(space_id, created_at desc);
create index if not exists poll_options_poll_idx on public.poll_options(poll_id, position);
create index if not exists poll_votes_poll_idx on public.poll_votes(poll_id);
create index if not exists poll_pin_links_pin_idx on public.poll_pin_links(pin_id);

alter table public.notification_preferences add column if not exists poll boolean not null default true;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('pin','message','comment','reply','route','member','invite','reaction','favorite','location','system','checklist','poll'));
do $$ begin
  if exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='notification_kind') then alter type public.notification_kind add value if not exists 'poll'; end if;
end $$;

create or replace function public.notify_space_poll_created() returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  select nickname into actor_name from public.profiles where id = new.creator_id;
  insert into public.notifications(user_id, space_id, kind, body)
  select sm.user_id, new.space_id, 'poll', coalesce(actor_name, '참여자') || ' : ' || new.title || ' 투표를 생성했습니다.'
  from public.space_members sm left join public.notification_preferences np on np.user_id = sm.user_id
  where sm.space_id = new.space_id and sm.user_id <> new.creator_id and coalesce(np.poll, true);
  return new;
end $$;
drop trigger if exists polls_notify_created on public.polls;
create trigger polls_notify_created after insert on public.polls for each row execute function public.notify_space_poll_created();

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.poll_pin_links enable row level security;

drop policy if exists "members read polls" on public.polls;
drop policy if exists "members create polls" on public.polls;
drop policy if exists "poll creators delete polls" on public.polls;
create policy "members read polls" on public.polls for select to authenticated using (public.is_space_member(space_id));
create policy "members create polls" on public.polls for insert to authenticated with check (creator_id = auth.uid() and public.is_space_member(space_id));
create policy "poll creators delete polls" on public.polls for delete to authenticated using (creator_id = auth.uid());

drop policy if exists "members read poll options" on public.poll_options;
drop policy if exists "poll creators create options" on public.poll_options;
drop policy if exists "members add active poll options" on public.poll_options;
create policy "members read poll options" on public.poll_options for select to authenticated using (exists (select 1 from public.polls p where p.id = poll_id and public.is_space_member(p.space_id)));
create policy "members add active poll options" on public.poll_options for insert to authenticated with check (exists (select 1 from public.polls p where p.id = poll_id and p.closes_at > now() and public.is_space_member(p.space_id)));

drop policy if exists "members read poll votes" on public.poll_votes;
drop policy if exists "members cast poll votes" on public.poll_votes;
drop policy if exists "voters remove own poll votes" on public.poll_votes;
create policy "members read poll votes" on public.poll_votes for select to authenticated using (exists (select 1 from public.polls p where p.id = poll_id and public.is_space_member(p.space_id)));
create policy "members cast poll votes" on public.poll_votes for insert to authenticated with check (voter_id = auth.uid() and exists (select 1 from public.polls p where p.id = poll_id and p.closes_at > now() and public.is_space_member(p.space_id)));
create policy "voters remove own poll votes" on public.poll_votes for delete to authenticated using (voter_id = auth.uid() and exists (select 1 from public.polls p where p.id = poll_id and p.closes_at > now() and p.allow_change));

drop policy if exists "members read poll pin links" on public.poll_pin_links;
drop policy if exists "members link active polls to pins" on public.poll_pin_links;
create policy "members read poll pin links" on public.poll_pin_links for select to authenticated using (exists (select 1 from public.polls p where p.id = poll_id and public.is_space_member(p.space_id)));
create policy "members link active polls to pins" on public.poll_pin_links for insert to authenticated with check (exists (select 1 from public.polls p join public.pins pin on pin.id = pin_id where p.id = poll_id and p.space_id = pin.space_id and public.is_space_member(p.space_id)));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='polls') then alter publication supabase_realtime add table public.polls; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='poll_options') then alter publication supabase_realtime add table public.poll_options; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='poll_votes') then alter publication supabase_realtime add table public.poll_votes; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='poll_pin_links') then alter publication supabase_realtime add table public.poll_pin_links; end if;
end $$;
