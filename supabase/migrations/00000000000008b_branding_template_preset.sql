alter table public.businesses
  add column template_id text not null default 'classic' check (template_id in ('classic', 'modern', 'compact'));

revoke update on public.businesses from authenticated;
grant update (
  legal_name, trading_name, default_currency_code, locale, timezone,
  address_line1, address_line2, city, region, postal_code, country_code, tax_id,
  invoice_prefix, receipt_prefix, payment_instructions, accent_color, logo_asset_path, template_id
) on public.businesses to authenticated;
