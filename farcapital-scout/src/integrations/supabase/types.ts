import type { PipelineStatus, RawListing } from "@/types/property";

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
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
          // Trust level columns (migration 002)
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
        };
        Insert: Omit<Database["public"]["Tables"]["projects"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
      };
    };
  };
}
