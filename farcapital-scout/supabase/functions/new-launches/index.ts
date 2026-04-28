import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Top 10 Malaysian developers (searched first)
// ---------------------------------------------------------------------------

const TOP_10_DOMAINS = [
  "sp-setia.com",
  "simedarbyproperty.com",
  "ioiproperties.com.my",
  "sunway.com.my",
  "mah-sing.com",
  "gamuda.com.my",
  "ecoworld.com.my",
  "ijmland.com",
  "uemsunrise.com",
  "tropicana.com.my",
];

// Top 11–50 — expanded if top-10 yields < 3 results
const TOP_50_EXTRA_DOMAINS = [
  "paramountproperty.com.my",
  "matrixconcepts.com",
  "ksl.com.my",
  "scientex.com.my",
  "glomac.com.my",
  "tambunindah.com.my",
  "brdb.com.my",
  "nazattdi.com",
  "pavilion.com.my",
  "eramaju.com.my",
  "talisman-property.com",
  "mahbuild.com.my",
  "crescentland.com.my",
  "mklgroup.com.my",
  "kenanga-dev.com.my",
];

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
  if (!res.ok) return [];
  const data = await res.json();
  return data.organic_results ?? [];
}

// ---------------------------------------------------------------------------
// Parse area from user message
// ---------------------------------------------------------------------------

async function parseArea(message: string, anthropicKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 60,
      temperature: 0,
      system: "Return only the area/location name from the user message. No explanation.",
      messages: [{ role: "user", content: `Extract the area or location from: "${message}". Return just the place name.` }],
    }),
  });
  if (!res.ok) return message;
  const d = await res.json();
  return (d.content?.[0]?.text ?? message).trim();
}

// ---------------------------------------------------------------------------
// Search developer sites for new launches in area
// ---------------------------------------------------------------------------

async function searchDeveloperLaunches(
  area: string,
  domains: string[],
  serpApiKey: string
): Promise<any[]> {
  const currentYear = new Date().getFullYear();
  const siteFilter = domains.map((d) => `site:${d}`).join(" OR ");
  const query = [
    `"${area}"`,
    `"new launch" OR "new project" OR "pelancaran baru" OR "for sale" OR "coming soon"`,
    `${currentYear} OR ${currentYear + 1}`,
    `-subsale -auction -lelong -rumawip`,
    `(${siteFilter})`,
  ].join(" ");

  console.log("New Launches — developer search:", query);
  return serpApiSearch(query, serpApiKey, 10);
}

// ---------------------------------------------------------------------------
// Also search PropertyGuru new project section
// ---------------------------------------------------------------------------

async function searchPropertyGuruNewLaunches(area: string, serpApiKey: string): Promise<any[]> {
  const currentYear = new Date().getFullYear();
  const query = [
    `"${area}"`,
    `"new launch" OR "new project"`,
    `${currentYear} OR ${currentYear + 1}`,
    `-subsale -auction`,
    `site:propertyguru.com.my/new-property OR site:propertyguru.com.my/developer`,
  ].join(" ");

  console.log("New Launches — PropertyGuru search:", query);
  return serpApiSearch(query, serpApiKey, 8);
}

// ---------------------------------------------------------------------------
// Claude extracts structured project list from snippets
// ---------------------------------------------------------------------------

interface NewLaunchProject {
  project_name: string;
  developer: string;
  area: string;
  state: string;
  price_from: number | null;
  price_to: number | null;
  property_type: string;
  unit_sizes: string | null;
  expected_vp: string | null;
  source_url: string | null;
  source_domain: string;
  tenure: string | null;
  snippet: string;
}

