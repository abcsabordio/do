-- Lets groups be dragged into any order (like tasks). Safe to run again.
-- Run in Supabase: SQL Editor → New query → paste → Run. Needs 005 first.

alter table public.task_groups
  add column if not exists position double precision;

-- Keep today's order (newest first). Lower position = higher up.
update public.task_groups
set position = -extract(epoch from created_at)
where position is null;

alter table public.task_groups drop constraint if exists task_groups_position_finite;
alter table public.task_groups add constraint task_groups_position_finite
  check (position is null or position between -1e15 and 1e15);

notify pgrst, 'reload schema';
