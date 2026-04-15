export interface ParsedIntent {
  area: string;
  price_min: number | null;
  price_max: number | null;
  property_type: string;
  tenure: "freehold" | "leasehold" | "all";
  status: "subsale" | "new launch" | "all";
}

export interface RawListing {
  title: string;
  link: string;
  snippet: string;
  price: number | null;
  sqft: number | null;
  psf: number | null;
  psf_confidence: "real" | "estimated";
  source: "mudah.my" | "iproperty.com.my" | "other";
}

export interface ProjectFinancials {
  /** Median price-per-sqft across all listings */
  median_psf: number;
  /** Estimated gross yield (%) */
  gross_yield: number;
  /** Breakeven PSF — PSF where monthly cashflow = 0 */
  be_psf: number;
  /** Best-to-enter PSF (BE * 0.85) */
  bte_psf: number;
  /** Composite urgency score 0–100 */
  urgency_score: number;
  /** Assumed avg unit size (sqft) used in calc */
  avg_sqft: number;
  /** Estimated monthly rental */
  est_monthly_rental: number;
  /** Real rental PSF from live search (null = not found, falls back to hardcoded) */
  rental_psf_real: number | null;
  /** Number of rental listings used to derive rental_psf_real */
  rental_source_count: number;
  /** Whether gross_yield is based on real rental data or the hardcoded constant */
  yield_confidence: "real" | "estimated";
}

export interface PropertyProject {
  project_name: string;
  area: string;
  state: string;
  listing_count: number;
  listings: RawListing[];
  financials: ProjectFinancials;
  completion_year: number | null;
  total_units: number | null;
  best_listing_url: string | null;
  best_source: string | null;
  /** TL1–TL3 confidence level for the PSF figure */
  psf_confidence: "real" | "estimated" | "scraped" | "validated";
  /** How many listings agreed within 15% of the median PSF (TL3) */
  psf_source_count: number;
  last_seen: string | null;
  availability: "high" | "medium" | "low";
  availability_pct: number;
  scraped_price: number | null;
  scraped_sqft: number | null;
  scraped_psf: number | null;
  scraped_developer: string | null;
  scraped_status: string | null;
  /** TL5: lowest transacted PSF from Brickz */
  transaction_psf_low: number | null;
  /** TL5: highest transacted PSF from Brickz */
  transaction_psf_high: number | null;
  /** TL5: number of transactions found on Brickz */
  transaction_count: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  projects?: PropertyProject[];
}

export type PipelineStatus =
  | "watchlist"
  | "researching"
  | "site_visit"
  | "offer_made"
  | "acquired"
  | "passed";

export interface TrackedProject {
  id: string;
  project_name: string;
  area: string;
  state: string;
  listing_count: number;
  median_psf: number;
  gross_yield: number;
  be_psf: number;
  urgency_score: number;
  pipeline_status: PipelineStatus;
  raw_listings: RawListing[];
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Trust level fields (nullable — populated for projects saved after v2 upgrade)
  psf_confidence: "real" | "estimated" | "scraped" | "validated" | null;
  psf_source_count: number | null;
  rental_psf_real: number | null;
  rental_source_count: number | null;
  yield_confidence: "real" | "estimated" | null;
  transaction_psf_low: number | null;
  transaction_psf_high: number | null;
  transaction_count: number | null;
  // Google Sheets sync
  sheets_synced_at: string | null;
  sheets_row_id: string | null;
  // Enrichment metadata
  completion_year: number | null;
  total_units: number | null;
  availability: "high" | "medium" | "low" | null;
  availability_pct: number | null;
  scraped_developer: string | null;
  best_listing_url: string | null;
}
