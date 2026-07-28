-- Run once in the Supabase SQL Editor after the existing notification migrations.
-- Stores each user's device subscriptions and per-kind push choices.

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  pin boolean not null default true,
  comment boolean not null default true,
  reply boolean not null default true,
  message boolean not null default true,
  route boolean not null default true,
  invite boolean not null default true,
  reaction boolean not null default true,
  favorite boolean not null default false,
  location boolean not null default false,
  announcement boolean not null default true,
  system boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.notifications add column if not exists push_sent_at timestamptz;
create index if not exists notifications_pending_push_idx on public.notifications(created_at) where push_sent_at is null;

alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "users manage own notification preferences" on public.notification_preferences;
create policy "users manage own notification preferences" on public.notification_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "users manage own push subscriptions" on public.push_subscriptions;
create policy "users manage own push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
