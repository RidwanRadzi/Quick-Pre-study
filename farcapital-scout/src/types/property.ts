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
}

export interface PropertyProject {
  project_name: string;
  area: string;
  state: string;
  listing_count: number;
  listings: RawListing[];
  financials: ProjectFinancials;
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
}
