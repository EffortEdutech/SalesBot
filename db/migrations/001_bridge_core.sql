create extension if not exists pgcrypto;

create table if not exists bridge_organizations (
  id text primary key,
  name text not null,
  legal_name text null,
  industry text not null,
  currency text not null default 'MYR',
  timezone text not null default 'Asia/Kuala_Lumpur',
  status text not null default 'active' check (status in ('active','disabled','pending')),
  dograh_org_id text null,
  bidwright_org_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bridge_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  provider text not null,
  base_url text null,
  credential_reference text null,
  service_user_reference text null,
  provider_version text null,
  status text not null default 'active' check (status in ('active','disabled','error')),
  last_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table if not exists bridge_api_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  role text not null check (role in ('platform_admin','tenant_owner','estimator','staff','viewer','ai_runtime')),
  scopes jsonb not null default '[]'::jsonb,
  expires_at timestamptz null,
  revoked_at timestamptz null,
  last_used_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists bridge_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  name text not null,
  phone text null,
  email text null,
  address jsonb not null default '{}'::jsonb,
  external_dograh_id text null,
  external_bidwright_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bridge_customers_tenant_phone on bridge_customers(tenant_id,phone);
create index if not exists idx_bridge_customers_tenant_email on bridge_customers(tenant_id,email);

create table if not exists bridge_intakes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  customer_id uuid null references bridge_customers(id) on delete set null,
  source_channel text not null,
  dograh_workflow_id text null,
  dograh_workflow_run_id text null,
  service_intent text null,
  requirements_json jsonb not null default '{}'::jsonb,
  location_json jsonb not null default '{}'::jsonb,
  notes text null,
  status text not null default 'captured',
  confidence numeric(6,5) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bridge_intakes_tenant_created on bridge_intakes(tenant_id,created_at desc);
create index if not exists idx_bridge_intakes_dograh_run on bridge_intakes(tenant_id,dograh_workflow_run_id);

create table if not exists bridge_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  intake_id uuid null references bridge_intakes(id) on delete set null,
  bidwright_project_id text null,
  bidwright_quote_id text null,
  bidwright_revision_id text null,
  bidwright_worksheet_id text null,
  bidwright_rate_schedule_snapshot_id text null,
  revision_number integer not null default 0,
  status text not null default 'captured' check (status in (
    'captured','estimating','needs_review','draft','pending_approval',
    'changes_requested','rejected','approved','delivery_pending',
    'sent','delivery_failed','cancelled','expired','upstream_unknown'
  )),
  approval_status text null,
  currency text not null default 'MYR',
  subtotal numeric(18,2) null,
  markup numeric(18,2) null,
  tax numeric(18,2) null,
  grand_total numeric(18,2) null,
  calculation_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bridge_quotes_tenant_status on bridge_quotes(tenant_id,status,created_at desc);
create unique index if not exists uq_bridge_quotes_bidwright_project_revision
  on bridge_quotes(tenant_id,bidwright_project_id,bidwright_revision_id)
  where bidwright_project_id is not null and bidwright_revision_id is not null;

create table if not exists bridge_quote_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  quote_id uuid not null references bridge_quotes(id) on delete cascade,
  offering_ref text null,
  item_type text not null check (item_type in ('product','service','other')),
  bidwright_item_id text null,
  bidwright_rate_schedule_item_id text null,
  description text not null,
  quantity numeric(18,4) not null,
  uom text not null,
  unit_price numeric(18,2) null,
  extended_price numeric(18,2) null,
  source text not null default 'bidwright',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bridge_quote_items_quote on bridge_quote_items(tenant_id,quote_id);

create table if not exists bridge_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  quote_id uuid not null references bridge_quotes(id) on delete cascade,
  bidwright_revision_id text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','changes_requested','superseded')),
  requested_by text null,
  approved_by text null,
  rejected_by text null,
  change_request text null,
  calculation_hash text null,
  requested_at timestamptz not null default now(),
  approved_at timestamptz null,
  rejected_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bridge_approvals_quote on bridge_approvals(tenant_id,quote_id,status);

create table if not exists bridge_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  quote_id uuid not null references bridge_quotes(id) on delete cascade,
  bidwright_revision_id text not null,
  channel text not null,
  recipient text not null,
  pdf_sha256 text null,
  status text not null default 'delivery_pending' check (status in ('delivery_pending','processing','sent','failed')),
  provider_message_id text null,
  attempt_count integer not null default 0,
  last_error text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_bridge_delivery_content
  on bridge_deliveries(tenant_id,quote_id,bidwright_revision_id,channel,recipient,coalesce(pdf_sha256,''));

create table if not exists bridge_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  idempotency_key text not null,
  operation_type text not null,
  request_hash text not null,
  status text not null check (status in ('reserved','executing','upstream_unknown','succeeded','failed_retriable','failed_terminal')),
  current_step text null,
  bridge_resource_id text null,
  bidwright_project_id text null,
  bidwright_quote_id text null,
  bidwright_revision_id text null,
  response_json jsonb null,
  last_error_code text null,
  last_error_json jsonb null,
  attempt_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique(tenant_id,idempotency_key)
);
create index if not exists idx_bridge_operations_recovery on bridge_operations(tenant_id,status,updated_at);

create table if not exists bridge_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  source text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_bridge_events_aggregate on bridge_events(tenant_id,aggregate_type,aggregate_id,created_at);

create table if not exists bridge_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  actor_type text not null check (actor_type in ('human','ai','system','provider')),
  actor_id text null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_bridge_audit_resource on bridge_audit_log(tenant_id,resource_type,resource_id,created_at);

create table if not exists tenant_template_bindings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  template_id text not null,
  binding_key text not null,
  binding_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,template_id,binding_key)
);
