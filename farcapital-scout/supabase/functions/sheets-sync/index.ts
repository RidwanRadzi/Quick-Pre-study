import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Google OAuth2 — sign a JWT with the service account and exchange for token
// ---------------------------------------------------------------------------

async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const signingInput = `${encode(header)}.${encode(payload)}`;

  // Fix: handle both real \n and escaped \\n that can occur when storing in Supabase secrets
  const pemKey = (sa.private_key as string).replace(/\\n/g, "\n");
  const pemBody = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const inputBytes = new TextEncoder().encode(signingInput);
  const sigBytes = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, inputBytes);
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const jwt = `${signingInput}.${sig}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token as string;
}

// ---------------------------------------------------------------------------
// Column layout — matches the user's existing sheet exactly
// A: No. | B: Code | C: State | D: Developer | E: Project
// F: Completion Year | G: Total Units Unsold | H: Research PIC (blank)
// I: Date of Study Completed | J: BE Price | K: BTE Price (blank) | L: Verdict
// ---------------------------------------------------------------------------

function makeCode(projectName: string): string {
  // Generate initials from project name words (uppercase, max 4 chars)
  return projectName
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w[0].toUpperCase())
    .join("")
    .slice(0, 4);
}

function todayDMY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function projectToRow(p: Record<string, unknown>, rowNo: number): string[] {
  const bePsf = p.be_psf != null ? `RM ${p.be_psf} psf` : "";
  return [
    String(rowNo),                                        // A: No.
    makeCode(String(p.project_name ?? "")),               // B: Code
    String(p.state ?? ""),                                // C: State
    String(p.scraped_developer ?? "—"),                   // D: Developer
    String(p.project_name ?? ""),                         // E: Project
    p.completion_year != null ? String(p.completion_year) : "", // F: Completion Year
    p.total_units != null ? String(p.total_units) : "",   // G: Total Units Unsold
    "",                                                   // H: Research PIC (manual)
    todayDMY(),                                           // I: Date of Study Completed
    bePsf,                                                // J: BE Price
    "",                                                   // K: BTE Price (manual)
    String(p.pipeline_status ?? "watchlist"),             // L: Verdict
  ];
}

// ---------------------------------------------------------------------------
// Sheets API helpers
// ---------------------------------------------------------------------------

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TAB = "Sheet1";

async function getSheetData(
  token: string,
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets get failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return (data.values ?? []) as string[][];
}

async function appendRows(
  token: string,
  spreadsheetId: string,
  values: string[][]
): Promise<void> {
  const range = `${TAB}!A:L`;
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ majorDimension: "ROWS", values }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets append failed (${res.status}): ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Read existing sheet to get last No. and existing project names (col E)
// ---------------------------------------------------------------------------

interface SheetState {
  lastNo: number;
  existingProjects: Set<string>;
}

async function readSheetState(
  token: string,
  spreadsheetId: string
): Promise<SheetState> {
  let rows: string[][] = [];
  try {
    rows = await getSheetData(token, spreadsheetId, `${TAB}!A:E`);
  } catch {
    // Sheet might be empty or tab not found — treat as empty
    return { lastNo: 0, existingProjects: new Set() };
  }

  let lastNo = 0;
  const existingProjects = new Set<string>();

  for (const row of rows) {
    // Col A (index 0) = No. — try to parse as integer
    const no = parseInt(row[0] ?? "", 10);
    if (!isNaN(no) && no > lastNo) lastNo = no;

    // Col E (index 4) = Project name
    const projectName = (row[4] ?? "").trim();
    if (projectName) existingProjects.add(projectName.toLowerCase());
  }

  return { lastNo, existingProjects };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    const spreadsheetId = Deno.env.get("GOOGLE_SHEET_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
    if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID not set");
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase env vars not set");

    const body = await req.json() as { action: string; project_name?: string };
    const { action, project_name } = body;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const token = await getGoogleAccessToken(serviceAccountJson);

    // -----------------------------------------------------------------------
    // sync_all — append all Supabase projects not already in the sheet
    // -----------------------------------------------------------------------
    if (action === "sync_all") {
      const { data: projects, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw new Error(`Supabase query failed: ${error.message}`);
      if (!projects || projects.length === 0) {
        return new Response(
          JSON.stringify({ ok: true, synced: 0, message: "No projects to sync" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Read existing sheet state
      const { lastNo, existingProjects } = await readSheetState(token, spreadsheetId);

      // Filter to only new projects
      const newProjects = projects.filter(
        (p) => !existingProjects.has((p.project_name ?? "").toLowerCase())
      );

      if (newProjects.length === 0) {
        return new Response(
          JSON.stringify({ ok: true, synced: 0, message: "All projects already in sheet" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Build rows with incrementing No.
      const rows = newProjects.map((p, i) =>
        projectToRow(p as Record<string, unknown>, lastNo + i + 1)
      );

      await appendRows(token, spreadsheetId, rows);

      // Mark as synced in Supabase
      const now = new Date().toISOString();
      await supabase
        .from("projects")
        .update({ sheets_synced_at: now })
        .in("id", newProjects.map((p) => p.id));

      console.log(`sync_all: appended ${rows.length} new rows (starting No. ${lastNo + 1})`);
      return new Response(
        JSON.stringify({ ok: true, synced: rows.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // -----------------------------------------------------------------------
    // sync_one — append a single project if not already in sheet
    // -----------------------------------------------------------------------
    if (action === "sync_one" && project_name) {
      const { data: project, error } = await supabase
        .from("projects")
        .select("*")
        .eq("project_name", project_name)
        .single();

      if (error || !project) {
        throw new Error(`Project not found: ${project_name}`);
      }

      const { lastNo, existingProjects } = await readSheetState(token, spreadsheetId);

      if (existingProjects.has(project_name.toLowerCase())) {
        // Already in sheet — skip silently
        console.log(`sync_one: "${project_name}" already in sheet, skipped`);
        return new Response(
          JSON.stringify({ ok: true, synced: 0, message: "Already in sheet" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newRow = projectToRow(project as Record<string, unknown>, lastNo + 1);
      await appendRows(token, spreadsheetId, [newRow]);

      await supabase
        .from("projects")
        .update({ sheets_synced_at: new Date().toISOString() })
        .eq("project_name", project_name);

      console.log(`sync_one: appended "${project_name}" as No. ${lastNo + 1}`);
      return new Response(
        JSON.stringify({ ok: true, synced: 1 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("sheets-sync error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
