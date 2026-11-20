-- "New releases" (migrations stalow_music_releases + stalow_music_releases_schedule in the it-manager project).
-- Only the stalow-releases edge function (service role) reads or writes these tables.
create table public.stalow_releases (
  browse_id   text primary key check (browse_id ~ '^MPRE[A-Za-z0-9_-]{5,80}$'),
  artist_id   text not null check (artist_id ~ '^UC[A-Za-z0-9_-]{10,40}$'),
  artist_name text not null default '',
  title       text not null check (char_length(title) between 1 and 300),
  playlist_id text not null default '',
  thumbnail   text not null default '',
  year        int,
  kind        text not null default 'album' check (kind in ('album', 'single')),
  baseline    boolean not null default false, -- found on an artist's first scan: not "new", just already there
  first_seen  timestamptz not null default now(),
  hidden      boolean not null default false -- taken off the feed by hand (migration stalow_releases_hidden); later scans keep it
);
create index stalow_releases_new on public.stalow_releases (baseline, first_seen desc);

create table public.stalow_release_artists (
  artist_id    text primary key check (artist_id ~ '^UC[A-Za-z0-9_-]{10,40}$'),
  name         text not null default '',
  last_scanned timestamptz
);
create index stalow_release_artists_next on public.stalow_release_artists (last_scanned nulls first);

-- The scheduler's private key (checked by the function, read by the scheduled job). One row.
create table public.stalow_release_state (
  id       int primary key default 1 check (id = 1),
  scan_key text not null default encode(extensions.gen_random_bytes(24), 'hex')
);
insert into public.stalow_release_state default values;

alter table public.stalow_releases enable row level security;
alter table public.stalow_release_artists enable row level security;
alter table public.stalow_release_state enable row level security;
revoke all on public.stalow_releases, public.stalow_release_artists, public.stalow_release_state from anon, authenticated;

-- Every 10 minutes: check the next 30 approved artists (a full round about every 6 hours).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('stalow-releases-scan', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://dzrnortzhpnoussbeedv.supabase.co/functions/v1/stalow-releases',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('action', 'scan', 'key', (select scan_key from public.stalow_release_state where id = 1)),
    timeout_milliseconds := 120000);
$$);

-- The approved artists to check are sent with {action:"seed", key, artists:[{id,name}]} whenever artists.json
-- changes (artists no longer listed stop being checked and their releases leave the list).
