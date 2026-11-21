-- Security hardening. Safe to run more than once.
-- Run in Supabase: SQL Editor → New query → paste → Run. Needs 002 and 003 first.
--
-- 1. Strict row-level security: you can only see and change your own rows,
--    and a task can only go into one of your own groups.
-- 2. Length limits on every text column (same numbers as src/lib/limits.ts).
--    Existing values that are too long are shortened first.
-- 3. Caps on how many rows one account can create (stops a script filling the DB).
-- 4. Reminder maths moved out of the public API and made constant-time,
--    and bad time zones can no longer break reminders for everyone.
-- 5. Push devices: validated, and at most 10 per account.

begin;

-- A schema the API doesn't expose. Functions here can't be called from the app.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- 1. Row-level security ----------

alter table public.tasks enable row level security;
alter table public.task_groups enable row level security;

-- Replace whatever policies exist with the strict set below.
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('tasks', 'task_groups')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.task_groups alter column user_id set default auth.uid();
alter table public.tasks alter column user_id set default auth.uid();

create policy "groups: read own" on public.task_groups
  for select to authenticated using (user_id = (select auth.uid()));
create policy "groups: add own" on public.task_groups
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "groups: change own" on public.task_groups
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "groups: delete own" on public.task_groups
  for delete to authenticated using (user_id = (select auth.uid()));

-- Is this group yours? (security definer so it can look regardless of RLS.)
create or replace function private.owns_group(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select gid is null
      or exists (select 1 from public.task_groups g where g.id = gid and g.user_id = (select auth.uid()));
$$;
grant usage on schema private to authenticated;
revoke all on function private.owns_group(uuid) from public, anon;
grant execute on function private.owns_group(uuid) to authenticated;

create policy "tasks: read own" on public.tasks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "tasks: add own" on public.tasks
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.owns_group(group_id));
create policy "tasks: change own" on public.tasks
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.owns_group(group_id));
create policy "tasks: delete own" on public.tasks
  for delete to authenticated using (user_id = (select auth.uid()));

create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_group_id_idx on public.tasks (group_id);
create index if not exists task_groups_user_id_idx on public.task_groups (user_id);

-- ---------- 2. Length limits ----------
-- First bring any existing rows within the limits (otherwise those rows could
-- never be edited again, not even ticked off), then enforce them for good.

update public.tasks set title = 'Untitled task' where title is null or btrim(title) = '';
update public.tasks set title = left(btrim(title), 200) where char_length(btrim(title)) > 200;
update public.tasks set notes = left(notes, 2000) where char_length(notes) > 2000;
update public.tasks set tz = null where char_length(tz) > 64;
update public.tasks set remind_at = null, repeat = null
  where remind_at is not null and remind_at not between '2000-01-01' and '2200-01-01';
update public.tasks set position = null where position is not null and position not between -1e15 and 1e15;
update public.task_groups set name = 'Untitled group' where name is null or btrim(name) = '';
update public.task_groups set name = left(btrim(name), 80) where char_length(btrim(name)) > 80;

alter table public.tasks drop constraint if exists tasks_title_length;
alter table public.tasks add constraint tasks_title_length
  check (char_length(btrim(title)) between 1 and 200);

alter table public.tasks drop constraint if exists tasks_notes_length;
alter table public.tasks add constraint tasks_notes_length
  check (notes is null or char_length(notes) <= 2000);

alter table public.tasks drop constraint if exists tasks_tz_length;
alter table public.tasks add constraint tasks_tz_length
  check (tz is null or char_length(tz) <= 64);

alter table public.tasks drop constraint if exists tasks_remind_range;
alter table public.tasks add constraint tasks_remind_range
  check (remind_at is null or remind_at between '2000-01-01' and '2200-01-01');

alter table public.tasks drop constraint if exists tasks_position_finite;
alter table public.tasks add constraint tasks_position_finite
  check (position is null or position between -1e15 and 1e15);

alter table public.task_groups drop constraint if exists task_groups_name_length;
alter table public.task_groups add constraint task_groups_name_length
  check (char_length(btrim(name)) between 1 and 80);

-- ---------- 3. Row caps per account ----------

create or replace function private.enforce_row_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap int := case tg_table_name when 'tasks' then 5000 else 200 end;
  n int;
begin
  -- Serialise inserts per user so parallel requests can't slip past the cap.
  perform pg_advisory_xact_lock(hashtext(tg_table_name || new.user_id::text));
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name)
    into n using new.user_id;
  if n >= cap then
    raise exception 'You''ve reached the limit of % %.', cap,
      case tg_table_name when 'tasks' then 'tasks' else 'groups' end
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_row_cap() from public, anon, authenticated;

