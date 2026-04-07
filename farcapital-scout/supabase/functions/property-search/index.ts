import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedIntent {
  area: string;
  price_min: number | null;
  price_max: number | null;
  property_type: string;
  tenure: "freehold" | "leasehold" | "all";
}

interface RawListing {
  title: string;
  link: string;
  snippet: string;
  price: number | null;
  sqft: number | null;
  psf: number | null;
  source: "iproperty.com.my" | "propertyguru.com.my" | "edgeprop.my" | "developer" | "other";
  listing_url: string | null;   // direct URL to the actual listing page
  listing_date: string | null;  // date string from SerpAPI result if available
  psf_confidence: "real" | "estimated";  // "real" if price+sqft both parsed, else "estimated"
}

interface ProjectFinancials {
  median_psf: number;
  gross_yield: number;
  be_psf: number;
  bte_psf: number;
  urgency_score: number;
  avg_sqft: number;
  est_monthly_rental: number;
}

interface PropertyProject {
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
  psf_confidence: "real" | "estimated";
  last_seen: string | null;
  availability: "high" | "medium" | "low";
  availability_pct: number;
}

// ---------------------------------------------------------------------------
// Step 1 — Parse location + filters from user message
// ---------------------------------------------------------------------------

async function parseIntent(message: string, anthropicKey: string): Promise<ParsedIntent> {
  const systemPrompt = `You are a Malaysian property search intent parser for FarCapital Scout.
Extract structured search parameters from the user's query (Malay, English, or mixed).

Return ONLY valid JSON:
{
  "area": "Malaysian area/city/suburb e.g. 'Rawang', 'Kepong', 'Shah Alam'",
  "price_min": null or number in RM,
  "price_max": null or number in RM,
  "property_type": "condominium" | "apartment" | "serviced apartment" | "townhouse" | "soho" | "all",
  "tenure": "freehold" | "leasehold" | "all"
}

Rules:
- "below 400k" → price_max: 400000
- "above 300k" → price_min: 300000
- If area not mentioned, default to "Kuala Lumpur"
- If type not mentioned, default to "all"`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!response.ok) throw new Error(`Claude parse error ${response.status}`);

  const data = await response.json();
  const raw = (data.content?.[0]?.text ?? "{}").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(raw) as ParsedIntent;
  } catch {
    const words = message.split(/\s+/);
    return {
      area: words.find((w) => w.length > 3 && /^[A-Z]/.test(w)) ?? "Kuala Lumpur",
      price_min: null,
      price_max: null,
      property_type: "all",
      tenure: "all",
    };
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Find real project names + metadata via editorial/news sources
// ---------------------------------------------------------------------------

interface ProjectMeta {
  name: string;
  completion_year: number | null;
  total_units: number | null;
}

async function findProjectNames(intent: ParsedIntent, serpApiKey: string, anthropicKey: string): Promise<ProjectMeta[]> {
  const typeStr =
    intent.property_type === "all"
      ? "condominium OR apartment OR \"serviced apartment\" OR townhouse"
      : `"${intent.property_type}"`;

  // Target editorial + news sources that report on VP/OC completions
  const query = [
    `"${intent.area}"`,
    typeStr,
    `"VP" OR "OC" OR "vacant possession" OR "occupation certificate" OR "completing" OR "completed"`,
    intent.tenure !== "all" ? intent.tenure : "",
    `-rumawip -"low cost" -"rumah selangorku"`,
    `site:edgeprop.my OR site:propertyguru.com.my OR site:iproperty.com.my OR site:thestar.com.my OR site:malaymail.com OR site:nst.com.my`,
  ].filter(Boolean).join(" ");

  console.log("Step A — project discovery query:", query);

  const results = await serpApiSearch(query, serpApiKey, 10);
  if (results.length === 0) return [];

  const corpus = results
    .map((r: any, i: number) => `[${i + 1}] Title: ${r.title}\nSnippet: ${r.snippet ?? ""}`)
    .join("\n\n");

  const extractPrompt = `You are extracting Malaysian property project details from search result snippets.
These results are from a search for completed/near-complete (VP/OC) residential projects in "${intent.area}".

For each specific project you find, extract:
- name: proper project name (e.g. "Residensi Harmoni", "Tropicana Gardens", "Arte Plus")
- completion_year: year of VP/OC/completion if mentioned (e.g. 2024, 2025), else null
- total_units: total number of units in the project if mentioned, else null

DO NOT include generic terms like "condominium", "apartment", area names alone, or developer company names alone.

Return ONLY a JSON array, max 6 items. Example:
[{"name":"Residensi Harmoni","completion_year":2024,"total_units":512},{"name":"Arte Plus","completion_year":null,"total_units":null}]
If none found, return [].

Search results:
${corpus}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      temperature: 0.1,
      system: "Return only valid JSON. No explanation.",
      messages: [{ role: "user", content: extractPrompt }],
    }),
  });

  if (!res.ok) return [];

  const d = await res.json();
  const txt = (d.content?.[0]?.text ?? "[]").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    const items = JSON.parse(txt) as ProjectMeta[];
    console.log("Step A — projects found:", items);
    return items.filter((p) => typeof p.name === "string" && p.name.length > 3).slice(0, 6);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Step 3 — Per-project search on portals (Step B search)
// ---------------------------------------------------------------------------

async function searchProjectListings(
  projectName: string,
  area: string,
  serpApiKey: string
): Promise<RawListing[]> {
  // Target PropertyGuru and iProperty with keywords that find developer/available units
  // Strict exclusion of auction, subsale, lelong
  const query = [
    `"${projectName}"`,
    `"developer unit" OR "completing" OR "completed" OR "available unit"`,
    `-auction -lelong -subsale -subsales -rumawip -"low cost" -"rumah selangorku"`,
    `site:propertyguru.com.my OR site:iproperty.com.my OR site:edgeprop.my`,
  ].join(" ");

  console.log(`Step B — listing search for "${projectName}":`, query);

  const results = await serpApiSearch(query, serpApiKey, 8);
  return results.map(parseListing);
}

// ---------------------------------------------------------------------------
// SerpAPI helper
// ---------------------------------------------------------------------------

async function serpApiSearch(query: string, serpApiKey: string, num = 10): Promise<any[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("gl", "my");
  url.searchParams.set("hl", "en");
  url.searchParams.set("num", String(num));
  url.searchParams.set("api_key", serpApiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error("SerpAPI error:", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return data.organic_results ?? [];
}

// ---------------------------------------------------------------------------
// Parse price, sqft, PSF from listing title + snippet
// ---------------------------------------------------------------------------

function parsePrice(text: string): number | null {
  const m =
    text.match(/RM\s?(\d[\d,]*(?:\.\d+)?)\s?(?:million|mil\b|m\b)/i) ||
    text.match(/RM\s?(\d+(?:\.\d+)?)\s?k\b/i) ||
    text.match(/RM\s?([\d,]+)/i) ||
    text.match(/([\d,]{6,})/);

  if (!m) return null;
  const raw = m[1].replace(/,/g, "");
  const lower = text.toLowerCase();
  if (lower.includes("million") || lower.includes("mil") || (m[0].toLowerCase().endsWith("m") && !m[0].toLowerCase().includes("sqm"))) {
    return parseFloat(raw) * 1_000_000;
  }
  if (m[0].toLowerCase().endsWith("k")) return parseFloat(raw) * 1_000;
  return parseFloat(raw);
}

function parseSqft(text: string): number | null {
  const m = text.match(/(\d[\d,]*)\s?(?:sqft|sq\.?\s?ft|square feet|sf)\b/i);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}

function detectSource(link: string): RawListing["source"] {
  if (link.includes("iproperty")) return "iproperty.com.my";
  if (link.includes("propertyguru")) return "propertyguru.com.my";
  if (link.includes("edgeprop")) return "edgeprop.my";
  if (
    link.includes("spsetia.com") || link.includes("sunwayproperty") ||
    link.includes("gamuda.com.my") || link.includes("ecoworld.com.my") ||
    link.includes("mah-sing.com") || link.includes("uemsunrise.com") ||
    link.includes("tropicana.com.my") || link.includes("ijmland.com")
  ) return "developer";
  return "other";
}

function isIndividualListingUrl(url: string): boolean {
  // Category/search pages that are NOT individual listings
  const categoryPatterns = [
    /\/property-for-sale\/?$/i,
    /\/property-for-rent\/?$/i,
    /\/buy\/?$/i,
    /\/search\/?$/i,
    /\/listings\/?$/i,
    /\/properties\/?$/i,
    /[?&](q|search|query|area|location)=/i,
  ];
  for (const pattern of categoryPatterns) {
    if (pattern.test(url)) return false;
  }
  // A real listing URL typically ends with a slug containing a numeric ID or long path segment
  const hasSlug = /\/[a-z0-9-]{5,}\/[a-z0-9-]{5,}/i.test(url) || /\/\d{4,}/.test(url);
  return hasSlug;
}

function parseListing(result: any): RawListing {
  const title: string = result.title ?? "";
  const snippet: string = result.snippet ?? "";
  const combined = `${title} ${snippet}`;
  const price = parsePrice(combined);
  const sqft = parseSqft(combined);
  const link: string = result.link ?? "";
  const listingUrl = link && isIndividualListingUrl(link) ? link : null;
  return {
    title,
    link,
    snippet,
    price,
    sqft,
    psf: price && sqft && sqft > 0 ? price / sqft : null,
    source: detectSource(link),
    listing_url: listingUrl,
    listing_date: result.date ?? null,
    psf_confidence: price !== null && sqft !== null ? "real" : "estimated",
  };
}

// ---------------------------------------------------------------------------
// Financial calculations
// ---------------------------------------------------------------------------

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const LOAN_RATE = 4.5;
const LOAN_TENURE = 35;
const LTV = 0.9;
const MAINT_MONTHLY = 280;
const SINKING_MONTHLY = 50;
const RENTAL_PSF_PER_MONTH = 1.50;

function areaDefaultPsf(area: string): number {
  const a = area.toLowerCase();
  if (a.includes("mont kiara") || a.includes("klcc") || a.includes("bangsar")) return 750;
  if (a.includes("kuala lumpur") || a === "kl") return 550;
  if (a.includes("petaling") || a.includes("subang") || a.includes("damansara")) return 480;
  if (a.includes("cheras") || a.includes("kepong") || a.includes("setapak")) return 380;
  if (a.includes("rawang") || a.includes("semenyih") || a.includes("bangi")) return 310;
  if (a.includes("johor") || a.includes(" jb") || a === "jb") return 350;
  if (a.includes("penang")) return 500;
  if (a.includes("ipoh")) return 250;
  return 380;
}

function computeFinancials(listings: RawListing[], area: string): ProjectFinancials {
  const psfValues = listings.filter((l) => l.psf && l.psf > 100 && l.psf < 2000).map((l) => l.psf!);
  const prices = listings.filter((l) => l.price && l.price > 50_000 && l.price < 5_000_000).map((l) => l.price!);
  const DEFAULT_SQFT = 850;

  let medPsf: number;
  let avgSqft: number;

  if (psfValues.length >= 2) {
    medPsf = median(psfValues);
    const sqftVals = listings.filter((l) => l.sqft && l.sqft > 300).map((l) => l.sqft!);
    avgSqft = sqftVals.length ? median(sqftVals) : DEFAULT_SQFT;
  } else if (prices.length >= 1) {
    medPsf = median(prices) / DEFAULT_SQFT;
    avgSqft = DEFAULT_SQFT;
  } else {
    medPsf = areaDefaultPsf(area);
    avgSqft = DEFAULT_SQFT;
  }

  const estMonthlyRental = avgSqft * RENTAL_PSF_PER_MONTH;
  const medianPrice = medPsf * avgSqft;
  const grossYield = medianPrice > 0 ? (estMonthlyRental * 12) / medianPrice * 100 : 0;

  const r = LOAN_RATE / 100 / 12;
  const n = LOAN_TENURE * 12;
  const factor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const netAfterCosts = estMonthlyRental - MAINT_MONTHLY - SINKING_MONTHLY;
  const bePricePerUnit = netAfterCosts > 0 ? netAfterCosts / (LTV * factor) : 0;
  const bePsf = bePricePerUnit / avgSqft;

  return {
    median_psf: Math.round(medPsf),
    gross_yield: parseFloat(grossYield.toFixed(2)),
    be_psf: Math.round(bePsf),
    bte_psf: Math.round(bePsf * 0.85),
    urgency_score: Math.max(0, Math.min(100, Math.round((grossYield - 3) * 25))),
    avg_sqft: Math.round(avgSqft),
    est_monthly_rental: Math.round(estMonthlyRental),
  };
}

// Compute developer unit availability confidence from Step B listings
function computeAvailability(listings: RawListing[]): { availability: "high" | "medium" | "low"; availability_pct: number } {
  let score = 0;

  // Signal 1: real individual listing URLs found (not category pages)
  const urlCount = listings.filter(l => l.listing_url).length;
  if (urlCount >= 3) score += 40;
  else if (urlCount >= 1) score += 25;

  // Signal 2: strong availability keywords in snippets
  const combined = listings.map(l => `${l.title} ${l.snippet}`).join(" ").toLowerCase();
  if (combined.includes("developer unit")) score += 25;
  if (combined.includes("available unit") || combined.includes("available now")) score += 20;
  if (combined.includes("completing") || combined.includes("completed")) score += 10;
  if (combined.includes("vacant possession") || combined.includes(" vp ") || combined.includes(" oc ")) score += 10;

  // Signal 3: recent listings (penalty for old dates)
  const dates = listings.filter(l => l.listing_date).map(l => l.listing_date!);
  if (dates.length > 0) {
    const mostRecent = dates.sort().reverse()[0];
    const year = parseInt(mostRecent.slice(-4), 10);
    if (!isNaN(year)) {
      if (year >= 2024) score += 10;
      else if (year >= 2022) score += 5;
      else score -= 10; // stale listing, lower confidence
    }
  }

  const pct = Math.max(5, Math.min(95, score));
  const availability = pct >= 65 ? "high" : pct >= 35 ? "medium" : "low";
  return { availability, availability_pct: pct };
}

function inferState(area: string): string {
  const a = area.toLowerCase();
  if (a.includes("kuala lumpur") || a === "kl" || a.includes("kepong") || a.includes("cheras") || a.includes("bangsar") || a.includes("mont kiara") || a.includes("setapak") || a.includes("bukit jalil")) return "Kuala Lumpur";
  if (a.includes("johor") || a.includes(" jb") || a === "jb") return "Johor";
  if (a.includes("penang") || a.includes("georgetown")) return "Pulau Pinang";
  if (a.includes("ipoh") || a.includes("perak")) return "Perak";
  if (a.includes("putrajaya")) return "Putrajaya";
  return "Selangor";
}

// ---------------------------------------------------------------------------
// Generate friendly reply
// ---------------------------------------------------------------------------

async function generateReply(
  message: string,
  area: string,
  projects: PropertyProject[],
  anthropicKey: string
): Promise<string> {
  const summary =
    projects.length === 0
      ? "Tiada projek VP/OC dengan unit developer dijumpai."
      : projects
          .slice(0, 5)
          .map((p) => `- ${p.project_name}: PSF RM${p.financials.median_psf}, Yield ${p.financials.gross_yield}%`)
          .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      temperature: 0.4,
      system: `You are FarCapital Scout, a concise Malaysian property assistant focused on unsold developer units from completed (VP) and near-complete (OC) projects.
Reply in 2–3 sentences. Mix of English and Malay is fine.
Mention the area searched, highlight the best-yielding project if any, give a brief buy-signal note.
Do NOT repeat all numbers — user sees the cards.`,
      messages: [{
        role: "user",
        content: `User searched: "${message}" (area: ${area})\nResults:\n${summary}`,
      }],
    }),
  });

  if (!res.ok) return `Jumpa ${projects.length} projek VP/OC di ${area}. Semak kad di bawah!`;
  const d = await res.json();
  return d.content?.[0]?.text ?? `Jumpa ${projects.length} projek di ${area}.`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message } = await req.json();

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const serpApiKey = Deno.env.get("SERPAPI_KEY");
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");
    if (!serpApiKey) throw new Error("SERPAPI_KEY not set");

    // 1. Parse location + filters
    console.log("Parsing intent:", message);
    const intent = await parseIntent(message, anthropicKey);
    console.log("Intent:", JSON.stringify(intent));

    // 2. Step A — discover real project names + metadata from editorial/news sources
    const projectMetas = await findProjectNames(intent, serpApiKey, anthropicKey);

    // 3. Step B — for each project, search for available developer units on portals
    const projectListings = await Promise.all(
      projectMetas.slice(0, 5).map((meta) =>
        searchProjectListings(meta.name, intent.area, serpApiKey)
      )
    );

    // 4. Build project objects with financials
    const state = inferState(intent.area);
    const projects: PropertyProject[] = projectMetas
      .slice(0, 5)
      .map((meta, i) => {
        const listings = projectListings[i].filter((l) => {
          if (!l.price) return true;
          if (intent.price_min && l.price < intent.price_min) return false;
          if (intent.price_max && l.price > intent.price_max) return false;
          return true;
        });
        // Pick best listing: prefer one with real PSF, then any with a URL
        const listingsWithUrl = listings.filter(l => l.listing_url);
        const realListing = listings.find(l => l.psf_confidence === "real" && l.listing_url);
        const bestListing = realListing ?? listingsWithUrl[0] ?? listings[0];

        const hasPsfConfidence = listings.some(l => l.psf_confidence === "real");

        // Most recent date
        const dates = listings.filter(l => l.listing_date).map(l => l.listing_date!);
        const lastSeen = dates.length > 0 ? dates.sort().reverse()[0] : null;

        const { availability, availability_pct } = computeAvailability(listings);

        return {
          project_name: meta.name,
          area: intent.area,
          state,
          listing_count: listings.length,
          listings,
          financials: computeFinancials(listings, intent.area),
          completion_year: meta.completion_year ?? null,
          total_units: meta.total_units ?? null,
          best_listing_url: bestListing?.listing_url ?? null,
          best_source: bestListing?.source ?? null,
          psf_confidence: hasPsfConfidence ? "real" : "estimated",
          last_seen: lastSeen,
          availability,
          availability_pct,
        };
      })
      .sort((a, b) => b.financials.urgency_score - a.financials.urgency_score);

    console.log(`Returning ${projects.length} projects`);

    // 5. Generate reply
    const replyMessage = await generateReply(message, intent.area, projects, anthropicKey);


    return new Response(
      JSON.stringify({ message: replyMessage, projects }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("property-search error:", err);
    return new Response(
      JSON.stringify({
        message: "Maaf, ada masalah teknikal. Cuba semula ya.",
        projects: [],
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
