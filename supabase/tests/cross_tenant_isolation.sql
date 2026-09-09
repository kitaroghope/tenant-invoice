-- Cross-tenant isolation test suite (plan §22, "Definition of ready for public launch":
-- "Cross-tenant isolation tests pass for every exposed table and Storage operation").
--
-- Creates two fully independent businesses (owned by two fresh throwaway auth.users rows,
-- created and rolled back within this same transaction — never the operator's own real
-- account, which may carry platform-admin grants that would confound the assertions
-- below), seeds one row of everything into each, then proves — as the owner of Business
-- A — that:
--   1. every business-scoped table is invisible for Business B's rows (SELECT filters them
--      out silently, exactly like RLS is supposed to)
--   2. writing into Business B's rows is rejected, whether via direct table access (RLS
--      policy violation) or via a SECURITY DEFINER RPC (explicit permission check)
--   3. the anon role — no session at all — sees nothing anywhere
--
-- Entirely rollback-safe: wrap the whole file in BEGIN/ROLLBACK (or run it as-is, since it
-- ends in ROLLBACK) and nothing it does — including the temporary auth.users row — persists.
-- Re-run this after any schema change that touches RLS policies or adds a new tenant-scoped
-- table; a new table with no isolation assertion added here is a silent gap, not a pass.

begin;

do $$
declare
  owner_a uuid;
  owner_b uuid;
  biz_a uuid;
  biz_b uuid;
  owner_role_id uuid;
  customer_a uuid; customer_b uuid;
  product_a uuid; product_b uuid;
  price_a uuid; price_b uuid;
  invoice_a uuid; invoice_b uuid;
  line_a uuid; line_b uuid;
  payment_a uuid; payment_b uuid;
  receipt_a uuid; receipt_b uuid;
  email_a uuid; email_b uuid;
  leaked bigint;
  affected integer;
