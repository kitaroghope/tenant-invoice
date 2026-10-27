-- Keep classic as the default and expand the available document designs.
alter table public.businesses drop constraint if exists businesses_template_id_check;
alter table public.businesses add constraint businesses_template_id_check
  check (template_id in ('classic', 'modern', 'compact', 'minimal', 'executive', 'ledger', 'ribbon', 'editorial', 'outlined', 'sidebar'));
