
-- Re-queue DLQ'd transactional emails from last 4 days with corrected sender_domain
-- Also generate fresh idempotency_key + message_id + queued_at so email API accepts them
do $$
declare
  rec record;
  new_payload jsonb;
  new_id text;
begin
  for rec in
    select msg_id, message from pgmq.q_transactional_emails_dlq
    where enqueued_at > now() - interval '4 days'
  loop
    new_id := gen_random_uuid()::text;
    new_payload := rec.message
      || jsonb_build_object(
        'sender_domain', 'notify.mail.rexovaan.com',
        'from', 'Rexovaan Shoppie <noreply@notify.mail.rexovaan.com>',
        'idempotency_key', new_id,
        'message_id', new_id,
        'queued_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
    perform pgmq.send('transactional_emails', new_payload);
    perform pgmq.archive('transactional_emails_dlq', rec.msg_id);
  end loop;
end$$;
