-- TESTS ONLY. Database security checks, run against a throwaway local
-- Postgres after supabase-stub.sql and migrations 002, 003, 005.
-- Each check prints PASS or FAIL. run_as() executes SQL as a given role and
-- user; check() passes when the outcome (error or not) is the expected one.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.run_as(who text, sub text, stmt text) returns text language plpgsql as $$
begin
  execute format('set local role %I', who);
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return 'ERR ' || sqlstate || ' ' || sqlerrm;
end $$;

create or replace function pg_temp.check(label text, got text, want_error boolean) returns text language sql as $$
  select case when (got like 'ERR%') = want_error then 'PASS ' else 'FAIL ' end || label || '  -> ' || got
$$;

\set A '''aaaaaaaa-0000-0000-0000-000000000000'''
\set B '''bbbbbbbb-0000-0000-0000-000000000000'''

-- Fixtures owned by A
insert into task_groups (id, user_id, name) values ('11111111-0000-0000-0000-000000000000', :A, 'A group');
insert into tasks (id, user_id, title) values ('22222222-0000-0000-0000-000000000000', :A, 'A task');

-- ---------- RLS ----------
select pg_temp.check('A can add a task (user_id defaults to A)',
  pg_temp.run_as('authenticated', :A, $q$insert into tasks (title) values ('hello')$q$), false);
select pg_temp.check('A can add a task to own group',
  pg_temp.run_as('authenticated', :A, $q$insert into tasks (title, group_id) values ('g', '11111111-0000-0000-0000-000000000000')$q$), false);
select pg_temp.check('B cannot add a task into A''s group',
  pg_temp.run_as('authenticated', :B, $q$insert into tasks (title, group_id) values ('sneaky', '11111111-0000-0000-0000-000000000000')$q$), true);
select pg_temp.check('B cannot insert a row claiming to be A',
  pg_temp.run_as('authenticated', :B, $q$insert into tasks (title, user_id) values ('spoof', 'aaaaaaaa-0000-0000-0000-000000000000')$q$), true);
select pg_temp.check('B cannot move own task into A''s group',
  pg_temp.run_as('authenticated', :B, $q$do $d$ begin
     insert into tasks (id, title) values ('33333333-0000-0000-0000-000000000000', 'mine');
     update tasks set group_id = '11111111-0000-0000-0000-000000000000' where id = '33333333-0000-0000-0000-000000000000';
   end $d$$q$), true);
select pg_temp.check('B sees none of A''s tasks',
  pg_temp.run_as('authenticated', :B, $q$do $d$ begin
     if exists (select 1 from tasks where user_id = 'aaaaaaaa-0000-0000-0000-000000000000') then raise exception 'leak'; end if;
   end $d$$q$), false);
select pg_temp.check('B''s update of A''s task changes nothing',
  pg_temp.run_as('authenticated', :B, $q$do $d$ declare n int; begin
     update tasks set title = 'pwned' where id = '22222222-0000-0000-0000-000000000000';
     get diagnostics n = row_count; if n > 0 then raise exception 'updated %', n; end if;
   end $d$$q$), false);
select pg_temp.check('anon cannot read tasks',
  pg_temp.run_as('anon', null, $q$do $d$ begin if exists (select 1 from tasks) then raise exception 'leak'; end if; end $d$$q$), false);
select pg_temp.check('anon cannot insert',
  pg_temp.run_as('anon', null, $q$insert into tasks (title) values ('x')$q$), true);

-- ---------- Length limits ----------
select pg_temp.check('title 200 ok',
  pg_temp.run_as('authenticated', :A, format('insert into tasks (title) values (%L)', repeat('t', 200))), false);
select pg_temp.check('title 201 rejected',
  pg_temp.run_as('authenticated', :A, format('insert into tasks (title) values (%L)', repeat('t', 201))), true);
select pg_temp.check('blank title rejected',
  pg_temp.run_as('authenticated', :A, $q$insert into tasks (title) values ('   ')$q$), true);
select pg_temp.check('notes 2001 rejected',
  pg_temp.run_as('authenticated', :A, format('insert into tasks (title, notes) values (''n'', %L)', repeat('n', 2001))), true);
select pg_temp.check('group name 81 rejected',
  pg_temp.run_as('authenticated', :A, format('insert into task_groups (name) values (%L)', repeat('g', 81))), true);
select pg_temp.check('reminder in year 1990 rejected',
  pg_temp.run_as('authenticated', :A, $q$insert into tasks (title, remind_at) values ('r', '1990-01-01')$q$), true);
select pg_temp.check('NaN position rejected',
  pg_temp.run_as('authenticated', :A, $q$insert into tasks (title, position) values ('p', 'NaN')$q$), true);
select pg_temp.check('pre-existing 300-char title was shortened to 200 and is still editable',
  pg_temp.run_as('postgres', null, $q$do $d$ declare n int; begin
     update tasks set is_done = true where title = repeat('x', 200);
     get diagnostics n = row_count; if n <> 1 then raise exception 'found %', n; end if;
   end $d$$q$), false);

-- ---------- Time zones / reminders ----------
select pg_temp.check('garbage tz is dropped, insert still works',
  pg_temp.run_as('authenticated', :A, $q$do $d$ declare z text; begin
     insert into tasks (id, title, remind_at, repeat, tz) values ('44444444-0000-0000-0000-000000000000', 'tz', now() - interval '3 days', 'daily', 'Not/AZone')
     returning tz into z;
     if z is not null then raise exception 'tz kept: %', z; end if;
   end $d$$q$), false);
