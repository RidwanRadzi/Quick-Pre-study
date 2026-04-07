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
  status: "subsale" | "new launch" | "all";
}

interface RawListing {
  title: string;
  link: string;
  snippet: string;
  price: number | null;
  sqft: number | null;
  psf: number | null;
  source: "iproperty.com.my" | "propertyguru.com.my" | "brickz.my" | "edgeprop.my" | "developer" | "other";
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
}

// ---------------------------------------------------------------------------
// Step 1 — Parse intent with Claude Haiku
// ---------------------------------------------------------------------------

async function parseIntent(message: string, anthropicKey: string): Promise<ParsedIntent> {
  const systemPrompt = `You are a Malaysian property search intent parser for FarCapital Scout.
FarCapital Scout's goal is to find UNSOLD DEVELOPER UNITS from completed (VP) or near-completion (OC) projects.
Extract structured search parameters from the user's query (which may be in Malay, English, or mixed).

Return ONLY valid JSON with these fields:
{
  "area": "name of Malaysian area/city/suburb (string, e.g. 'Rawang', 'Kepong', 'Shah Alam')",
  "price_min": null or number in RM (e.g. 300000),
  "price_max": null or number in RM (e.g. 400000),
  "property_type": "condominium" | "apartment" | "serviced apartment" | "townhouse" | "soho" | "all",
  "tenure": "freehold" | "leasehold" | "all",
  "completion_stage": "VP" | "OC" | "all"
}

Parsing rules:
- "below 400k" → price_max: 400000
- "above 300k" → price_min: 300000
- "350k-500k" → price_min: 350000, price_max: 500000
- "projek siap" / "VP" / "vacant possession" / "siap bina" / "completed" → completion_stage: "VP"
- "OC" / "occupation certificate" / "near completion" / "hampir siap" → completion_stage: "OC"
- "freehold" → tenure: "freehold"
- "leasehold" → tenure: "leasehold"
- Property types: kondo/condominium, apartment/pangsapuri, serviced apartment/servis, townhouse, SOHO/SOVO
- If area not mentioned, default to "Kuala Lumpur"
- If type not mentioned, default to "all"
- completion_stage defaults to "all" (which searches both VP and OC)`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text ?? "{}";

  // Strip markdown code fences if present
  const jsonText = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(jsonText) as ParsedIntent;
  } catch {
    // Fallback: extract area from message naively
    const words = message.split(/\s+/);
    return {
      area: words.find((w) => w.length > 3 && /^[A-Z]/.test(w)) || "Kuala Lumpur",
      price_min: null,
      price_max: null,
      property_type: "all",
      tenure: "all",
      status: "all",
    };
  }
}

// ---------------------------------------------------------------------------
// Step 2 — SerpAPI property search (Google organic)
// ---------------------------------------------------------------------------

// Top Malaysian developer domains for targeted searches
const DEVELOPER_SITES = [
  "site:spsetia.com",
  "site:ioi.com.my",
  "site:sunwayproperty.com",
  "site:gamuda.com.my",
  "site:ecoworld.com.my",
  "site:mah-sing.com",
  "site:uemSunrise.com",
  "site:tropicana.com.my",
  "site:sime-realty.com.my",
  "site:ijmland.com",
];

function buildSearchQuery(intent: ParsedIntent): string {
  const parts: string[] = [];

  // Area + property type
  parts.push(intent.area);

  const typeStr =
    intent.property_type === "all"
      ? "condominium OR apartment OR \"serviced apartment\" OR townhouse OR SOHO"
      : intent.property_type;
  parts.push(typeStr);

  // Core focus: unsold developer stock at VP/OC stage
  const completionStage = (intent as any).completion_stage as string | undefined;
  if (completionStage === "VP") {
    parts.push("\"vacant possession\" OR \"VP\" unsold developer unit");
  } else if (completionStage === "OC") {
    parts.push("\"occupation certificate\" OR \"OC\" developer unit available");
  } else {
    // Default: search both VP and OC stages
    parts.push("(\"vacant possession\" OR \"VP\" OR \"OC\" OR \"occupation certificate\") developer unit unsold available");
  }

  if (intent.tenure !== "all") parts.push(intent.tenure);

  // Exclude secondhand/auction noise
  parts.push("-auction -lelong -subsale -subsales -\"for rent\"");

  // Reliable portals only (no mudah.my — it's a subsale/secondhand marketplace)
  const portalSites = "site:propertyguru.com.my OR site:iproperty.com.my OR site:edgeprop.my OR site:brickz.my";
  const devSites = DEVELOPER_SITES.slice(0, 4).join(" OR ");
  parts.push(`(${portalSites} OR ${devSites})`);

  return parts.join(" ");
}

