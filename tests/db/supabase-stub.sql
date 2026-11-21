-- TESTS ONLY. Never run this in Supabase.
--
-- A minimal stand-in for what Supabase provides (roles, auth.uid()), plus
-- tables shaped like the app's original ones, with a deliberately loose
-- policy that 005_hardening.sql must replace. See README → Testing.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.task_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  group_id uuid references public.task_groups on delete cascade,
  title text not null,
  notes text,
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.tasks enable row level security;
alter table public.task_groups enable row level security;
create policy "too loose" on public.tasks for all using (true) with check (true);
create policy "own groups" on public.task_groups for all using (user_id = auth.uid());

insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000000'), ('bbbbbbbb-0000-0000-0000-000000000000');
-- An existing over-long row: NOT VALID constraints must leave it alone.
insert into public.tasks (user_id, title) values ('aaaaaaaa-0000-0000-0000-000000000000', repeat('x', 300));