select 'INFO next_notify_at for daily reminder started 3 days ago (should be < 1 day ahead): '
  || (select next_notify_at - now() from tasks where id = '44444444-0000-0000-0000-000000000000');
select pg_temp.check('very old daily reminder (year 2001) computes fast and lands in the future',
  pg_temp.run_as('authenticated', :A, $q$do $d$ declare t timestamptz; begin
     insert into tasks (title, remind_at, repeat, tz) values ('old', '2001-03-04 09:00+00', 'daily', 'Asia/Manila') returning next_notify_at into t;
     if t <= now() or t > now() + interval '1 day' then raise exception 'bad next: %', t; end if;
     if extract(hour from t at time zone 'Asia/Manila') <> 17 then raise exception 'local hour drifted: %', t at time zone 'Asia/Manila'; end if;
   end $d$$q$), false);
select pg_temp.check('monthly on the 31st stays anchored to the 31st',
  pg_temp.run_as('postgres', null, $q$do $d$ declare t timestamptz; begin
     t := private.next_occurrence('2026-01-31 09:00+00', 'monthly', 'UTC');
     if t <= now() then raise exception 'past %', t; end if;
     if extract(day from t at time zone 'UTC') not in (28, 29, 30, 31) then raise exception 'odd day %', t; end if;
     t := private.next_occurrence('2025-12-31 09:00+00', 'monthly', 'UTC');
     if extract(day from t at time zone 'UTC') < 28 then raise exception 'drifted %', t; end if;
   end $d$$q$), false);
select 'INFO monthly from 2025-12-31 -> ' || private.next_occurrence('2025-12-31 09:00+00', 'monthly', 'UTC');
select 'INFO weekly from 2026-11-07 (Sat) -> ' || to_char(private.next_occurrence('2026-11-07 10:00+00', 'weekly', 'UTC'), 'Dy YYYY-MM-DD HH24:MI');

-- ---------- Who can call what ----------
select pg_temp.check('authenticated cannot call claim_due_reminders',
  pg_temp.run_as('authenticated', :A, 'select public.claim_due_reminders()'), true);
select pg_temp.check('authenticated cannot call private.next_occurrence',
  pg_temp.run_as('authenticated', :A, $q$select private.next_occurrence(now(), 'daily', 'UTC')$q$), true);
select pg_temp.check('anon cannot call private.owns_group',
  pg_temp.run_as('anon', null, 'select private.owns_group(null)'), true);
select pg_temp.check('public.next_occurrence no longer exists',
  pg_temp.run_as('authenticated', :A, $q$select public.next_occurrence(now(), 'daily', 'UTC')$q$), true);

-- ---------- claim_due_reminders (as the server) ----------
update tasks set next_notify_at = now() - interval '1 minute' where id = '44444444-0000-0000-0000-000000000000';
update tasks set is_done = true where id = '44444444-0000-0000-0000-000000000000';
select pg_temp.check('service role claims a due repeating reminder, reopens it, moves it on',
  pg_temp.run_as('service_role', null, $q$do $d$ declare n int; t timestamptz; d boolean; begin
     select count(*) into n from public.claim_due_reminders();
     if n <> 1 then raise exception 'claimed %', n; end if;
     select next_notify_at, is_done into t, d from public.tasks where id = '44444444-0000-0000-0000-000000000000';
     if t <= now() then raise exception 'not advanced'; end if;
     if d then raise exception 'not reopened'; end if;
     select count(*) into n from public.claim_due_reminders();
     if n <> 0 then raise exception 'claimed twice'; end if;
   end $d$$q$), false);

-- ---------- Push devices ----------
select pg_temp.check('http endpoint rejected',
  pg_temp.run_as('authenticated', :A, $q$select save_push_subscription('http://evil', 'k', 'a')$q$), true);
select pg_temp.check('anon cannot save a device',
  pg_temp.run_as('anon', null, $q$select save_push_subscription('https://push.example/x', 'k', 'a')$q$), true);
select pg_temp.check('12 devices for A -> only 10 kept',
  pg_temp.run_as('authenticated', :A, $q$do $d$ declare n int; begin
     for i in 1..12 loop perform save_push_subscription('https://push.example/' || i, 'k', 'a'); end loop;
     select count(*) into n from push_subscriptions; if n <> 10 then raise exception 'have %', n; end if;
   end $d$$q$), false);
select pg_temp.check('same endpoint signed in as B moves to B',
  pg_temp.run_as('authenticated', :B, $q$do $d$ declare n int; begin
     perform save_push_subscription('https://push.example/12', 'k', 'a');
     select count(*) into n from push_subscriptions; if n <> 1 then raise exception 'B sees %', n; end if;
   end $d$$q$), false);

-- ---------- Row caps ----------
select pg_temp.check('201st group rejected',
  pg_temp.run_as('authenticated', :B, $q$do $d$ begin
     for i in 1..201 loop insert into task_groups (name) values ('g' || i); end loop;
   end $d$$q$), true);
select pg_temp.check('200 groups allowed',
  pg_temp.run_as('authenticated', :B, $q$do $d$ begin
     for i in 1..200 loop insert into task_groups (name) values ('g' || i); end loop;
   end $d$$q$), false);
select 'INFO cap message: ' || pg_temp.run_as('authenticated', :B, $q$insert into task_groups (name) values ('one too many')$q$);
