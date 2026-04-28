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
  listing_date: string | null;  // date string from search result if available
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
  // TL4: real rental data
  rental_psf_real: number | null;
  rental_source_count: number;
  yield_confidence: "real" | "estimated";
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
  psf_confidence: "real" | "estimated" | "scraped" | "validated";
  psf_source_count: number;
  last_seen: string | null;
  availability: "high" | "medium" | "low";
  availability_pct: number;
  // Step C — real scraped data from crawl4ai
  scraped_price: number | null;
  scraped_sqft: number | null;
  scraped_psf: number | null;
  scraped_developer: string | null;
  scraped_status: string | null;
  // TL5: Brickz transaction history
  transaction_psf_low: number | null;
  transaction_psf_high: number | null;
  transaction_count: number;
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
  "property_type": "serviced apartment" | "condominium" | "apartment" | "townhouse" | "soho" | "all",
  "tenure": "freehold" | "leasehold" | "all"
}

Rules:
- "below 400k" → price_max: 400000
- "above 300k" → price_min: 300000
- ALWAYS use the EXACT area name the user typed — do NOT replace it with a bigger city
  e.g. "Nilai" → area: "Nilai" (NOT "Kuala Lumpur"), "Semenyih" → "Semenyih", "Sepang" → "Sepang"
- Malaysian areas include but are not limited to: Rawang, Nilai, Semenyih, Sepang, Bangi, Kajang,
  Cheras, Kepong, Setapak, Shah Alam, Subang, Puchong, Klang, Port Klang, Seremban,
  Johor Bahru, Iskandar Puteri, Penang, Georgetown, Ipoh, Kuching, Kota Kinabalu
- If area not mentioned, default to "Kuala Lumpur"
- If type not mentioned, default to "all"
- Recognise: "servis"/"serviced"/"SA" → "serviced apartment", "kondo"/"condo" → "condominium", "taun haus"/"teres" → "townhouse", "SOHO"/"SOVO" → "soho"`;

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

async function findProjectNames(intent: ParsedIntent, braveApiKey: string, anthropicKey: string): Promise<ProjectMeta[]> {
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 3;           // completed within last 3 years (drop stale 2021/2022 stock)
  const maxYear = currentYear + 1;           // completing within ~12 months

  // Recent year range for query bias
  const yearTerms = Array.from({ length: maxYear - minYear + 1 }, (_, i) => String(minYear + i)).join(" OR ");

  // Default focuses on serviced apartment + condominium; user can override by specifying type
  const typeStr =
    intent.property_type === "all"
      ? "\"serviced apartment\" OR condominium"
      : `"${intent.property_type}"`;

  // Target editorial + news sources that report on VP/OC completions
  const query = [
    `"${intent.area}"`,
    typeStr,
    `"VP" OR "OC" OR "vacant possession" OR "occupation certificate" OR "completing" OR "completed"`,
    `(${yearTerms})`,
    intent.tenure !== "all" ? intent.tenure : "",
    `-rumawip -"low cost" -"rumah selangorku"`,
    `site:edgeprop.my OR site:propertyguru.com.my OR site:iproperty.com.my OR site:thestar.com.my OR site:malaymail.com OR site:nst.com.my`,
  ].filter(Boolean).join(" ");

  console.log("Step A — project discovery query:", query);

  const results = await braveSearch(query, braveApiKey, 10);
  if (results.length === 0) return [];

  const corpus = results
    .map((r: any, i: number) => `[${i + 1}] Title: ${r.title}\nSnippet: ${r.snippet ?? ""}`)
    .join("\n\n");

  const extractPrompt = `You are extracting Malaysian property project details from search result snippets.
These results are from a search for recently completed or near-completing (VP/OC) residential projects in "${intent.area}".

IMPORTANT time filter — only include projects where:
- Completion year is between ${minYear} and ${maxYear} (completed in last 3 years, or completing within 12 months)
- If completion year is unknown, include it (we cannot rule it out)
- EXCLUDE any project with a known completion year before ${minYear}

