-- ============================================================================
-- Part 1: Invoice discounts — either a percentage (basis points, same
-- convention as tax_basis_points) or a fixed cash amount in minor units.
-- Tax is computed on the post-discount subtotal, the common convention.
-- ============================================================================

alter table public.invoices
  add column discount_type text not null default 'none' check (discount_type in ('none', 'percentage', 'fixed')),
  add column discount_value bigint not null default 0 check (discount_value >= 0),
  add column discount_minor_units bigint not null default 0,
  add constraint invoices_discount_value_consistency
    check (discount_type <> 'none' or discount_value = 0);

revoke update on public.invoices from authenticated;
grant update (
  customer_id, customer_display_name, customer_email, customer_phone,
  customer_address_line1, customer_address_line2, customer_city, customer_region,
  customer_postal_code, customer_country_code, customer_tax_id,
  currency_code, currency_exponent, tax_basis_points, discount_type, discount_value,
  due_at, notes, deleted_at, deleted_by, deletion_reason
) on public.invoices to authenticated;

grant insert (
  business_id, customer_id, customer_display_name, customer_email, customer_phone,
  customer_address_line1, customer_address_line2, customer_city, customer_region,
  customer_postal_code, customer_country_code, customer_tax_id,
  currency_code, currency_exponent, tax_basis_points, discount_type, discount_value,
  due_at, notes, created_by
) on public.invoices to authenticated;

create or replace function private.recompute_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  computed_subtotal bigint;
  basis_points integer;
  computed_tax bigint;
  d_type text;
  d_value bigint;
  computed_discount bigint;
  discounted_subtotal bigint;
begin
  select coalesce(sum(line_total_minor_units), 0) into computed_subtotal
  from public.invoice_line_items where invoice_id = p_invoice_id;

  select tax_basis_points, discount_type, discount_value
    into basis_points, d_type, d_value
    from public.invoices where id = p_invoice_id;

  computed_discount := case d_type
    when 'fixed' then least(d_value, computed_subtotal)
    when 'percentage' then least((computed_subtotal * d_value + 5000) / 10000, computed_subtotal)
    else 0
  end;

  discounted_subtotal := computed_subtotal - computed_discount;
  computed_tax := (discounted_subtotal * basis_points + 5000) / 10000;

  update public.invoices
  set subtotal_minor_units = computed_subtotal,
      discount_minor_units = computed_discount,
      tax_minor_units = computed_tax,
      total_minor_units = discounted_subtotal + computed_tax
  where id = p_invoice_id;
end;
$$;

revoke all on function private.recompute_invoice_totals(uuid) from public;

-- Recompute must also re-run when the discount changes, not just the tax rate.
create trigger invoices_recompute_on_discount_change
  after update of discount_type, discount_value on public.invoices
  for each row execute function private.invoice_tax_rate_recompute();

-- ============================================================================
-- Part 2: Standalone receipts. In Uganda (and plenty of other small-business
-- contexts) a lot of transactions never go through a formal invoice — the
-- customer pays on the spot and just wants a receipt. Payments can now exist
-- without an invoice; every payment carries its own customer snapshot instead
-- of relying on a parent invoice for that.
-- ============================================================================

alter table public.payments
  alter column invoice_id drop not null,
  add column customer_display_name text,
  add column customer_email text,
  add column customer_phone text,
  add column currency_exponent smallint;

-- Backfill the snapshot columns for existing invoice-linked payments so every
-- row is consistent going forward, then make the columns required.
update public.payments p
set customer_display_name = i.customer_display_name,
    customer_email = i.customer_email,
    customer_phone = i.customer_phone,
    currency_exponent = i.currency_exponent
from public.invoices i
where p.invoice_id = i.id;

alter table public.payments
  alter column customer_display_name set not null,
  alter column currency_exponent set not null;

-- The existing payments_invoice_idempotency_uidx (invoice_id, idempotency_key) only guards
-- invoice-linked payments: Postgres treats every NULL invoice_id as distinct, so it does not
-- stop two standalone payments from sharing an idempotency_key. This closes that gap —
-- without it, two near-simultaneous identical retries of record_standalone_payment could each
-- pass the RPC's own SELECT-before-INSERT check and create two payment rows.
create unique index payments_standalone_idempotency_uidx
  on public.payments(business_id, idempotency_key)
  where invoice_id is null and idempotency_key is not null;

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  payment_id uuid not null references public.payments(id),
  receipt_number bigint,
  status text not null default 'issued' check (status in ('issued', 'void')),
  issued_at timestamptz not null default now(),
  void_reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index receipts_business_number_uidx
  on public.receipts(business_id, receipt_number) where receipt_number is not null;
-- Only one live receipt per payment at a time; issuing again after a void is fine.
create unique index receipts_payment_active_uidx
  on public.receipts(payment_id) where status = 'issued';
create index receipts_business_id_idx on public.receipts(business_id);

alter table public.receipts enable row level security;
alter table public.receipts force row level security;

-- Same as payments: no receipts.read permission was seeded, so any active member
-- can view receipt history; issuing/voiding are the permission-gated actions.
revoke all on public.receipts from anon, authenticated;
grant select on public.receipts to authenticated;

create policy receipts_read on public.receipts for select to authenticated
  using (business_id in (select private.user_business_ids()));

create trigger receipts_set_updated_at
  before update on public.receipts
  for each row execute function private.set_updated_at();

-- Record a payment that has no invoice behind it.
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
  if length(trim(coalesce(p_customer_display_name, ''))) = 0 then
    raise exception 'Customer name is required';
  end if;
  if p_amount_minor_units <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select id into existing_payment_id
  from public.payments
  where business_id = p_business_id and invoice_id is null and idempotency_key = p_idempotency_key;
  if existing_payment_id is not null then
    return existing_payment_id;
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

-- Copy the customer snapshot onto invoice-linked payments too, so every payment
-- (standalone or not) is self-contained for receipt rendering.
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

-- Issue a receipt for any recorded (non-reversed) payment, standalone or not.
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

create or replace function private.void_receipt_for_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.receipts
  set status = 'void', void_reason = p_reason, updated_at = now()
  where payment_id = p_payment_id and status = 'issued';
end;
$$;

revoke all on function private.void_receipt_for_payment(uuid, text) from public;

-- A payment reversal also voids any receipt issued for it — the receipt no
-- longer represents a valid acknowledged payment.
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  payment record;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  select id, business_id, invoice_id, status into payment
  from public.payments
  where id = p_payment_id
  for update;

  if payment is null then raise exception 'Payment not found'; end if;
  if payment.status = 'reversed' then raise exception 'This payment has already been reversed'; end if;

  if not (select private.has_business_permission(payment.business_id, 'payments.reverse')) then
    raise exception 'You do not have permission to reverse payments for this business';
  end if;

  update public.payments
  set status = 'reversed', reversed_at = now(), reversed_by = caller_id, reversal_reason = p_reason, updated_at = now()
  where id = p_payment_id;

  perform private.void_receipt_for_payment(p_payment_id, 'payment_reversed');

  if payment.invoice_id is not null then
    perform private.recompute_invoice_payment_status(payment.invoice_id);
  end if;

  perform private.record_audit_event(
    payment.business_id, 'business_member', 'payment.reversed', 'payment', p_payment_id,
    jsonb_build_object('invoice_id', payment.invoice_id, 'reason', p_reason)
  );
end;
$$;

revoke all on function public.reverse_payment(uuid, text) from public, anon;
grant execute on function public.reverse_payment(uuid, text) to authenticated;