begin
  -- Both tenants are owned by fresh throwaway accounts, never the operator's real one —
  -- a real account may have been separately granted platform-admin access (which
  -- deliberately grants cross-tenant visibility), and that would confound this suite's
  -- assertions about ordinary tenant isolation.
  owner_a := gen_random_uuid();
  insert into auth.users (id, email) values (owner_a, 'tenant-a-isolation-test@example.invalid');
  owner_b := gen_random_uuid();
  insert into auth.users (id, email) values (owner_b, 'tenant-b-isolation-test@example.invalid');

  select id into owner_role_id from public.roles where code = 'owner' and business_id is null;

  -- ===== Seed Business A (owner_a) =====
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  biz_a := public.create_business('Tenant A Co', 'Tenant A', 'UGX', 'en-UG', 'Africa/Kampala');

  insert into public.customers (business_id, display_name, email, created_by)
    values (biz_a, 'Customer A', 'customer-a@example.invalid', owner_a) returning id into customer_a;
  insert into public.products (business_id, name, created_by)
    values (biz_a, 'Product A', owner_a) returning id into product_a;
  insert into public.product_prices (business_id, product_id, currency_code, unit_price_minor_units)
    values (biz_a, product_a, 'UGX', 1000) returning id into price_a;

  insert into public.invoices (business_id, customer_id, customer_display_name, currency_code, currency_exponent, tax_basis_points, created_by)
    values (biz_a, customer_a, 'Customer A', 'UGX', 0, 0, owner_a) returning id into invoice_a;
  insert into public.invoice_line_items (invoice_id, business_id, description, quantity, unit_price_minor_units)
    values (invoice_a, biz_a, 'Line A', 1, 5000) returning id into line_a;
  perform public.issue_invoice(invoice_a, gen_random_uuid());

  payment_a := public.record_payment(invoice_a, 5000, 'cash', null, null, gen_random_uuid());
  receipt_a := public.issue_receipt(payment_a);
  email_a := public.queue_email_message(biz_a, 'invoice', invoice_a, 'customer-a@example.invalid', 'Invoice A');

  -- ===== Seed Business B (owner_b) =====
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  biz_b := public.create_business('Tenant B Co', 'Tenant B', 'UGX', 'en-UG', 'Africa/Kampala');

  insert into public.customers (business_id, display_name, email, created_by)
    values (biz_b, 'Customer B', 'customer-b@example.invalid', owner_b) returning id into customer_b;
  insert into public.products (business_id, name, created_by)
    values (biz_b, 'Product B', owner_b) returning id into product_b;
  insert into public.product_prices (business_id, product_id, currency_code, unit_price_minor_units)
    values (biz_b, product_b, 'UGX', 2000) returning id into price_b;

  insert into public.invoices (business_id, customer_id, customer_display_name, currency_code, currency_exponent, tax_basis_points, created_by)
    values (biz_b, customer_b, 'Customer B', 'UGX', 0, 0, owner_b) returning id into invoice_b;
  insert into public.invoice_line_items (invoice_id, business_id, description, quantity, unit_price_minor_units)
    values (invoice_b, biz_b, 'Line B', 1, 9000) returning id into line_b;
  perform public.issue_invoice(invoice_b, gen_random_uuid());

  payment_b := public.record_payment(invoice_b, 9000, 'cash', null, null, gen_random_uuid());
  receipt_b := public.issue_receipt(payment_b);
  email_b := public.queue_email_message(biz_b, 'invoice', invoice_b, 'customer-b@example.invalid', 'Invoice B');

  raise notice 'PASS: both tenants seeded with one row in every business-scoped table';

  -- ===== Read isolation: acting as owner_a, Business B must be completely invisible =====
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into leaked from public.businesses where id = biz_b;
  if leaked <> 0 then raise exception 'FAIL: businesses leaked Business B to owner_a'; end if;

  select count(*) into leaked from public.business_memberships where business_id = biz_b;
  if leaked <> 0 then raise exception 'FAIL: business_memberships leaked Business B'; end if;

  select count(*) into leaked from public.business_currencies where business_id = biz_b;
  if leaked <> 0 then raise exception 'FAIL: business_currencies leaked Business B'; end if;

  select count(*) into leaked from public.business_subscriptions where business_id = biz_b;
  if leaked <> 0 then raise exception 'FAIL: business_subscriptions leaked Business B'; end if;

  select count(*) into leaked from public.audit_events where business_id = biz_b;
  if leaked <> 0 then raise exception 'FAIL: audit_events leaked Business B'; end if;

  select count(*) into leaked from public.customers where id = customer_b;
  if leaked <> 0 then raise exception 'FAIL: customers leaked Business B''s customer'; end if;

  select count(*) into leaked from public.products where id = product_b;
  if leaked <> 0 then raise exception 'FAIL: products leaked Business B''s product'; end if;

  select count(*) into leaked from public.product_prices where id = price_b;
  if leaked <> 0 then raise exception 'FAIL: product_prices leaked Business B''s price'; end if;

  select count(*) into leaked from public.invoices where id = invoice_b;
  if leaked <> 0 then raise exception 'FAIL: invoices leaked Business B''s invoice'; end if;

  select count(*) into leaked from public.invoice_line_items where id = line_b;
  if leaked <> 0 then raise exception 'FAIL: invoice_line_items leaked Business B''s line'; end if;

  select count(*) into leaked from public.payments where id = payment_b;
  if leaked <> 0 then raise exception 'FAIL: payments leaked Business B''s payment'; end if;

  select count(*) into leaked from public.receipts where id = receipt_b;
  if leaked <> 0 then raise exception 'FAIL: receipts leaked Business B''s receipt'; end if;

  select count(*) into leaked from public.email_messages where id = email_b;
  if leaked <> 0 then raise exception 'FAIL: email_messages leaked Business B''s message'; end if;

  raise notice 'PASS: every business-scoped table is invisible for Business B when queried as owner_a';

  -- ===== Write isolation: direct table access =====
  begin
    insert into public.customers (business_id, display_name, created_by) values (biz_b, 'Hostile insert', owner_a);
    raise exception 'FAIL: owner_a should not be able to insert a customer into Business B';
  exception
    when insufficient_privilege or others then
      if sqlerrm like '%row-level security%' or sqlerrm like '%permission%' then
        raise notice 'PASS: cross-tenant customer insert rejected by RLS';
      else
        raise exception 'FAIL (unexpected error on hostile insert): %', sqlerrm;
      end if;
  end;

  update public.products set name = 'Renamed by owner_a' where id = product_b;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: owner_a was able to update Business B''s product'; end if;
  raise notice 'PASS: cross-tenant product update silently matched zero rows';

  delete from public.invoice_line_items where id = line_b;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: owner_a was able to delete Business B''s invoice line'; end if;
  raise notice 'PASS: cross-tenant invoice line delete silently matched zero rows';

  -- ===== Write isolation: SECURITY DEFINER RPC boundary =====
  begin
    perform public.record_payment(invoice_b, 1, 'cash', null, null, gen_random_uuid());
    raise exception 'FAIL: owner_a should not be able to record a payment against Business B''s invoice';
  exception
    when others then
      if sqlerrm like '%permission%' then
        raise notice 'PASS: cross-tenant record_payment rejected';
      else
        raise exception 'FAIL (record_payment): %', sqlerrm;
      end if;
  end;

  begin
    perform public.issue_receipt(payment_b);
    raise exception 'FAIL: owner_a should not be able to issue a receipt for Business B''s payment';
  exception
    when others then
      if sqlerrm like '%permission%' then
        raise notice 'PASS: cross-tenant issue_receipt rejected';
      else
        raise exception 'FAIL (issue_receipt): %', sqlerrm;
      end if;
  end;

  begin
    perform public.create_invitation(biz_b, owner_a, owner_role_id);
    raise exception 'FAIL: owner_a should not be able to invite themselves into Business B';
  exception
    when others then
      if sqlerrm like '%permission%' then
        raise notice 'PASS: cross-tenant create_invitation rejected';
      else
        raise exception 'FAIL (create_invitation): %', sqlerrm;
      end if;
  end;

  begin
    perform public.queue_email_message(biz_b, 'invoice', invoice_b, 'attacker@example.invalid', 'Hostile send');
    raise exception 'FAIL: owner_a should not be able to queue an email against Business B''s invoice';
  exception
    when others then
      if sqlerrm like '%permission%' then
        raise notice 'PASS: cross-tenant queue_email_message rejected';
      else
        raise exception 'FAIL (queue_email_message): %', sqlerrm;
      end if;
  end;

  begin
    perform public.admin_suspend_business(biz_b, 'not a platform admin');
    raise exception 'FAIL: a non-platform-admin owner should not be able to suspend any business';
  exception
    when others then
      if sqlerrm like '%Platform admin access required%' then
        raise notice 'PASS: cross-tenant admin_suspend_business rejected (not a platform admin)';
      else
        raise exception 'FAIL (admin_suspend_business): %', sqlerrm;
      end if;
  end;

  -- ===== Anon: no session at all sees nothing =====
  -- Anon has no GRANT at all on these tables (belt-and-suspenders alongside RLS), so the
  -- expected outcome is a hard "permission denied" rather than a silently empty result —
  -- both count as proof of zero access; either is accepted as a pass here.
  reset role;
  set local role anon;

  begin
    select count(*) into leaked from public.businesses;
    if leaked <> 0 then raise exception 'FAIL: anon role can read businesses'; end if;
  exception
    when insufficient_privilege then raise notice 'PASS: anon has no grant on businesses';
  end;

  begin
    select count(*) into leaked from public.customers;
    if leaked <> 0 then raise exception 'FAIL: anon role can read customers'; end if;
  exception
    when insufficient_privilege then raise notice 'PASS: anon has no grant on customers';
  end;

  begin
    select count(*) into leaked from public.invoices;
    if leaked <> 0 then raise exception 'FAIL: anon role can read invoices'; end if;
  exception
    when insufficient_privilege then raise notice 'PASS: anon has no grant on invoices';
  end;

  begin
    select count(*) into leaked from public.payments;
    if leaked <> 0 then raise exception 'FAIL: anon role can read payments'; end if;
  exception
    when insufficient_privilege then raise notice 'PASS: anon has no grant on payments';
  end;

  begin
    select count(*) into leaked from public.email_messages;
    if leaked <> 0 then raise exception 'FAIL: anon role can read email_messages'; end if;
  exception
    when insufficient_privilege then raise notice 'PASS: anon has no grant on email_messages';
  end;

  raise notice 'PASS: anon role sees nothing across every checked table';

  reset role;
  raise notice 'ALL CROSS-TENANT ISOLATION TESTS PASSED';
end $$;

rollback;
