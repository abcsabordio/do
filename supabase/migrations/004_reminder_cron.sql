-- Runs the send-reminders Edge Function once a minute.
-- Run AFTER deploying the function (see docs/NOTIFICATIONS.md).
-- `npm run push:setup` does all of this for you; this file is the manual route.
--
-- Before running:
--   1. Database → Extensions: enable "pg_cron" and "pg_net".
--   2. Replace the two placeholders below:
--        <PROJECT_REF>  the "abcd1234" part of https://abcd1234.supabase.co
--        <CRON_SECRET>  the same value you set with `supabase secrets set CRON_SECRET=...`
--
-- The secret is kept in Supabase Vault (encrypted), not in the job itself.

select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
select vault.create_secret('<CRON_SECRET>', 'reminder_cron_secret');

select cron.schedule(
  'send-reminders',
  '* * * * *', -- every minute
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Useful later:
--   select * from cron.job_run_details order by start_time desc limit 10;  -- did it run?
--   select cron.unschedule('send-reminders');                              -- stop it