async function searchSerpApi(query: string, serpApiKey: string): Promise<any[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("gl", "my");          // Country: Malaysia
  url.searchParams.set("hl", "en");
  url.searchParams.set("num", "20");         // Fetch more so grouping has enough data
  url.searchParams.set("api_key", serpApiKey);

  console.log("SerpAPI query:", query);

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error("SerpAPI error:", res.status, await res.text());
    return [];
  }

  const data = await res.json();
  return data.organic_results ?? [];
}

// ---------------------------------------------------------------------------
// Step 3 — Parse price, sqft, PSF from listing title + snippet
// ---------------------------------------------------------------------------

function parsePrice(text: string): number | null {
  // Patterns: "RM 380,000" / "RM380k" / "RM 1.2m" / "380,000"
  const m =
    text.match(/RM\s?(\d[\d,]*(?:\.\d+)?)\s?(?:million|mil\b|m\b)/i) ||
    text.match(/RM\s?(\d+(?:\.\d+)?)\s?k\b/i) ||
    text.match(/RM\s?([\d,]+)/i) ||
    text.match(/([\d,]{6,})/);

  if (!m) return null;
  let raw = m[1].replace(/,/g, "");
  const lowerFull = text.toLowerCase();
  if (lowerFull.includes("million") || lowerFull.includes("mil") || (m[0].toLowerCase().endsWith("m") && !m[0].toLowerCase().includes("sqm"))) {
    return parseFloat(raw) * 1_000_000;
  }
  if (m[0].toLowerCase().endsWith("k")) {
    return parseFloat(raw) * 1_000;
  }
  return parseFloat(raw);
}

function parseSqft(text: string): number | null {
  const m = text.match(/(\d[\d,]*)\s?(?:sqft|sq\.?\s?ft|square feet|sf)\b/i);
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, ""));
}

function detectSource(link: string): "iproperty.com.my" | "propertyguru.com.my" | "brickz.my" | "edgeprop.my" | "developer" | "other" {
  if (link.includes("iproperty")) return "iproperty.com.my";
  if (link.includes("propertyguru")) return "propertyguru.com.my";
  if (link.includes("brickz")) return "brickz.my";
  if (link.includes("edgeprop")) return "edgeprop.my";
  // Classify known developer domains
  if (
    link.includes("spsetia.com") || link.includes("ioi.com.my") ||
    link.includes("sunwayproperty") || link.includes("gamuda.com.my") ||
    link.includes("ecoworld.com.my") || link.includes("mah-sing.com") ||
    link.includes("uemsunrise.com") || link.includes("tropicana.com.my") ||
    link.includes("sime-realty") || link.includes("ijmland.com")
  ) return "developer";
  return "other";
}