For each qualifying project, extract:
- name: proper project name (e.g. "Residensi Harmoni", "Tropicana Gardens", "Arte Plus")
- completion_year: year of VP/OC/completion if mentioned, else null
- total_units: total number of units if mentioned, else null

DO NOT include generic terms, area names alone, or developer company names alone.

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

    // Drop projects whose name contains a city indicator clearly from a different area
    // e.g. user searches "Nilai" but Claude extracts "KL48 Apartment"
    const searchedArea = intent.area.toLowerCase();
    const CITY_CONFLICTS: [string, RegExp][] = [
      ["nilai",   /\bkl\b|kuala lumpur|mont kiara|klcc|bangsar/i],
      ["rawang",  /\bkl\b|kuala lumpur|klcc|johor|penang/i],
      ["johor",   /\bkl\b|kuala lumpur|rawang|penang|ipoh/i],
      ["penang",  /\bkl\b|kuala lumpur|johor|rawang/i],
      ["ipoh",    /\bkl\b|kuala lumpur|johor|penang/i],
    ];
    const conflictRule = CITY_CONFLICTS.find(([city]) => searchedArea.includes(city));
    const conflictPattern = conflictRule?.[1];

    return items
      .filter((p) => typeof p.name === "string" && p.name.length > 3)
      // Drop projects whose name signals a different city
      .filter((p) => !conflictPattern || !conflictPattern.test(p.name))
      // Only keep projects with a known completion year within the valid window
      .filter((p) => p.completion_year !== null && p.completion_year >= minYear && p.completion_year <= maxYear)
      .slice(0, 6);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Step 3 — Per-project search on portals (Step B search)
// ---------------------------------------------------------------------------

// Extract a completion year (VP/OC) from raw text — returns null if not found / out of range
function extractYearFromText(text: string): number | null {
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 3;
  const maxYear = currentYear + 2;

  const patterns = [
    /VP\s+(?:in\s+)?Q?\d?\s*(\d{4})/i,
    /OC\s+(?:in\s+)?Q?\d?\s*(\d{4})/i,
    /vacant possession\s+(?:in\s+)?(?:Q\d\s+)?(\d{4})/i,
    /(?:expected\s+)?completion\s+(?:date\s+)?(?:in\s+)?(?:Q\d\s+)?(\d{4})/i,
    /siap\s+(\d{4})/i,
    /completed?\s+(?:in\s+)?(\d{4})/i,
    /handover\s+(?:in\s+)?(?:Q\d\s+)?(\d{4})/i,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      const yr = parseInt(m[1], 10);
      if (yr >= minYear && yr <= maxYear) return yr;
    }
  }
  return null;
}

async function searchProjectListings(
  projectName: string,
  area: string,
  braveApiKey: string
): Promise<{ listings: RawListing[]; verified_year: number | null }> {
  const currentYear = new Date().getFullYear();
  const yearTerms = [currentYear - 1, currentYear, currentYear + 1].join(" OR ");

  const query = [
    `"${projectName}"`,
    `"developer unit" OR "completing" OR "completed" OR "available unit"`,
    `(${yearTerms})`,
    `-auction -lelong -subsale -subsales -rumawip -"low cost" -"rumah selangorku"`,
    `site:propertyguru.com.my OR site:iproperty.com.my OR site:edgeprop.my`,
  ].join(" ");

  console.log(`Step B — listing search for "${projectName}":`, query);

  const results = await braveSearch(query, braveApiKey, 12);
  const listings = results.map(parseListing);

  // Cross-check completion year from listing snippets
  const combined = results.map((r: any) => `${r.title ?? ""} ${r.snippet ?? ""}`).join(" ");
  const verified_year = extractYearFromText(combined);

  return { listings, verified_year };
}

// ---------------------------------------------------------------------------
// Brave Search helper
// ---------------------------------------------------------------------------

