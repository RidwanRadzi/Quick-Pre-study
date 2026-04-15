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

  const pemKey = sa.private_key as string;
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
// Column mapping — matches existing "MAIN PAGE" sheet structure:
// A: No. | B: Code | C: State | D: Developer | E: Project
// F: Completion Year | G: Total Units Unsold | H: Research PIC
// I: Date of Study Completed | J: Price to Breakeven (BE)
// K: Best Price to Enter (BTE) | L: Sourcing Suggestion (Verdict)
// ---------------------------------------------------------------------------

// Tab name in single quotes because it has a space
const RANGE_BASE = "'MAIN PAGE'";

// Rows 1-2 are merged headers; data starts at row 3
const HEADER_ROWS = 2;

function makeCode(area: unknown, projectName: unknown): string {
  const src = String(area ?? projectName ?? "");
  return src
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 5);
}

function formatDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function projectToRow(p: Record<string, unknown>, rowNo: number): string[] {
  return [
    String(rowNo),                                              // A: No.
    makeCode(p.area, p.project_name),                          // B: Code
    String(p.state ?? ""),                                     // C: State
    String(p.scraped_developer ?? ""),                         // D: Developer
    String(p.project_name ?? ""),                              // E: Project
    p.completion_year != null ? String(p.completion_year) : "", // F: Completion Year
    p.total_units != null ? String(p.total_units) : "",        // G: Total Units Unsold
    "",                                                        // H: Research PIC (manual)
    formatDate(new Date()),                                    // I: Date of Study Completed
    "",                                                        // J: BE Price (manual)
    "",                                                        // K: BTE Price (manual)
    String(p.pipeline_status ?? "watchlist"),                  // L: Sourcing Suggestion
  ];
}

// ---------------------------------------------------------------------------
// Sheets API helpers
// ---------------------------------------------------------------------------

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

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
    throw new Error(`Sheets get failed: ${err}`);
  }
  const data = await res.json();
  return (data.values ?? []) as string[][];
}

async function updateRange(
  token: string,
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<void> {
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets update failed: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Read sheet state — returns last row number (col A value) and next sheet row
// ---------------------------------------------------------------------------

interface SheetState {
  existingProjectNames: Set<string>; // column E values (lowercase)
  lastNo: number;                    // last No. value in column A
  nextSheetRow: number;              // next empty sheet row (1-based)
}

async function readSheetState(
  token: string,
  spreadsheetId: string
): Promise<SheetState> {
  let rows: string[][] = [];
  try {
    rows = await getSheetData(token, spreadsheetId, `${RANGE_BASE}!A:L`);
  } catch {
    rows = [];
  }

  const existingProjectNames = new Set<string>();
  let lastNo = 0;
  let lastDataRowIndex = HEADER_ROWS - 1; // 0-based, last header row

  for (let i = HEADER_ROWS; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((cell) => !cell)) continue; // skip blank rows

    // Column A: No.
    const no = Number(row[0]);
    if (!isNaN(no) && no > 0) lastNo = no;

    // Column E: Project name (index 4)
    if (row[4]) existingProjectNames.add(row[4].toLowerCase().trim());

    lastDataRowIndex = i;
  }

  // nextSheetRow = 1-based sheet row after the last data row
  const nextSheetRow = lastDataRowIndex + 2; // +1 for 0→1-based, +1 for next row

  return { existingProjectNames, lastNo, nextSheetRow };
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

    const { action, project_name } = await req.json() as { action: string; project_name?: string };

    const supabase = createClient(supabaseUrl, supabaseKey);
    const token = await getGoogleAccessToken(serviceAccountJson);

    // Always read sheet state first
    const state = await readSheetState(token, spreadsheetId);
    console.log(`Sheet state: lastNo=${state.lastNo}, nextRow=${state.nextSheetRow}, existing=${state.existingProjectNames.size}`);

    // -------------------------------------------------------------------------
    // sync_all — append any Scout projects not already in the sheet
    // -------------------------------------------------------------------------
    if (action === "sync_all") {
      const { data: projects, error } = await supabase
        .from("projects")
        .select("*")
        .order("urgency_score", { ascending: false });

      if (error) throw new Error(`Supabase query failed: ${error.message}`);
      if (!projects || projects.length === 0) {
        return new Response(
          JSON.stringify({ ok: true, synced: 0, message: "No projects to sync" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Only append projects not already in the sheet
      const newProjects = projects.filter(
        (p) => !state.existingProjectNames.has(String(p.project_name ?? "").toLowerCase().trim())
      );

      if (newProjects.length === 0) {
        return new Response(
          JSON.stringify({ ok: true, synced: 0, message: "All projects already in sheet" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let currentNo = state.lastNo;
      let currentRow = state.nextSheetRow;
      const now = new Date().toISOString();

      for (const p of newProjects) {
        currentNo += 1;
        const row = projectToRow(p as Record<string, unknown>, currentNo);
        await updateRange(token, spreadsheetId, `${RANGE_BASE}!A${currentRow}:L${currentRow}`, [row]);
        currentRow += 1;

        // Mark synced in Supabase
        await supabase
          .from("projects")
          .update({ sheets_synced_at: now, sheets_row_id: String(currentRow - 1) })
          .eq("id", (p as Record<string, unknown>).id);
      }

      console.log(`sync_all: appended ${newProjects.length} new rows starting at sheet row ${state.nextSheetRow}`);
      return new Response(
        JSON.stringify({ ok: true, synced: newProjects.length, skipped: projects.length - newProjects.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // -------------------------------------------------------------------------
    // sync_one — append or update a single project
    // -------------------------------------------------------------------------
    if (action === "sync_one" && project_name) {
      const { data: project, error } = await supabase
        .from("projects")
        .select("*")
        .eq("project_name", project_name)
        .single();

      if (error || !project) throw new Error(`Project not found: ${project_name}`);

      const p = project as Record<string, unknown>;
      const alreadyInSheet = state.existingProjectNames.has(
        String(p.project_name ?? "").toLowerCase().trim()
      );

      if (alreadyInSheet) {
        // Project already exists — skip to avoid duplicating
        console.log(`sync_one: "${project_name}" already in sheet, skipping`);
        return new Response(
          JSON.stringify({ ok: true, synced: 0, message: "Already in sheet" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newNo = state.lastNo + 1;
      const row = projectToRow(p, newNo);
      await updateRange(token, spreadsheetId, `${RANGE_BASE}!A${state.nextSheetRow}:L${state.nextSheetRow}`, [row]);

      await supabase
        .from("projects")
        .update({
          sheets_synced_at: new Date().toISOString(),
          sheets_row_id: String(state.nextSheetRow),
        })
        .eq("project_name", project_name);

      console.log(`sync_one: appended "${project_name}" at row ${state.nextSheetRow} as No. ${newNo}`);
      return new Response(
        JSON.stringify({ ok: true, synced: 1, row: state.nextSheetRow, no: newNo }),
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
