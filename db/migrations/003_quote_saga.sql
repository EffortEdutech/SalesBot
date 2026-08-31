alter table bridge_operations
  add column if not exists lease_owner text null,
  add column if not exists lease_expires_at timestamptz null;

alter table bridge_quotes
  add column if not exists quote_number text null,
  add column if not exists title text null,
  add column if not exists scope text null,
  add column if not exists provider_correlation text null,
  add column if not exists validation_json jsonb not null default '{}'::jsonb;

create index if not exists idx_bridge_quotes_provider_correlation
  on bridge_quotes(tenant_id,provider_correlation)
  where provider_correlation is not null;

create unique index if not exists uq_bridge_quote_items_offering
  on bridge_quote_items(tenant_id,quote_id,offering_ref,uom)
  where offering_ref is not null;

create unique index if not exists uq_bridge_intakes_dograh_run
  on bridge_intakes(tenant_id,dograh_workflow_run_id)
  where dograh_workflow_run_id is not null;