async function braveSearch(query: string, braveApiKey: string, num = 10): Promise<any[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(num, 20)));
  url.searchParams.set("country", "my");
  url.searchParams.set("search_lang", "en");

  const res = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": braveApiKey,
    },
  });
  if (!res.ok) {
    console.error("Brave Search error:", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return (data.web?.results ?? []).map((r: any) => ({
    title: r.title ?? "",
    link: r.url ?? "",
    snippet: r.description ?? "",
  }));
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

function computeFinancials(
  listings: RawListing[],
  area: string,
  rentalOverride?: { rental_psf_real: number; rental_source_count: number } | null
): ProjectFinancials {
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

  // TL4: use real rental data if available, fall back to hardcoded constant
  const rentalPsfUsed = rentalOverride?.rental_psf_real ?? RENTAL_PSF_PER_MONTH;
  const yieldConfidence: "real" | "estimated" = rentalOverride?.rental_psf_real ? "real" : "estimated";

  const estMonthlyRental = avgSqft * rentalPsfUsed;
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
    rental_psf_real: rentalOverride?.rental_psf_real ?? null,
    rental_source_count: rentalOverride?.rental_source_count ?? 0,
    yield_confidence: yieldConfidence,
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

// ---------------------------------------------------------------------------
// TL3 — Cross-source PSF validation
// ---------------------------------------------------------------------------

function computePsfValidation(listings: RawListing[]): {
  upgrade: "validated" | null;
  psf_source_count: number;
} {
  const realPsfs = listings
    .filter((l) => l.psf && l.psf > 100 && l.psf < 2000)
    .map((l) => l.psf!);
  if (realPsfs.length < 2) return { upgrade: null, psf_source_count: realPsfs.length };
  const med = median(realPsfs);
  const agreeing = realPsfs.filter((p) => Math.abs(p - med) / med <= 0.15);
  return {
    upgrade: agreeing.length >= 2 ? "validated" : null,
    psf_source_count: agreeing.length,
  };
}

// ---------------------------------------------------------------------------
// TL4 — Real rental data via Brave Search
// ---------------------------------------------------------------------------

function parseRentalPrice(text: string): number | null {
  // Match patterns like "RM 1,500", "RM1500", "RM 2,200/month"
  const m =
    text.match(/RM\s?([\d,]+)\s?(?:\/|\s)?(?:per\s)?month/i) ||
    text.match(/RM\s?([\d,]+)\s?(?:pm|\/mo\b)/i) ||
    text.match(/RM\s?([\d,]+)/i);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ""));
  // Sanity check: Malaysian monthly rental RM 300–20,000
  return val >= 300 && val <= 20_000 ? val : null;
}

async function searchRentalListings(
  projectName: string,
  area: string,
  avgSqft: number,
  braveApiKey: string
): Promise<{ rental_psf_real: number | null; rental_source_count: number }> {
  try {
    const query = `"${projectName}" rental "per month" OR "monthly" OR "/month" site:propertyguru.com.my OR site:iproperty.com.my`;
    console.log(`TL4 — rental search for "${projectName}":`, query);

    const results = await braveSearch(query, braveApiKey, 8);
    const rentalPrices: number[] = [];

    for (const r of results) {
      const combined = `${r.title ?? ""} ${r.snippet ?? ""}`;
      const price = parseRentalPrice(combined);
      if (price) rentalPrices.push(price);
    }

    if (rentalPrices.length === 0) return { rental_psf_real: null, rental_source_count: 0 };

    const medRental = median(rentalPrices);
    const sqft = avgSqft > 0 ? avgSqft : 850;
    const rentalPsf = parseFloat((medRental / sqft).toFixed(3));

    // Sanity check: RM 0.50–5.00/sqft/month covers nearly all Malaysian markets
    if (rentalPsf < 0.5 || rentalPsf > 5.0) return { rental_psf_real: null, rental_source_count: 0 };

    console.log(`TL4 — rental PSF for "${projectName}": RM${rentalPsf} (${rentalPrices.length} src)`);
    return { rental_psf_real: rentalPsf, rental_source_count: rentalPrices.length };
  } catch (err) {
    console.warn(`TL4 rental search failed for "${projectName}":`, err);
    return { rental_psf_real: null, rental_source_count: 0 };
  }
}

// ---------------------------------------------------------------------------
// TL5 — Brickz transaction history
// ---------------------------------------------------------------------------

async function searchBrickzTransactions(
  projectName: string,
  area: string,
  braveApiKey: string
): Promise<{ low: number | null; high: number | null; count: number }> {
  try {
    const query = `"${projectName}" site:brickz.my psf OR "per sq ft" OR transaction`;
    console.log(`TL5 — brickz search for "${projectName}":`, query);

    const results = await braveSearch(query, braveApiKey, 6);
    const psfValues: number[] = [];

    for (const r of results) {
      const combined = `${r.title ?? ""} ${r.snippet ?? ""}`;
      // Match "RM 450 psf", "RM450/sqft", "RM 380 per sq ft"
      const matches = combined.matchAll(/RM\s?([\d,]+)\s?(?:psf|\/sqft|per\s?sq\.?\s?ft)/gi);
      for (const m of matches) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (val >= 100 && val <= 3000) psfValues.push(val);
      }
    }

    if (psfValues.length === 0) return { low: null, high: null, count: 0 };

    const sorted = [...psfValues].sort((a, b) => a - b);
    console.log(`TL5 — brickz PSF range for "${projectName}": RM${sorted[0]}–${sorted[sorted.length - 1]} (${sorted.length} txns)`);
    return { low: sorted[0], high: sorted[sorted.length - 1], count: sorted.length };
  } catch (err) {
    console.warn(`TL5 brickz search failed for "${projectName}":`, err);
    return { low: null, high: null, count: 0 };
  }
}

