-- Track how much of an invoice has been paid. Only ever written by record_payment /
-- reverse_payment below — never a direct client update, so no column-grant restriction
-- is needed here the way invoices.total_minor_units needed one.
alter table public.invoices
  add column amount_paid_minor_units bigint not null default 0;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  invoice_id uuid not null references public.invoices(id),
  amount_minor_units bigint not null check (amount_minor_units > 0),
  currency_code text not null references public.currencies(code),
  payment_method text not null default 'other' check (payment_method in ('cash', 'bank_transfer', 'mobile_money', 'card', 'other')),
  reference text,
  notes text,
  paid_at timestamptz not null default now(),
  status text not null default 'recorded' check (status in ('recorded', 'reversed')),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  idempotency_key uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_invoice_id_idx on public.payments(invoice_id);
create index payments_business_id_idx on public.payments(business_id);
create unique index payments_invoice_idempotency_uidx
  on public.payments(invoice_id, idempotency_key) where idempotency_key is not null;

alter table public.payments enable row level security;
alter table public.payments force row level security;

-- No insert/update/delete grants at all: payments are only ever written through
-- record_payment and reverse_payment. Any active business member can read payment
-- history (no payments.read permission was defined — recording/reversing are the
-- permission-gated actions; viewing is a base membership right, same as audit history
-- would be if it had one).
revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

create policy payments_read on public.payments for select to authenticated
  using (business_id in (select private.user_business_ids()));

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function private.set_updated_at();

-- Recomputes an invoice's paid amount from its active (non-reversed) payments and
-- derives status from it. Never touches subtotal/tax/total — those stay whatever
-- issuance produced.
create or replace function private.recompute_invoice_payment_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_paid bigint;
  invoice_total bigint;
begin
  select coalesce(sum(amount_minor_units), 0) into total_paid
  from public.payments
  where invoice_id = p_invoice_id and status = 'recorded';

  select total_minor_units into invoice_total from public.invoices where id = p_invoice_id;

  update public.invoices
  set amount_paid_minor_units = total_paid,
      status = case
        when total_paid >= invoice_total and invoice_total > 0 then 'paid'
        when total_paid > 0 then 'partially_paid'
        else 'issued'
      end,
      updated_at = now()
  where id = p_invoice_id
    and status in ('issued', 'sent', 'partially_paid', 'paid');
end;
$$;

revoke all on function private.recompute_invoice_payment_status(uuid) from public;

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

  select id, business_id, currency_code, status into invoice
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
    return existing_payment_id; -- already recorded by this exact request
  end if;

  if invoice.status not in ('issued', 'sent', 'partially_paid') then
    raise exception 'Payments can only be recorded against an issued, unpaid invoice';
  end if;

  if p_amount_minor_units <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  insert into public.payments
    (business_id, invoice_id, amount_minor_units, currency_code, payment_method, reference, notes, idempotency_key, created_by)
  values
    (invoice.business_id, p_invoice_id, p_amount_minor_units, invoice.currency_code,
     coalesce(p_payment_method, 'other'), p_reference, p_notes, p_idempotency_key, caller_id)
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

  perform private.recompute_invoice_payment_status(payment.invoice_id);

  perform private.record_audit_event(
    payment.business_id, 'business_member', 'payment.reversed', 'payment', p_payment_id,
    jsonb_build_object('invoice_id', payment.invoice_id, 'reason', p_reason)
  );
end;
$$;

revoke all on function public.reverse_payment(uuid, text) from public, anon;
grant execute on function public.reverse_payment(uuid, text) to authenticated;
