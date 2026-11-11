-- The table behind phone <-> PC sync (migration "stalow_music_sync" in the it-manager Supabase project).
-- Only the stalow-sync edge function (service role) reads or writes it: RLS is on with no policies,
-- and anon/authenticated have no grants.
create table public.stalow_sync (
  sync_id    text not null check (sync_id ~ '^[0-9a-f]{64}$'),   -- sha256("stalow-music-sync:" + code)
  kind       text not null check (kind in ('history', 'like', 'download', 'settings', 'session')),
  key        text not null check (char_length(key) between 1 and 64),
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 65536),
  deleted    boolean not null default false,
  device     text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (sync_id, kind, key)
);
create index stalow_sync_changes on public.stalow_sync (sync_id, updated_at);
alter table public.stalow_sync enable row level security;
revoke all on public.stalow_sync from anon, authenticated;

-- every write moves updated_at, so pulls "since the last updated_at" see it
create or replace function public.stalow_sync_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
create trigger stalow_sync_touch before insert or update on public.stalow_sync
  for each row execute function public.stalow_sync_touch();
