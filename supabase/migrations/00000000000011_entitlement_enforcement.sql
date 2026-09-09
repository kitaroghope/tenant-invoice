-- Extends subscription entitlement enforcement beyond issue_invoice: any mutation that
-- transacts on behalf of a business should refuse once that business's subscription has
-- lapsed (past_due is still a grace period, handled by private.business_is_active), and
-- team growth should respect the plan's max_team_members. monthly_invoice_allowance stays
-- scoped to issue_invoice — payments/receipts don't create new invoices, so they aren't
-- counted against it.

create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount_minor_units bigint,
  p_payment_method text,
  p_reference text,
  p_notes text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  invoice record;
  existing_payment_id uuid;
  new_payment_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  select id, business_id, currency_code, currency_exponent, status,
         customer_display_name, customer_email, customer_phone
    into invoice
  from public.invoices
  where id = p_invoice_id and deleted_at is null
  for update;

  if invoice is null then raise exception 'Invoice not found'; end if;

  if not (select private.has_business_permission(invoice.business_id, 'payments.record')) then
    raise exception 'You do not have permission to record payments for this business';
  end if;

  select id into existing_payment_id
  from public.payments
  where invoice_id = p_invoice_id and idempotency_key = p_idempotency_key;
  if existing_payment_id is not null then
    return existing_payment_id;
  end if;

  if not private.business_is_active(invoice.business_id) then
    raise exception 'This business''s subscription is not active. Renew to record payments.';
  end if;

  if invoice.status not in ('issued', 'sent', 'partially_paid') then
    raise exception 'Payments can only be recorded against an issued, unpaid invoice';
  end if;

  if p_amount_minor_units <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  insert into public.payments
    (business_id, invoice_id, customer_display_name, customer_email, customer_phone,
     amount_minor_units, currency_code, currency_exponent, payment_method, reference, notes,
     idempotency_key, created_by)
  values
    (invoice.business_id, p_invoice_id, invoice.customer_display_name, invoice.customer_email, invoice.customer_phone,
     p_amount_minor_units, invoice.currency_code, invoice.currency_exponent, coalesce(p_payment_method, 'other'),
     p_reference, p_notes, p_idempotency_key, caller_id)
  returning id into new_payment_id;

  perform private.recompute_invoice_payment_status(p_invoice_id);

  perform private.record_audit_event(
    invoice.business_id, 'business_member', 'payment.recorded', 'payment', new_payment_id,
    jsonb_build_object('invoice_id', p_invoice_id, 'amount_minor_units', p_amount_minor_units)
  );

  return new_payment_id;
end;
$$;

revoke all on function public.record_payment(uuid, bigint, text, text, text, uuid) from public, anon;
grant execute on function public.record_payment(uuid, bigint, text, text, text, uuid) to authenticated;