function inferState(area: string): string {
  const a = area.toLowerCase();
  if (a.includes("kuala lumpur") || a === "kl" || a.includes("kepong") || a.includes("cheras") || a.includes("bangsar") || a.includes("mont kiara") || a.includes("setapak") || a.includes("bukit jalil")) return "Kuala Lumpur";
  if (a.includes("johor") || a.includes(" jb") || a === "jb") return "Johor";
  if (a.includes("penang") || a.includes("georgetown")) return "Pulau Pinang";
  if (a.includes("ipoh") || a.includes("perak")) return "Perak";
  if (a.includes("putrajaya")) return "Putrajaya";
  if (a.includes("nilai") || a.includes("seremban") || a.includes("port dickson") || a.includes("negeri sembilan")) return "Negeri Sembilan";
  if (a.includes("melaka") || a.includes("malacca")) return "Melaka";
  if (a.includes("kota bharu") || a.includes("kelantan")) return "Kelantan";
  if (a.includes("kuantan") || a.includes("pahang")) return "Pahang";
  return "Selangor";
}

// ---------------------------------------------------------------------------
// Step C — Scrape real listing data via crawl4ai + extract with Claude
// ---------------------------------------------------------------------------

interface ScrapedListing {
  price: number | null;
  sqft: number | null;
  psf: number | null;
  developer: string | null;
  status: string | null;
}