function parseListing(result: any): RawListing {
  const title: string = result.title ?? "";
  const snippet: string = result.snippet ?? "";
  const combined = `${title} ${snippet}`;

  const price = parsePrice(combined);
  const sqft = parseSqft(combined);
  const psf = price && sqft && sqft > 0 ? price / sqft : null;

  return {
    title,
    link: result.link ?? "",
    snippet,
    price,
    sqft,
    psf,
    source: detectSource(result.link ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Step 4 — Group results by project name
// ---------------------------------------------------------------------------

// Common Malaysian property project name suffixes
const PROPERTY_SUFFIX = /\b(residensi|residence|heights?|park|villa|tower|suites?|court|garden|view|hills?|sentral|central|aman|bayu|mutiara|perdana|impian|idaman|setia|wangsa|damai|permai|indah|maju|jaya|utama|putra|prima|sri|desa|city|square|avenue|place)\b/i;

// Generic property type words that alone don't make a project name
const GENERIC_TYPE = /^(apartments?|condominiums?|condos?|properties|property|pangsapuri|kondominium|rumah|soho|townhouse|residences?)\b\s*[,\/]?\s*$/i;

// Detect category/listing-count pages that don't represent a single property
function isCategoryPage(title: string, link: string): boolean {
  // ANY title starting with 2+ digit number is a listing count page
  // e.g. "59 Bandar Country Homes...", "326 Condominium properties", "1368 Kondominium untuk"
  if (/^\d{2,}\s+/i.test(title)) return true;
  // Titles that are just a generic type word (plural or list)
  // e.g. "Condominiums", "Apartments, Condos, Service Residences..."
  if (GENERIC_TYPE.test(title)) return true;
  // e.g. "Apartments, Condos, ..." — starts with type word followed by comma
  if (/^(apartments?|condominiums?|condos?|properties)\s*,/i.test(title)) return true;
  // e.g. "Apartment / Condominium For Sale..." or "Condominium properties in..."
  if (/^(apartment|condominium|property|pangsapuri|kondo)\s*(\/|\bproperties\b)/i.test(title)) return true;
  // Portal search/category URLs
  if (/\/(search|listings?|property-for-sale|for-sale|cari|jual)\b/i.test(link)) return true;
  return false;
}

function extractProjectName(title: string, snippet: string): string | null {
  // For titles starting with a count number, try to rescue the project name embedded after
  // e.g. "59 Bandar Country Homes Rawang in" → "Bandar Country Homes Rawang"
  const countMatch = title.match(/^(\d{2,})\s+(.+)$/);
  if (countMatch) {
    const rest = countMatch[2];
    // If the remainder is just a generic type, discard entirely
    if (/^(apartment|condominium|condo|property|pangsapuri|kondominium)\b/i.test(rest)) return null;
    // Otherwise strip trailing preposition + location and use as name
    const rescued = rest
      .replace(/\s+\b(in|di|at|for|untuk)\s+\S+.*$/i, "")
      .replace(/\s+\b(in|di|at|for|untuk)\s*$/i, "")
      .trim();
    if (rescued.length > 5) return rescued.split(/\s+/).slice(0, 5).join(" ");
    return null;
  }

  // Skip remaining category patterns
  if (isCategoryPage(title, "")) return null;

  // Clean title and use it if it looks like a real project name
  const cleaned = title
    .replace(/\s*[\|–\-].*/, "")
    .replace(/\s*(for sale|dijual|freehold|leasehold)\b.*/i, "")
    .replace(/\d[\d,]*\s?(?:sqft|sq\.?\s?ft)\b.*/i, "")
    .replace(/RM\s?[\d,]+.*/i, "")
    .trim();

  const words = cleaned.split(/\s+/).slice(0, 6).join(" ").trim();
  if (words.length > 4 && !GENERIC_TYPE.test(words)) {
    return words;
  }

  // --- Snippet-based extraction ---
  const combined = `${snippet} ${title}`;

  // Pattern 1: "at PROJECT NAME" / "di PROJECT NAME"
  const atMatch = combined.match(/\b(?:at|@|di)\s+([A-Z][A-Za-z][A-Za-z\s\-]{2,40}?)(?=[,\.\|]|\s{2}|$)/);
  if (atMatch && atMatch[1].trim().length > 4) return atMatch[1].trim().split(/\s+/).slice(0, 5).join(" ");

  // Pattern 2: "PROJECT NAME, Area" — capitalized phrase before comma+place
  const commaMatch = snippet.match(/^([A-Z][A-Za-z][A-Za-z\s\-]{3,40}),\s+[A-Z]/);
  if (commaMatch) return commaMatch[1].trim();

  // Pattern 3: scan for words near a known property suffix
  const ws = combined.split(/\s+/);
  for (let i = 0; i < ws.length; i++) {
    if (PROPERTY_SUFFIX.test(ws[i])) {
      const start = Math.max(0, i - 3);
      const phrase = ws
        .slice(start, i + 2)
        .join(" ")
        .replace(/[^A-Za-z\s\-]/g, "")
        .trim();
      if (phrase.length > 4) return phrase.split(/\s+/).slice(0, 5).join(" ");
    }
  }

  // Cannot determine real project name — discard
  return null;
}

function groupByProject(listings: RawListing[]): Map<string, RawListing[]> {
  const groups = new Map<string, RawListing[]>();
  for (const listing of listings) {
    // Skip category/portal-search pages — they don't represent a real project
    if (isCategoryPage(listing.title, listing.link)) continue;

    const name = extractProjectName(listing.title, listing.snippet);
    if (!name) continue; // couldn't identify a real project name

    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(listing);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Step 5 — Financial calculations (ported from QPS finance_agent logic)
// ---------------------------------------------------------------------------

// Standard amortisation formula: P * r(1+r)^n / ((1+r)^n - 1)
function monthlyInstalment(principal: number, annualRate: number, tenureYears: number): number {
  if (principal <= 0) return 0;
  const r = annualRate / 100 / 12;
  const n = tenureYears * 12;
  if (r === 0) return principal / n;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// Median of an array
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const LOAN_RATE = 4.5;       // % p.a. — BNM standard variable rate 2025
const LOAN_TENURE = 35;      // years
const LTV = 0.9;             // 90% financing
const MAINT_MONTHLY = 280;   // RM — typical Malaysian mid-tier condo
const SINKING_MONTHLY = 50;  // RM
// Rental estimate: Malaysian mid-market rental yield is ~4.5% gross
// rental_psf_per_month = purchase_psf * gross_yield / 12
// We use RM 1.50 / sqft / month as baseline (adjustable)
const RENTAL_PSF_PER_MONTH = 1.50; // RM/sqft/month

function computeFinancials(listings: RawListing[], area: string): ProjectFinancials {
  // Use PSF values from listings with known price + sqft
  const psfValues = listings.filter((l) => l.psf && l.psf > 100 && l.psf < 2000).map((l) => l.psf!);

  // Fallback: infer PSF from price alone with an assumed size
  const prices = listings.filter((l) => l.price && l.price > 50_000 && l.price < 5_000_000).map((l) => l.price!);

  const DEFAULT_SQFT = 850; // sqft — average Malaysian mid-size unit

  let medPsf: number;
  let avgSqft: number;

  if (psfValues.length >= 2) {
    medPsf = median(psfValues);
    const sqftValues = listings.filter((l) => l.sqft && l.sqft > 300).map((l) => l.sqft!);
    avgSqft = sqftValues.length ? median(sqftValues) : DEFAULT_SQFT;
  } else if (prices.length >= 1) {
    // Guess PSF from price assuming DEFAULT_SQFT
    medPsf = median(prices) / DEFAULT_SQFT;
    avgSqft = DEFAULT_SQFT;
  } else {
    // Fully unknown — use area-based heuristics
    medPsf = areaDefaultPsf(area);
    avgSqft = DEFAULT_SQFT;
  }

  // Estimated monthly rental for an average unit
  const estMonthlyRental = avgSqft * RENTAL_PSF_PER_MONTH;

  // Gross yield
  const medianPrice = medPsf * avgSqft;
  const grossYield = medianPrice > 0 ? (estMonthlyRental * 12) / medianPrice * 100 : 0;

  // Breakeven PSF: rental = instalment(0.9 * price) + maint + sinking
  // => price = (rental - maint - sinking) / (0.9 * factor)
  const r = LOAN_RATE / 100 / 12;
  const n = LOAN_TENURE * 12;
  const factor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const netAfterCosts = estMonthlyRental - MAINT_MONTHLY - SINKING_MONTHLY;
  const bePricePerUnit = netAfterCosts > 0 ? netAfterCosts / (LTV * factor) : 0;
  const bePsf = bePricePerUnit / avgSqft;

  // BTE = BE * 0.85 (built into PropertyCard display, but we expose it here too)
  const btePsf = bePsf * 0.85;

  // Urgency score: 0–100, calibrated so 3% yield = 0, 7%+ = 100
  const urgencyScore = Math.max(0, Math.min(100, Math.round((grossYield - 3) * 25)));

  return {
    median_psf: Math.round(medPsf),
    gross_yield: parseFloat(grossYield.toFixed(2)),
    be_psf: Math.round(bePsf),
    bte_psf: Math.round(btePsf),
    urgency_score: urgencyScore,
    avg_sqft: Math.round(avgSqft),
    est_monthly_rental: Math.round(estMonthlyRental),
  };
}

/** Rough area-based PSF heuristic for when listings have no price data */
function areaDefaultPsf(area: string): number {
  const lower = area.toLowerCase();
  if (lower.includes("mont kiara") || lower.includes("klcc") || lower.includes("bangsar")) return 750;
  if (lower.includes("kuala lumpur") || lower.includes(" kl") || lower === "kl") return 550;
  if (lower.includes("petaling") || lower.includes("subang") || lower.includes("damansara")) return 480;
  if (lower.includes("cheras") || lower.includes("kepong") || lower.includes("setapak")) return 380;
  if (lower.includes("rawang") || lower.includes("semenyih") || lower.includes("bangi")) return 310;
  if (lower.includes("johor") || lower.includes("jb")) return 350;
  if (lower.includes("penang")) return 500;
  if (lower.includes("ipoh")) return 250;
  return 380; // national average
}

/** Infer state from area string */
function inferState(area: string): string {
  const lower = area.toLowerCase();
  if (lower.includes("kuala lumpur") || lower === "kl" || lower.includes("kepong") || lower.includes("cheras") || lower.includes("bangsar") || lower.includes("mont kiara") || lower.includes("setapak") || lower.includes("wangsa") || lower.includes("bukit jalil")) return "Kuala Lumpur";
  if (lower.includes("johor") || lower.includes(" jb") || lower === "jb") return "Johor";
  if (lower.includes("penang") || lower.includes("georgetown")) return "Pulau Pinang";
  if (lower.includes("ipoh") || lower.includes("perak")) return "Perak";
  if (lower.includes("putrajaya")) return "Putrajaya";
  if (lower.includes("cyberjaya") || lower.includes("sepang") || lower.includes("rawang") || lower.includes("klang") || lower.includes("subang") || lower.includes("puchong") || lower.includes("petaling") || lower.includes("damansara") || lower.includes("shah alam") || lower.includes("kajang") || lower.includes("bangi") || lower.includes("semenyih") || lower.includes("nilai")) return "Selangor";
  return "Selangor";
}

// ---------------------------------------------------------------------------
// Step 6 — Generate a friendly reply
// ---------------------------------------------------------------------------

async function generateReply(
  message: string,
  intent: ParsedIntent,
  projects: PropertyProject[],
  anthropicKey: string
): Promise<string> {
  const summary =
    projects.length === 0
      ? "Tiada hasil dijumpai."
      : projects
          .slice(0, 5)
          .map((p) => `- ${p.project_name} (${p.area}): PSF RM${p.financials.median_psf}, Yield ${p.financials.gross_yield}%`)
          .join("\n");

  const systemPrompt = `You are FarCapital Scout, a concise Malaysian property assistant specialising in unsold developer stock from completed (VP) and near-completion (OC) projects.
Reply in 2–3 sentences (mix of English and Malay is fine).
Summarise what VP/OC units were found, highlight projects with good yield or urgency, and give a brief acquisition note.
Do NOT repeat all the numbers — the user can see the cards.`;

  const completionStage = (intent as any).completion_stage ?? "all";
  const userContent = `User asked: "${message}"
Intent parsed: area=${intent.area}, price_max=${intent.price_max ?? "any"}, type=${intent.property_type}, stage=${completionStage}
Top VP/OC developer units found:\n${summary}`;

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
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) return `Jumpa ${projects.length} projek di ${intent.area}. Semak kad di bawah ya!`;
  const data = await res.json();
  return data.content?.[0]?.text ?? `Jumpa ${projects.length} projek di ${intent.area}.`;
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

    // 1. Parse intent
    console.log("Parsing intent for:", message);
    const intent = await parseIntent(message, anthropicKey);
    console.log("Parsed intent:", JSON.stringify(intent));

    // 2. Build search query and call SerpAPI
    const query = buildSearchQuery(intent);
    const rawResults = await searchSerpApi(query, serpApiKey);
    console.log(`SerpAPI returned ${rawResults.length} results`);

    // 3. Parse listings
    const listings: RawListing[] = rawResults.map(parseListing);

    // 4. Apply price filter from intent
    const filtered = listings.filter((l) => {
      if (!l.price) return true; // keep if unknown
      if (intent.price_min && l.price < intent.price_min) return false;
      if (intent.price_max && l.price > intent.price_max) return false;
      return true;
    });

    // 5. Group by project
    const grouped = groupByProject(filtered);

    // 6. Compute financials per project, sort by urgency
    const projects: PropertyProject[] = Array.from(grouped.entries())
      .filter(([, ls]) => ls.length >= 1)
      .map(([name, ls]) => {
        const state = inferState(intent.area);
        return {
          project_name: name,
          area: intent.area,
          state,
          listing_count: ls.length,
          listings: ls,
          financials: computeFinancials(ls, intent.area),
        };
      })
      .sort((a, b) => b.financials.urgency_score - a.financials.urgency_score)
      .slice(0, 10); // top 10

    console.log(`Returning ${projects.length} projects`);

    // 7. Generate friendly reply
    const replyMessage = await generateReply(message, intent, projects, anthropicKey);

    return new Response(
      JSON.stringify({ message: replyMessage, projects }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("property-search error:", err);
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({
        message: "Maaf, ada masalah teknikal. Cuba semula ya.",
        projects: [],
        error: errMsg,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
