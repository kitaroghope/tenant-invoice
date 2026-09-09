-- Business document email delivery (plan §14/§15): operationally separate from Supabase
-- Auth email. Every send against an invoice or receipt is recorded here with a lifecycle
-- (queued -> sent/failed), and the plan's monthly_email_allowance is enforced the same way
-- monthly_invoice_allowance already is for issue_invoice.

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  resource_type text not null check (resource_type in ('invoice', 'receipt')),
  resource_id uuid not null,
  recipient_email text not null,
  subject text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'bounced', 'failed')),
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index email_messages_business_id_idx on public.email_messages(business_id, created_at desc);
create index email_messages_resource_idx on public.email_messages(resource_type, resource_id);

alter table public.email_messages enable row level security;
alter table public.email_messages force row level security;

-- Same precedent as payments/receipts: no email.read permission was seeded, so any active
-- member can see send history; queuing a send is the permission-gated action (via the
-- resource's own invoices.update / receipts.create permission — sending an invoice or
-- receipt isn't a distinct capability from being able to manage that document).
revoke all on public.email_messages from anon, authenticated;
grant select on public.email_messages to authenticated;

create policy email_messages_read on public.email_messages for select to authenticated
  using (business_id in (select private.user_business_ids()));

-- Counts every send attempt this calendar month, successful or not — an allowance is
-- consumed by the attempt (and the SMTP relay's cost), not just a delivered outcome.
create or replace function private.check_can_send_email(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  plan_allowance integer;
  sent_this_period integer;
begin
  if not private.business_is_active(p_business_id) then
    raise exception 'This business''s subscription is not active. Renew to send emails.';
  end if;

  select p.monthly_email_allowance into plan_allowance
  from public.business_subscriptions bs
  join public.plans p on p.id = bs.plan_id
  where bs.business_id = p_business_id;

  if plan_allowance is not null then
    select count(*) into sent_this_period
    from public.email_messages
    where business_id = p_business_id
      and created_at >= date_trunc('month', now());

    if sent_this_period >= plan_allowance then
      raise exception 'This business has reached its plan''s monthly email allowance (%). Upgrade to send more.', plan_allowance;
    end if;
  end if;
end;
$$;

revoke all on function private.check_can_send_email(uuid) from public;

-- Queues a send: checks permission + entitlement, validates the resource belongs to the
-- business, and inserts the queued row. The actual SMTP send happens in an Edge Function
-- afterwards (nothing in this app talks to an SMTP relay from SQL), which then reports
-- back via mark_email_message_sent below.
create or replace function public.queue_email_message(
  p_business_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_recipient_email text,
  p_subject text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  new_message_id uuid;
  required_permission text;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if p_resource_type not in ('invoice', 'receipt') then raise exception 'Unknown resource type'; end if;
  if p_recipient_email is null or p_recipient_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid recipient email is required';
  end if;

  required_permission := case p_resource_type when 'invoice' then 'invoices.update' else 'receipts.create' end;
  if not (select private.has_business_permission(p_business_id, required_permission)) then
    raise exception 'You do not have permission to send this document for this business';
  end if;

  if p_resource_type = 'invoice' then
    if not exists (select 1 from public.invoices where id = p_resource_id and business_id = p_business_id and deleted_at is null) then
      raise exception 'Invoice not found';
    end if;
  else
    if not exists (select 1 from public.receipts where id = p_resource_id and business_id = p_business_id) then
      raise exception 'Receipt not found';
    end if;
  end if;

  perform private.check_can_send_email(p_business_id);

  insert into public.email_messages (business_id, resource_type, resource_id, recipient_email, subject, created_by)
  values (p_business_id, p_resource_type, p_resource_id, p_recipient_email, p_subject, caller_id)
  returning id into new_message_id;

  return new_message_id;
end;
$$;

revoke all on function public.queue_email_message(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.queue_email_message(uuid, text, uuid, text, text) to authenticated;

-- Reports the outcome of the actual SMTP send back onto the queued row. Restricted to the
-- same caller who queued it (created_by = auth.uid()) — this is a status callback for one
-- specific send attempt, not a general moderation action.
create or replace function public.mark_email_message_sent(
  p_message_id uuid,
  p_success boolean,
  p_provider_message_id text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  update public.email_messages
  set status = case when p_success then 'sent' else 'failed' end,
      sent_at = case when p_success then now() else sent_at end,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      error_message = p_error_message
  where id = p_message_id and created_by = caller_id and status = 'queued';

  if not found then
    raise exception 'Email message not found or already resolved';
  end if;
end;
$$;

revoke all on function public.mark_email_message_sent(uuid, boolean, text, text) from public, anon;
grant execute on function public.mark_email_message_sent(uuid, boolean, text, text) to authenticated;
