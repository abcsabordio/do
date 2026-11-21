-- Push notifications for reminders.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- Needs 002_task_details.sql to have been run first.

-- ---------- Tasks: when the next notification is due ----------

alter table public.tasks
  -- The user's time zone, so "every Saturday 9 AM" stays 9 AM across daylight saving.
  add column if not exists tz text,
  -- When the server should next send a notification. Kept up to date by the
  -- trigger below and by claim_due_reminders(); the app never sets it.
  add column if not exists next_notify_at timestamptz;

create index if not exists tasks_next_notify_idx on public.tasks (next_notify_at)
  where next_notify_at is not null;

-- The next time a repeating reminder goes off after now(), in the user's
-- local time. Steps from the original time (start + n × interval) so monthly
-- reminders on the 31st don't drift to the 28th.
create or replace function public.next_occurrence(start_at timestamptz, rep text, zone text)
returns timestamptz
language plpgsql
stable
as $$
declare
  local_start timestamp := start_at at time zone zone;
  step interval := case rep
    when 'daily' then interval '1 day'
    when 'weekly' then interval '7 days'
    else interval '1 month'
  end;
  n int := 1;
  candidate timestamptz;
begin
  loop
    candidate := (local_start + step * n) at time zone zone;
    exit when candidate > now() or n > 5000;
    n := n + 1;
  end loop;
  return candidate;
end;
$$;

-- Whenever a reminder is created or changed, work out next_notify_at.
create or replace function public.tasks_set_next_notify()
returns trigger
language plpgsql
as $$
begin
  if new.remind_at is null then
    new.next_notify_at := null;
  elsif tg_op = 'INSERT'
     or new.remind_at is distinct from old.remind_at
     or new.repeat is distinct from old.repeat
     or new.tz is distinct from old.tz then
    if new.remind_at > now() then
      new.next_notify_at := new.remind_at;
    elsif new.repeat is not null then
      new.next_notify_at := public.next_occurrence(new.remind_at, new.repeat, coalesce(new.tz, 'UTC'));
    else
      new.next_notify_at := null; -- one-off reminder already in the past
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_next_notify on public.tasks;
create trigger tasks_next_notify
  before insert or update on public.tasks
  for each row execute function public.tasks_set_next_notify();

-- Fill it in for reminders that already exist.
update public.tasks
set next_notify_at = case
  when remind_at > now() then remind_at
  when repeat is not null then public.next_occurrence(remind_at, repeat, coalesce(tz, 'UTC'))
end
where remind_at is not null;

-- ---------- Devices that receive notifications ----------

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users see their own devices" on public.push_subscriptions;
create policy "Users see their own devices" on public.push_subscriptions
  for select using (user_id = auth.uid());

-- Saving goes through this function so that a browser shared by two
-- accounts always belongs to whoever signed in last.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- ---------- Picking up due reminders (called by the Edge Function) ----------

-- Returns every reminder that is due and, in the same step, moves it on:
-- one-off reminders are cleared; repeating ones jump to their next time and
-- the task is reopened (so "Wash motorcycle" is back on the list each Saturday).
-- "for update skip locked" means two overlapping runs never send twice.
create or replace function public.claim_due_reminders()
returns table (task_id uuid, user_id uuid, title text, notes text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select t.id
    from tasks t
    where t.next_notify_at is not null
      and t.next_notify_at <= now()
      and (t.repeat is not null or not t.is_done)
    for update skip locked
  )
  update tasks t
  set
    next_notify_at = case
      when t.repeat is null then null
      else next_occurrence(t.next_notify_at, t.repeat, coalesce(t.tz, 'UTC'))
    end,
    is_done = case when t.repeat is null then t.is_done else false end,
    completed_at = case when t.repeat is null then t.completed_at else null end
  from due
  where t.id = due.id
  returning t.id, t.user_id, t.title, t.notes;
end;
$$;

-- Only the server (service role) may call this.
revoke all on function public.claim_due_reminders() from public, anon, authenticated;

notify pgrst, 'reload schema';