async function scrapeListingPage(
  url: string,
  crawl4aiUrl: string,
  crawl4aiToken: string,
  anthropicKey: string
): Promise<ScrapedListing | null> {
  try {
    // Submit crawl job
    const crawlRes = await fetch(`${crawl4aiUrl}/crawl`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${crawl4aiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls: [url], priority: 8 }),
    });

    if (!crawlRes.ok) {
      console.error("crawl4ai submit error:", crawlRes.status);
      return null;
    }

    const { task_id } = await crawlRes.json();
    if (!task_id) return null;

    // Poll for result — max 12 attempts × 2s = 24s
    let markdown = "";
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const taskRes = await fetch(`${crawl4aiUrl}/task/${task_id}`, {
        headers: { "Authorization": `Bearer ${crawl4aiToken}` },
      });
      if (!taskRes.ok) continue;
      const taskData = await taskRes.json();
      if (taskData.status === "completed" && taskData.result?.markdown) {
        markdown = taskData.result.markdown;
        break;
      }
      if (taskData.status === "failed") break;
    }

    if (!markdown) return null;

    // Truncate to avoid Claude token overload — first 3000 chars has the key data
    const excerpt = markdown.slice(0, 3000);

    // Use Claude Haiku to extract structured listing data from the page
    const extractRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 300,
        temperature: 0,
        system: "You extract Malaysian property listing data. Return ONLY valid JSON. No explanation.",
        messages: [{
          role: "user",
          content: `Extract from this property listing page content:
- price: asking price in RM as a number (e.g. 450000), null if not found
- sqft: built-up size in sqft as number, null if not found
- psf: price per sqft as number, null if not found (calculate if price+sqft available)
- developer: developer/seller name as string, null if not found
- status: availability status as short string e.g. "Available", "Developer Unit", "Completed", null if not found

Return JSON: {"price":450000,"sqft":850,"psf":529,"developer":"SP Setia","status":"Developer Unit"}

Page content:
${excerpt}`,
        }],
      }),
    });

    if (!extractRes.ok) return null;
    const extractData = await extractRes.json();
    const raw = (extractData.content?.[0]?.text ?? "{}").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    const parsed = JSON.parse(raw) as ScrapedListing;

    // Calculate PSF if not present but price + sqft are
    if (!parsed.psf && parsed.price && parsed.sqft && parsed.sqft > 0) {
      parsed.psf = Math.round(parsed.price / parsed.sqft);
    }

    console.log(`Step C — scraped ${url}:`, parsed);
    return parsed;
  } catch (err) {
    console.error("scrapeListingPage error:", err);
    return null;
  }
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
    const braveApiKey = Deno.env.get("BRAVE_API_KEY");
    const crawl4aiUrl = Deno.env.get("CRAWL4AI_URL") ?? "";
    const crawl4aiToken = Deno.env.get("CRAWL4AI_TOKEN") ?? "";
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");
    if (!braveApiKey) throw new Error("BRAVE_API_KEY not set");

    // 1. Parse location + filters
    console.log("Parsing intent:", message);
    const intent = await parseIntent(message, anthropicKey);
    console.log("Intent:", JSON.stringify(intent));

    // 2. Step A — discover real project names + metadata from editorial/news sources
    const projectMetas = await findProjectNames(intent, braveApiKey, anthropicKey);

    // 3. Step B — for each project, search for available developer units on portals
    //    Run listing search, TL4 rental search, and TL5 brickz search in parallel
    const metas = projectMetas.slice(0, 5);
    const [projectListingResults, rentalResults, brickzResults] = await Promise.all([
      Promise.all(metas.map((meta) => searchProjectListings(meta.name, intent.area, braveApiKey))),
      // TL4: rental searches — needs avg_sqft estimate up front; use 850 as default
      Promise.all(metas.map((meta) => searchRentalListings(meta.name, intent.area, 850, braveApiKey))),
      // TL5: brickz transaction searches
      Promise.all(metas.map((meta) => searchBrickzTransactions(meta.name, intent.area, braveApiKey))),
    ]);

    // 4. Build project objects with financials
    const state = inferState(intent.area);
    const projects: PropertyProject[] = metas
      .map((meta, i) => {
        const { listings: rawListings, verified_year } = projectListingResults[i];
        const listings = rawListings.filter((l) => {
          if (!l.price) return true;
          if (intent.price_min && l.price < intent.price_min) return false;
          if (intent.price_max && l.price > intent.price_max) return false;
          return true;
        });

        // Year: listing snippet wins over editorial; track whether it was verified
        const finalYear = verified_year ?? meta.completion_year ?? null;
        const year_verified = verified_year !== null;
        // Pick best listing: prefer one with real PSF, then any with a URL
        const listingsWithUrl = listings.filter(l => l.listing_url);
        const realListing = listings.find(l => l.psf_confidence === "real" && l.listing_url);
        const bestListing = realListing ?? listingsWithUrl[0] ?? listings[0];

        const hasPsfConfidence = listings.some(l => l.psf_confidence === "real");

        // Most recent date
        const dates = listings.filter(l => l.listing_date).map(l => l.listing_date!);
        const lastSeen = dates.length > 0 ? dates.sort().reverse()[0] : null;

        const { availability, availability_pct } = computeAvailability(listings);

        // TL3: cross-source PSF validation
        const { upgrade: tl3Upgrade, psf_source_count } = computePsfValidation(listings);
        let psfConfidence: PropertyProject["psf_confidence"] = hasPsfConfidence ? "real" : "estimated";
        if (tl3Upgrade) psfConfidence = "validated";

        // TL4: wire real rental data into financials
        const rentalData = rentalResults[i];

        // TL5: brickz transaction data
        const brickz = brickzResults[i];

        return {
          project_name: meta.name,
          area: intent.area,
          state,
          listing_count: listings.length,
          listings,
          financials: computeFinancials(listings, intent.area, rentalData.rental_psf_real ? rentalData : null),
          completion_year: finalYear,
          year_verified,
          total_units: meta.total_units ?? null,
          best_listing_url: bestListing?.listing_url ?? null,
          best_source: bestListing?.source ?? null,
          psf_confidence: psfConfidence,
          psf_source_count,
          last_seen: lastSeen,
          availability,
          availability_pct,
          scraped_price: null,
          scraped_sqft: null,
          scraped_psf: null,
          scraped_developer: null,
          scraped_status: null,
          transaction_psf_low: brickz.low,
          transaction_psf_high: brickz.high,
          transaction_count: brickz.count,
        };
      })
      .sort((a, b) => b.financials.urgency_score - a.financials.urgency_score);

    // 5. Step C — scrape real listing pages via crawl4ai (up to 3 projects with a URL)
    if (crawl4aiUrl) {
      const scrapeTargets = projects
        .filter((p) => p.best_listing_url)
        .slice(0, 3);

      const scrapeResults = await Promise.all(
        scrapeTargets.map((p) =>
          scrapeListingPage(p.best_listing_url!, crawl4aiUrl, crawl4aiToken, anthropicKey)
        )
      );

      scrapeTargets.forEach((project, i) => {
        const scraped = scrapeResults[i];
        if (!scraped) return;

        project.scraped_price = scraped.price;
        project.scraped_sqft = scraped.sqft;
        project.scraped_psf = scraped.psf;
        project.scraped_developer = scraped.developer;
        project.scraped_status = scraped.status;

        // Override financials with real scraped PSF if available
        if (scraped.psf && scraped.psf > 100 && scraped.psf < 3000) {
          const sqft = scraped.sqft ?? project.financials.avg_sqft;
          // Preserve TL4 rental PSF if we have it, otherwise fall back to constant
          const rentalPsfUsed = project.financials.rental_psf_real ?? RENTAL_PSF_PER_MONTH;
          const estRental = sqft * rentalPsfUsed;
          const medianPrice = scraped.psf * sqft;
          const grossYield = (estRental * 12) / medianPrice * 100;
          const r = LOAN_RATE / 100 / 12;
          const n = LOAN_TENURE * 12;
          const factor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
          const bePricePerUnit = Math.max(0, (estRental - MAINT_MONTHLY - SINKING_MONTHLY) / (LTV * factor));
          const bePsf = bePricePerUnit / sqft;

          project.financials = {
            ...project.financials,
            median_psf: scraped.psf,
            gross_yield: parseFloat(grossYield.toFixed(2)),
            be_psf: Math.round(bePsf),
            bte_psf: Math.round(bePsf * 0.85),
            urgency_score: Math.max(0, Math.min(100, Math.round((grossYield - 3) * 25))),
            avg_sqft: sqft,
            est_monthly_rental: Math.round(estRental),
          };
          project.psf_confidence = "scraped";
        }

        // Update availability if scraped status has strong signal
        if (scraped.status) {
          const s = scraped.status.toLowerCase();
          if (s.includes("available") || s.includes("developer unit")) {
            project.availability = "high";
            project.availability_pct = Math.max(project.availability_pct, 75);
          } else if (s.includes("sold") || s.includes("laku")) {
            project.availability = "low";
            project.availability_pct = Math.min(project.availability_pct, 20);
          }
        }
      });

      // Re-sort after scraped financials update
      projects.sort((a, b) => b.financials.urgency_score - a.financials.urgency_score);
    }

    console.log(`Returning ${projects.length} projects`);

    // 6. Generate reply
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
