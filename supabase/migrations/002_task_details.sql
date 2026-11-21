-- Adds reminders and manual ordering to tasks.
-- Task descriptions use the existing `notes` column, so nothing is added for that.
-- Run once in Supabase: SQL Editor → New query → paste → Run.

alter table public.tasks
  add column if not exists remind_at timestamptz,
  add column if not exists repeat    text check (repeat in ('daily', 'weekly', 'monthly')),
  add column if not exists position  double precision;

-- Give existing tasks an order that matches what you see today (newest first).
-- Lower position = higher in the list.
update public.tasks
set position = -extract(epoch from created_at)
where position is null;

-- Used later to find reminders that are due.
create index if not exists tasks_remind_at_idx on public.tasks (remind_at)
  where remind_at is not null;

-- Make the API notice the new columns straight away.
notify pgrst, 'reload schema';