drop trigger if exists tasks_row_cap on public.tasks;
create trigger tasks_row_cap before insert on public.tasks
  for each row execute function private.enforce_row_cap();

drop trigger if exists task_groups_row_cap on public.task_groups;
create trigger task_groups_row_cap before insert on public.task_groups
  for each row execute function private.enforce_row_cap();

-- ---------- 4. Reminder maths ----------

-- Next repeat of a reminder after now(), in the user's local time.
-- Jumps straight to the right step instead of looping one day at a time,
-- so it's fast no matter how old the reminder is.
create or replace function private.next_occurrence(start_at timestamptz, rep text, zone text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local_start timestamp := start_at at time zone zone;
  local_now timestamp := now() at time zone zone;
  step interval := case rep
    when 'daily' then interval '1 day'
    when 'weekly' then interval '7 days'
    else interval '1 month'
  end;
  n int;
  candidate timestamptz;
begin
  if local_now <= local_start then
    n := 1;
  elsif rep = 'monthly' then
    n := (extract(year from age(local_now, local_start)) * 12
          + extract(month from age(local_now, local_start)))::int;
  else
    n := floor(extract(epoch from (local_now - local_start)) / extract(epoch from step))::int;
  end if;
  n := greatest(n, 1);
  -- The estimate is at most a step or two short; finish the last bit.
  for i in 1 .. 5 loop
    candidate := (local_start + step * n) at time zone zone;
    exit when candidate > now();
    n := n + 1;
  end loop;
  return candidate;
end;
$$;
revoke all on function private.next_occurrence(timestamptz, text, text) from public, anon, authenticated;

-- Keeps next_notify_at right. Also throws away time zones Postgres doesn't
-- know, which would otherwise make the every-minute job fail for everyone.
create or replace function public.tasks_set_next_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tz is not null and (tg_op = 'INSERT' or new.tz is distinct from old.tz) then
    begin
      perform now() at time zone new.tz;
    exception when others then
      new.tz := null;
    end;
  end if;

  if new.remind_at is null then
    new.next_notify_at := null;
  elsif tg_op = 'INSERT'
     or new.remind_at is distinct from old.remind_at
     or new.repeat is distinct from old.repeat
     or new.tz is distinct from old.tz then
    if new.remind_at > now() then
      new.next_notify_at := new.remind_at;
    elsif new.repeat is not null then
      new.next_notify_at := private.next_occurrence(new.remind_at, new.repeat, coalesce(new.tz, 'UTC'));
    else
      new.next_notify_at := null; -- one-off reminder already in the past
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_set_next_notify() from public, anon, authenticated;

-- Same as in 003, but using the private function.
create or replace function public.claim_due_reminders()
returns table (task_id uuid, user_id uuid, title text, notes text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select t.id
    from public.tasks t
    where t.next_notify_at is not null
      and t.next_notify_at <= now()
      and (t.repeat is not null or not t.is_done)
    order by t.next_notify_at
    limit 1000 -- a backlog is worked off over the next minutes
    for update skip locked
  )
  update public.tasks t
  set
    next_notify_at = case
      when t.repeat is null then null
      else private.next_occurrence(t.next_notify_at, t.repeat, coalesce(t.tz, 'UTC'))
    end,
    is_done = case when t.repeat is null then t.is_done else false end,
    completed_at = case when t.repeat is null then t.completed_at else null end
  from due
  where t.id = due.id
  returning t.id, t.user_id, t.title, t.notes;
end;
$$;
revoke all on function public.claim_due_reminders() from public, anon, authenticated;

drop function if exists public.next_occurrence(timestamptz, text, text);

-- Clear any time zone already stored that Postgres can't use.
update public.tasks
set tz = null
where tz is not null
  and tz not in (select name from pg_timezone_names)
  and upper(tz) not in (select abbrev from pg_timezone_abbrevs);

-- ---------- 5. Push devices ----------

delete from public.push_subscriptions
  where endpoint not like 'https://%' or char_length(endpoint) > 1000
     or char_length(p256dh) > 200 or char_length(auth) > 200;

alter table public.push_subscriptions drop constraint if exists push_subscriptions_sizes;
alter table public.push_subscriptions add constraint push_subscriptions_sizes check (
  endpoint like 'https://%'
  and char_length(endpoint) <= 1000
  and char_length(p256dh) <= 200
  and char_length(auth) <= 200
);

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 1 and 200
     or coalesce(char_length(p_auth), 0) not between 1 and 200 then
    raise exception 'That isn''t a valid notification subscription.' using errcode = 'P0001';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (me, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();

  -- Keep the 10 most recent devices per account.
  delete from public.push_subscriptions
  where user_id = me
    and id not in (
      select id from public.push_subscriptions where user_id = me order by created_at desc limit 10
    );
end;
$$;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
