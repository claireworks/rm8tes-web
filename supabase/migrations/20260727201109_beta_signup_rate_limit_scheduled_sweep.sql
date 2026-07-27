-- The privacy policy commits to holding the beta form's spam-prevention record
-- for no more than 24 hours. Until now the only thing enforcing that was the
-- delete inside begin_beta_signup(), which runs solely when someone submits the
-- form -- so on a quiet pre-launch waitlist the last entries before a lull
-- outlived the window we published.
--
-- This sweep runs on the clock instead. Two hours is already twelve times the
-- 10-minute window the limiter actually reads, so nothing here is load-bearing
-- for throttling; the margin exists purely so that a missed cron run cannot put
-- us anywhere near the 24 hours we promised.

do $$
begin
  perform cron.unschedule('beta-signup-rate-limit-sweep');
exception when others then
  null;  -- not scheduled yet; nothing to replace
end;
$$;

select cron.schedule(
  'beta-signup-rate-limit-sweep',
  '*/15 * * * *',
  $sweep$
    delete from private.beta_signup_rate_limits
    where requested_at < now() - interval '2 hours';
  $sweep$
);

comment on table private.beta_signup_rate_limits is
  'Throttling ledger for the beta waitlist form: bucketed source address (IPv6 to /64) plus timestamp, never joined to beta_signups. Authoritative retention is the beta-signup-rate-limit-sweep cron job -- every 15 minutes, 2-hour horizon. The delete inside begin_beta_signup() covers the same rows opportunistically but cannot be relied on alone, since it only runs when someone submits the form.';
