-- FarCapital Scout — Acquisition Tracker schema
-- Run via: supabase db push  OR  paste into Supabase SQL editor

create table if not exists public.projects (
  id               uuid        primary key default gen_random_uuid(),
  project_name     text        not null unique,
  area             text        not null,
  state            text        not null default 'Selangor',
  listing_count    integer     not null default 0,
  median_psf       numeric     not null default 0,
  gross_yield      numeric     not null default 0,
  be_psf           numeric     not null default 0,
  urgency_score    integer     not null default 0 check (urgency_score between 0 and 100),
  pipeline_status  text        not null default 'watchlist'
                   check (pipeline_status in ('watchlist','researching','site_visit','offer_made','acquired','passed')),
  raw_listings     jsonb       not null default '[]'::jsonb,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Auto-update updated_at on row change
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute procedure public.set_updated_at();

-- Enable Row Level Security (open read/write for now — tighten with auth later)
alter table public.projects enable row level security;

create policy "Allow all" on public.projects
  for all using (true) with check (true);

-- Index for common sort
create index if not exists idx_projects_created_at on public.projects (created_at desc);
create index if not exists idx_projects_urgency   on public.projects (urgency_score desc);
create index if not exists idx_projects_status    on public.projects (pipeline_status);
