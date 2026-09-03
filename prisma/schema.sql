-- ---------------------------------------------------------------------------
-- SupplyGuard-AI — Supabase / PostgreSQL schema
--
-- Multi-tenant isolation strategy:
--   Every row-owning table carries a `tenant_id` column. Row Level Security
--   (RLS) is enabled on every table and policies compare `tenant_id` against
--   `public.user_tenant_id()`, which reads the `tenant_id` custom claim off
--   the caller's JWT (`request.jwt.claims`). Application code authenticated
--   with the Supabase anon/user key is therefore automatically scoped to a
--   single tenant; server-side code using the service role key bypasses RLS
--   by design and MUST filter by tenant_id explicitly (see src/mcp/*).
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- public.user_tenant_id()
-- Extracts the `tenant_id` claim from the current request's JWT.
-- ---------------------------------------------------------------------------
create or replace function public.user_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'tenant_id', '')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- product_batches
-- Inventory batches tracked for First-Expired-First-Out (FEFO) auditing.
-- ---------------------------------------------------------------------------
create table if not exists public.product_batches (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  product_id        uuid not null,
  product_name      text not null,
  supplier_id       uuid not null,
  supplier_name     text not null,
  batch_number      text not null,
  quantity          numeric(12, 2) not null check (quantity >= 0),
  unit_cost         numeric(12, 4) not null check (unit_cost >= 0),
  unit               text not null default 'unit',
  expiration_date   date not null,
  received_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists product_batches_tenant_idx on public.product_batches (tenant_id);
create index if not exists product_batches_expiration_idx on public.product_batches (tenant_id, expiration_date);
create index if not exists product_batches_supplier_idx on public.product_batches (tenant_id, supplier_id, product_id);

alter table public.product_batches enable row level security;

create policy product_batches_tenant_isolation
  on public.product_batches
  for all
  using (tenant_id = public.user_tenant_id())
  with check (tenant_id = public.user_tenant_id());

-- ---------------------------------------------------------------------------
-- purchasing_orders
-- Purchase orders drafted, reviewed and committed by the agent workflow.
-- ---------------------------------------------------------------------------
create type public.purchasing_order_status as enum (
  'draft',
  'pending_approval',
  'committed',
  'rejected'
);

create table if not exists public.purchasing_orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  thread_id         text not null,
  product_id        uuid not null,
  product_name      text not null,
  supplier_id       uuid not null,
  supplier_name     text not null,
  quantity          numeric(12, 2) not null check (quantity > 0),
  unit_cost         numeric(12, 4) not null check (unit_cost >= 0),
  total_cost        numeric(14, 4) generated always as (quantity * unit_cost) stored,
  status            public.purchasing_order_status not null default 'draft',
  rationale         text,
  price_variance_pct numeric(6, 2),
  created_by_agent  text not null default 'purchasing_agent',
  approved_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  committed_at      timestamptz
);

create index if not exists purchasing_orders_tenant_idx on public.purchasing_orders (tenant_id);
create index if not exists purchasing_orders_thread_idx on public.purchasing_orders (tenant_id, thread_id);
create index if not exists purchasing_orders_status_idx on public.purchasing_orders (tenant_id, status);

alter table public.purchasing_orders enable row level security;

create policy purchasing_orders_tenant_isolation
  on public.purchasing_orders
  for all
  using (tenant_id = public.user_tenant_id())
  with check (tenant_id = public.user_tenant_id());

-- ---------------------------------------------------------------------------
-- agent_tasks
-- Execution log / thread registry for LangGraph runs (audit trail of every
-- node invocation, keyed by thread_id for HITL resumption).
-- ---------------------------------------------------------------------------
create type public.agent_task_status as enum (
  'running',
  'input-required',
  'completed',
  'rejected',
  'failed'
);

create table if not exists public.agent_tasks (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  thread_id         text not null,
  agent_name        text not null,
  node_name         text not null,
  status            public.agent_task_status not null default 'running',
  input             jsonb,
  output            jsonb,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists agent_tasks_tenant_idx on public.agent_tasks (tenant_id);
create index if not exists agent_tasks_thread_idx on public.agent_tasks (tenant_id, thread_id);

alter table public.agent_tasks enable row level security;

create policy agent_tasks_tenant_isolation
  on public.agent_tasks
  for all
  using (tenant_id = public.user_tenant_id())
  with check (tenant_id = public.user_tenant_id());

-- ---------------------------------------------------------------------------
-- updated_at maintenance trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger product_batches_set_updated_at
  before update on public.product_batches
  for each row execute function public.set_updated_at();

create trigger purchasing_orders_set_updated_at
  before update on public.purchasing_orders
  for each row execute function public.set_updated_at();

create trigger agent_tasks_set_updated_at
  before update on public.agent_tasks
  for each row execute function public.set_updated_at();
