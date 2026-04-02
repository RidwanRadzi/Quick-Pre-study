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
        };
        Insert: Omit<Database["public"]["Tables"]["projects"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
      };
    };
  };
}
