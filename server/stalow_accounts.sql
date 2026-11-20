-- Stalow Music accounts and the admin-managed channel / artist list (migration stalow_music_accounts in the
-- it-manager project). Only the stalow-accounts edge function (service role) reads or writes these tables.
-- Not Supabase Auth: signed-in Supabase users can reach the business tables, so devices use their own keys.
create table public.stalow_accounts (
  id          uuid primary key default gen_random_uuid(),
  key_hash    text not null unique,            -- sha256 of "stalow-account:" + the device's private key
  name        text not null check (char_length(name) between 1 and 60),
  device      text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  role        text not null default 'user' check (role in ('user', 'admin', 'owner')),
  created_at  timestamptz not null default now(),
  last_seen   timestamptz,
  decided_by  uuid,
  decided_at  timestamptz
);

-- The admins' changes on top of the lists built into the apps
create table public.stalow_catalog (
  entry_id    text primary key check (entry_id ~ '^UC[A-Za-z0-9_-]{10,40}$'),
  name        text not null default '',
  thumbnail   text not null default '',
  category    text not null check (category in ('music', 'podcasts', 'shiurim', 'videos')),
  removed     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- One row: the owner's one-time claim code (cleared once used) and the list version the apps compare
create table public.stalow_account_state (
  id               int primary key default 1 check (id = 1),
  owner_claim_code text default encode(extensions.gen_random_bytes(9), 'hex'),
  catalog_version  bigint not null default 1
);
insert into public.stalow_account_state default values;

alter table public.stalow_accounts enable row level security;
alter table public.stalow_catalog enable row level security;
alter table public.stalow_account_state enable row level security;
revoke all on public.stalow_accounts, public.stalow_catalog, public.stalow_account_state from anon, authenticated;
