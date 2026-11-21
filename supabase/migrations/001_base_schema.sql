-- The starting tables, for setting the app up on a NEW Supabase project.
-- (The original project created these in the dashboard; on it, this file
-- changes nothing, because every statement is "if not exists".)
--
-- Run in Supabase: SQL Editor → New query → paste → Run. Then run 002, 003, 005.
-- Row-level security policies are created by 005_hardening.sql.

create table if not exists public.task_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- Deleting a group deletes its tasks.
  group_id uuid references public.task_groups on delete cascade,
  title text not null,
  notes text,
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Locked down until 005 adds the policies: with RLS on and no policies,
-- nobody (except the server) can read or write anything.
alter table public.task_groups enable row level security;
alter table public.tasks enable row level security;