async function extractNewLaunches(
  rawResults: any[],
  area: string,
  anthropicKey: string
): Promise<NewLaunchProject[]> {
  if (rawResults.length === 0) return [];

  const corpus = rawResults
    .slice(0, 15)
    .map((r: any, i: number) =>
      `[${i + 1}] URL: ${r.link ?? ""}\nTitle: ${r.title ?? ""}\nSnippet: ${r.snippet ?? ""}`
    )
    .join("\n\n");

  const prompt = `You are extracting Malaysian property NEW LAUNCH details from search results.
Area searched: "${area}"

For each NEW LAUNCH project found, extract:
- project_name: proper project name (not developer name alone)
- developer: developer/company name
- area: specific area/township
- state: Malaysian state (e.g. "Selangor", "Kuala Lumpur", "Johor")
- price_from: minimum price in RM (integer, e.g. 380000) or null
- price_to: maximum price in RM (integer) or null
- property_type: "Condominium", "Serviced Apartment", "Townhouse", "SOHO", "Apartment", or "Mixed"
- unit_sizes: size range e.g. "650–1,200 sqft" or null
- expected_vp: expected VP/OC/handover e.g. "Q3 2027", "2026", or null
- source_url: the URL this was found at (from the result)
- source_domain: domain of the URL (e.g. "sp-setia.com")
- tenure: "Freehold", "Leasehold", or null
- snippet: 1-sentence description of the project

RULES:
- Only include genuine NEW LAUNCH projects (not subsale, not resale)
- Must be in or near "${area}"
- Skip generic "properties for sale" listing pages
- Max 8 projects
- Return ONLY valid JSON array

Example:
[{"project_name":"Setia Utama 5","developer":"SP Setia","area":"Shah Alam","state":"Selangor","price_from":450000,"price_to":800000,"property_type":"Condominium","unit_sizes":"850–1,200 sqft","expected_vp":"Q4 2027","source_url":"https://sp-setia.com/...","source_domain":"sp-setia.com","tenure":"Freehold","snippet":"Gated condominium with full facilities launching in Shah Alam."}]

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
      max_tokens: 1200,
      temperature: 0.1,
      system: "Return only valid JSON. No explanation.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) return [];

  const d = await res.json();
  const txt = (d.content?.[0]?.text ?? "[]")
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const items = JSON.parse(txt) as NewLaunchProject[];
    return items.filter((p) => typeof p.project_name === "string" && p.project_name.length > 3);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Generate reply message
// ---------------------------------------------------------------------------

async function generateReply(
  area: string,
  launches: NewLaunchProject[],
  anthropicKey: string
): Promise<string> {
  if (launches.length === 0) {
    return `Tiada new launch ditemui bagi ${area} daripada top developer Malaysia buat masa ini. Cuba cari kawasan lain atau semak terus laman web developer.`;
  }

  const summary = launches
    .slice(0, 5)
    .map((l) => `${l.project_name} by ${l.developer}${l.price_from ? ` from RM ${(l.price_from / 1000).toFixed(0)}k` : ""}`)
    .join(", ");

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
      system: "You are FarCapital Scout. Reply in 2 sentences max, Manglish style. Be informative and concise.",
      messages: [{
        role: "user",
        content: `Summarise these new launches in ${area}: ${summary}. Mention count and price range.`,
      }],
    }),
  });

  if (!res.ok) return `Jumpa ${launches.length} new launch di ${area}.`;
  const d = await res.json();
  return (d.content?.[0]?.text ?? `Jumpa ${launches.length} new launch di ${area}.`).trim();
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

    // 1. Parse area
    const area = await parseArea(message, anthropicKey);
    console.log("New Launches — area:", area);

    // 2. Search top 10 developer sites + PropertyGuru in parallel
    const [devResults, pgResults] = await Promise.all([
      searchDeveloperLaunches(area, TOP_10_DOMAINS, serpApiKey),
      searchPropertyGuruNewLaunches(area, serpApiKey),
    ]);

    let allResults = [...devResults, ...pgResults];
    console.log(`New Launches — top-10 + PG results: ${allResults.length}`);

    // 3. If fewer than 3 results, expand to top 50
    if (devResults.length < 3) {
      console.log("New Launches — expanding to top-50 developers");
      const extraResults = await searchDeveloperLaunches(area, TOP_50_EXTRA_DOMAINS, serpApiKey);
      allResults = [...allResults, ...extraResults];
      console.log(`New Launches — after expansion: ${allResults.length}`);
    }

    // 4. Claude extracts structured launches
    const launches = await extractNewLaunches(allResults, area, anthropicKey);
    console.log("New Launches — extracted:", launches.length);

    // 5. Generate reply
    const replyMessage = await generateReply(area, launches, anthropicKey);

    return new Response(
      JSON.stringify({ message: replyMessage, launches, area }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("new-launches error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
