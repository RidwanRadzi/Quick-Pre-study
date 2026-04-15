-- FarCapital Scout — Trust Level upgrades (TL3-TL5) + Google Sheets sync columns
-- Run via: supabase db push  OR  paste into Supabase SQL editor

ALTER TABLE public.projects
  -- TL3: Cross-source PSF validation
  ADD COLUMN IF NOT EXISTS psf_confidence    text    DEFAULT 'estimated',
  ADD COLUMN IF NOT EXISTS psf_source_count  integer DEFAULT 1,

  -- TL4: Real rental data
  ADD COLUMN IF NOT EXISTS rental_psf_real      numeric,
  ADD COLUMN IF NOT EXISTS rental_source_count  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yield_confidence     text    DEFAULT 'estimated',

  -- TL5: Brickz transaction history
  ADD COLUMN IF NOT EXISTS transaction_psf_low  numeric,
  ADD COLUMN IF NOT EXISTS transaction_psf_high numeric,
  ADD COLUMN IF NOT EXISTS transaction_count    integer DEFAULT 0,

  -- Google Sheets sync tracking
  ADD COLUMN IF NOT EXISTS sheets_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sheets_row_id    text,

  -- Additional project metadata exposed by enrichment
  ADD COLUMN IF NOT EXISTS completion_year  integer,
  ADD COLUMN IF NOT EXISTS total_units      integer,
  ADD COLUMN IF NOT EXISTS availability     text    DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS availability_pct integer DEFAULT 50,
  ADD COLUMN IF NOT EXISTS scraped_developer text,
  ADD COLUMN IF NOT EXISTS best_listing_url  text;

-- Constraints (add only if they don't already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_psf_confidence'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT chk_psf_confidence
        CHECK (psf_confidence IN ('estimated','real','validated','scraped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_yield_confidence'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT chk_yield_confidence
        CHECK (yield_confidence IN ('estimated','real'));
  END IF;
END;
$$;