create or replace function public.record_standalone_payment(
  p_business_id uuid,
  p_customer_display_name text,
  p_customer_email text,
  p_customer_phone text,
  p_amount_minor_units bigint,
  p_currency_code text,
  p_currency_exponent smallint,
  p_payment_method text,
  p_reference text,
  p_notes text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  existing_payment_id uuid;
  new_payment_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not (select private.has_business_permission(p_business_id, 'payments.record')) then
    raise exception 'You do not have permission to record payments for this business';
  end if;

  select id into existing_payment_id
  from public.payments
  where business_id = p_business_id and invoice_id is null and idempotency_key = p_idempotency_key;
  if existing_payment_id is not null then
    return existing_payment_id;
  end if;

  if not private.business_is_active(p_business_id) then
    raise exception 'This business''s subscription is not active. Renew to record payments.';
  end if;
  if length(trim(coalesce(p_customer_display_name, ''))) = 0 then
    raise exception 'Customer name is required';
  end if;
  if p_amount_minor_units <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  begin
    insert into public.payments
      (business_id, invoice_id, customer_display_name, customer_email, customer_phone,
       amount_minor_units, currency_code, currency_exponent, payment_method, reference, notes,
       idempotency_key, created_by)
    values
      (p_business_id, null, trim(p_customer_display_name), p_customer_email, p_customer_phone,
       p_amount_minor_units, p_currency_code, p_currency_exponent, coalesce(p_payment_method, 'other'),
       p_reference, p_notes, p_idempotency_key, caller_id)
    returning id into new_payment_id;
  exception
    when unique_violation then
      select id into new_payment_id
      from public.payments
      where business_id = p_business_id and invoice_id is null and idempotency_key = p_idempotency_key;
      return new_payment_id;
  end;

  perform private.record_audit_event(
    p_business_id, 'business_member', 'payment.recorded', 'payment', new_payment_id,
    jsonb_build_object('amount_minor_units', p_amount_minor_units, 'standalone', true)
  );

  return new_payment_id;
end;
$$;

revoke all on function public.record_standalone_payment(uuid, text, text, text, bigint, text, smallint, text, text, text, uuid) from public, anon;
grant execute on function public.record_standalone_payment(uuid, text, text, text, bigint, text, smallint, text, text, text, uuid) to authenticated;

create or replace function public.issue_receipt(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  payment record;
  allocated bigint;
  new_receipt_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  select id, business_id, status into payment from public.payments where id = p_payment_id for update;
  if payment is null then raise exception 'Payment not found'; end if;

  if not (select private.has_business_permission(payment.business_id, 'receipts.create')) then
    raise exception 'You do not have permission to issue receipts for this business';
  end if;

  if not private.business_is_active(payment.business_id) then
    raise exception 'This business''s subscription is not active. Renew to issue receipts.';
  end if;

  if payment.status <> 'recorded' then
    raise exception 'Only an active (non-reversed) payment can receive a receipt';
  end if;

  if exists (select 1 from public.receipts where payment_id = p_payment_id and status = 'issued') then
    raise exception 'This payment already has an active receipt';
  end if;

  allocated := private.allocate_document_number(payment.business_id, 'receipt');

  insert into public.receipts (business_id, payment_id, receipt_number, created_by)
  values (payment.business_id, p_payment_id, allocated, caller_id)
  returning id into new_receipt_id;

  perform private.record_audit_event(
    payment.business_id, 'business_member', 'receipt.created', 'receipt', new_receipt_id,
    jsonb_build_object('payment_id', p_payment_id, 'receipt_number', allocated)
  );

  return new_receipt_id;
end;
$$;

revoke all on function public.issue_receipt(uuid) from public, anon;
grant execute on function public.issue_receipt(uuid) to authenticated;

-- Team-size cap: counts active + still-pending (invited) memberships, since a pending
-- invitation is a claim on a seat the moment it's sent, not just once accepted.
create or replace function public.create_invitation(
  p_business_id uuid,
  p_user_id uuid,
  p_role_id uuid
)
returns table (membership_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  new_membership_id uuid;
  raw_token text;
  plan_max_members integer;
  current_member_count integer;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not (select private.has_business_permission(p_business_id, 'members.manage')) then
    raise exception 'You do not have permission to invite members to this business';
  end if;
  if not private.business_is_active(p_business_id) then
    raise exception 'This business''s subscription is not active. Renew to invite members.';
  end if;
  if not exists (
    select 1 from public.roles
    where id = p_role_id and deleted_at is null
      and (business_id is null or business_id = p_business_id)
  ) then
    raise exception 'Invalid role for this business';
  end if;

  select p.max_team_members into plan_max_members
  from public.business_subscriptions bs
  join public.plans p on p.id = bs.plan_id
  where bs.business_id = p_business_id;

  if plan_max_members is not null then
    select count(*) into current_member_count
    from public.business_memberships
    where business_id = p_business_id
      and deleted_at is null
      and status in ('active', 'invited');

    if current_member_count >= plan_max_members then
      raise exception 'This business has reached its plan''s team member limit (%). Upgrade to invite more.', plan_max_members;
    end if;
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  begin
    insert into public.business_memberships
      (business_id, user_id, role_id, status, invited_by, invited_at, invitation_token_hash, invitation_expires_at)
    values
      (p_business_id, p_user_id, p_role_id, 'invited', caller_id, now(),
       encode(extensions.digest(raw_token, 'sha256'), 'hex'), now() + interval '7 days')
    returning id into new_membership_id;
  exception
    when unique_violation then
      raise exception 'This person already has an active or pending membership in this business';
  end;

  perform private.record_audit_event(
    p_business_id, 'business_member', 'member.invited', 'business_membership', new_membership_id,
    jsonb_build_object('role_id', p_role_id)
  );

  return query select new_membership_id, raw_token;
end;
$$;

revoke all on function public.create_invitation(uuid, uuid, uuid) from public, anon;
grant execute on function public.create_invitation(uuid, uuid, uuid) to authenticated;
