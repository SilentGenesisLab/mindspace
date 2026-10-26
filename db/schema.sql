-- Mindspace schema. Idempotent: safe to run on every deploy.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  nickname text not null,
  color text not null default '#57d4ff',
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists otp_codes (
  id bigserial primary key,
  phone text not null,
  code text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists otp_phone_idx on otp_codes (phone, created_at desc);

create table if not exists spaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  direction text not null default '',
  invite_code text not null unique,
  owner_id uuid not null references users(id) on delete cascade,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists space_members (
  space_id uuid not null references spaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'brainstormer' check (role in ('owner', 'collector', 'brainstormer')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists clusters (
  id uuid primary key,
  space_id uuid not null references spaces(id) on delete cascade,
  label text not null default '未归类',
  summary text not null default '',
  color text not null default '#57d4ff',
  node_count int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists clusters_space_idx on clusters (space_id);

create table if not exists nodes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  content text not null,
  kind text not null default 'question',
  tags jsonb not null default '[]'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  cluster_id uuid,
  status text not null default 'ready',
  duplicate_of uuid,
  analysis jsonb not null default '{}'::jsonb,
  x double precision not null default 0,
  y double precision not null default 0,
  z double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nodes_space_created_idx on nodes (space_id, created_at desc);
create index if not exists nodes_tags_idx on nodes using gin (tags);
create index if not exists nodes_attrs_idx on nodes using gin (attributes);

create table if not exists edges (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  source_id uuid not null references nodes(id) on delete cascade,
  target_id uuid not null references nodes(id) on delete cascade,
  strength int not null default 50,
  relation text not null default 'related',
  origin text not null default 'jev',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, source_id, target_id)
);
create index if not exists edges_source_idx on edges (source_id);
create index if not exists edges_target_idx on edges (target_id);
create index if not exists edges_space_idx on edges (space_id);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  node_id uuid references nodes(id) on delete set null,
  title text not null,
  prompt text not null default '',
  status text not null default 'open' check (status in ('open', 'claimed', 'submitted', 'approved', 'rejected')),
  assignee text,
  priority int not null default 2,
  result text,
  result_meta jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists tasks_space_status_idx on tasks (space_id, status, created_at desc);

create table if not exists task_events (
  id bigserial primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  actor_type text not null default 'agent',
  actor_name text not null default '',
  type text not null,
  message text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists task_events_task_idx on task_events (task_id, id);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null,
  created_by uuid references users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_keys_space_idx on api_keys (space_id);
create index if not exists api_keys_hash_idx on api_keys (key_hash);

create table if not exists audit_runs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  model text not null,
  status text not null default 'running',
  stats jsonb not null default '{}'::jsonb,
  notes text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists audit_runs_space_idx on audit_runs (space_id, started_at desc);

create table if not exists space_events (
  id bigserial primary key,
  space_id uuid not null references spaces(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists space_events_space_idx on space_events (space_id, id desc);

create table if not exists space_trees (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  model text not null default '',
  tree jsonb not null,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists space_trees_space_idx on space_trees (space_id, created_at desc);
