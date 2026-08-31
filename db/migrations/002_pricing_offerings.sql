create table if not exists tenant_price_books (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  template_id text not null,
  name text not null,
  currency text not null default 'MYR',
  status text not null check (status in ('draft','active','expired','disabled')),
  effective_date date not null,
  expiry_date date null,
  bidwright_catalog_id text not null,
  bidwright_global_rate_schedule_id text not null,
  product_category_id text not null,
  service_category_id text not null,
  source_sha256 text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index if not exists idx_tenant_price_books_active
  on tenant_price_books(tenant_id,status,effective_date,expiry_date);

create table if not exists bridge_offerings (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique,
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  price_book_id uuid not null references tenant_price_books(id) on delete cascade,
  canonical_code text not null,
  offering_type text not null check (offering_type in ('product','service')),
  name text not null,
  aliases_json jsonb not null default '[]'::jsonb,
  uom text not null,
  bidwright_catalog_item_id text not null,
  bidwright_master_rate_schedule_item_id text null,
  category_binding_key text not null,
  price_disclosure text not null check (price_disclosure in ('allowed','quote_only','range_only','human_only')),
  active boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,price_book_id,canonical_code)
);
create index if not exists idx_bridge_offerings_tenant_type
  on bridge_offerings(tenant_id,offering_type,active);

create table if not exists price_book_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  price_book_id uuid null references tenant_price_books(id) on delete set null,
  source_name text not null,
  source_sha256 text not null,
  status text not null check (status in ('analyzed','validated','provisioning','succeeded','failed')),
  row_count integer not null default 0,
  error_json jsonb null,
  result_json jsonb null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique(tenant_id,source_sha256)
);

create table if not exists price_book_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references bridge_organizations(id) on delete cascade,
  price_book_id uuid not null references tenant_price_books(id) on delete cascade,
  bridge_quote_id uuid not null references bridge_quotes(id) on delete cascade,
  bidwright_project_id text not null,
  bidwright_revision_id text not null,
  bidwright_snapshot_schedule_id text not null,
  snapshot_mapping_json jsonb not null,
  created_at timestamptz not null default now(),
  unique(tenant_id,bridge_quote_id,bidwright_revision_id,price_book_id)
);
