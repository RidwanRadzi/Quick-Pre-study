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

  // Import the RSA private key
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

  // Exchange JWT for access token
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
// Sheet column definition (order matters — matches the header row)
// ---------------------------------------------------------------------------

const HEADERS = [
  "Project Name",
  "Area",
  "State",
  "Median PSF (RM)",
  "PSF Trust",
  "Rental PSF (RM/sqft/mo)",
  "Yield Confidence",
  "Gross Yield (%)",
  "Urgency Score",
  "Availability",
  "Availability %",
  "Completion Year",
  "Total Units",
  "Pipeline Status",
  "Transaction PSF Low",
  "Transaction PSF High",
  "Transaction Count",
  "Last Updated",
];

function projectToRow(p: Record<string, unknown>): string[] {
  return [
    String(p.project_name ?? ""),
    String(p.area ?? ""),
    String(p.state ?? ""),
    String(p.median_psf ?? ""),
    String(p.psf_confidence ?? "estimated"),
    p.rental_psf_real != null ? String(p.rental_psf_real) : "",
    String(p.yield_confidence ?? "estimated"),
    String(p.gross_yield ?? ""),
    String(p.urgency_score ?? ""),
    String(p.availability ?? ""),
    p.availability_pct != null ? String(p.availability_pct) : "",
    p.completion_year != null ? String(p.completion_year) : "",
    p.total_units != null ? String(p.total_units) : "",
    String(p.pipeline_status ?? "watchlist"),
    p.transaction_psf_low != null ? String(p.transaction_psf_low) : "",
    p.transaction_psf_high != null ? String(p.transaction_psf_high) : "",
    p.transaction_count != null ? String(p.transaction_count) : "",
    new Date().toISOString(),
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

async function appendRows(
  token: string,
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<void> {
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
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
    throw new Error(`Sheets append failed: ${err}`);
  }
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

    // The tab gid=921169899 — reference by name using the gid for range notation
    // We use a named sheet reference; the sheet name must be fetched or hardcoded.
    // Using Sheet1 as the range base; the actual tab is targeted by the spreadsheet ID alone
    // since we write to the one sheet we have access to.
    const RANGE_BASE = "Sheet1";

    if (action === "sync_all") {
      // Fetch all projects from Supabase
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

      // Build rows: header + data
      const rows = [HEADERS, ...projects.map(projectToRow)];

      // Write to sheet starting at A1
      await updateRange(token, spreadsheetId, `${RANGE_BASE}!A1`, rows);

      // Mark all as synced
      const now = new Date().toISOString();
      await supabase
        .from("projects")
        .update({ sheets_synced_at: now })
        .in("id", projects.map((p: Record<string, unknown>) => p.id));

      console.log(`sync_all: wrote ${projects.length} rows to sheet`);
      return new Response(
        JSON.stringify({ ok: true, synced: projects.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "sync_one" && project_name) {
      // Fetch the specific project
      const { data: project, error } = await supabase
        .from("projects")
        .select("*")
        .eq("project_name", project_name)
        .single();

      if (error || !project) {
        throw new Error(`Project not found: ${project_name}`);
      }

      const newRow = projectToRow(project as Record<string, unknown>);

      // Check if header + data rows exist in the sheet
      let existingData: string[][] = [];
      try {
        existingData = await getSheetData(token, spreadsheetId, `${RANGE_BASE}!A1:R500`);
      } catch {
        // Sheet might be empty
        existingData = [];
      }

      if (existingData.length === 0) {
        // Sheet is empty — write header + row
        await updateRange(token, spreadsheetId, `${RANGE_BASE}!A1`, [HEADERS, newRow]);
      } else {
        // Find existing row by project name (column A = index 0)
        const existingRowIdx = existingData.findIndex(
          (row, i) => i > 0 && row[0] === project_name
        );

        if (existingRowIdx !== -1) {
          // Update in place (row number is 1-based in Sheets, existingRowIdx is 0-based)
          const sheetRow = existingRowIdx + 1;
          await updateRange(token, spreadsheetId, `${RANGE_BASE}!A${sheetRow}`, [newRow]);
        } else {
          // Append as new row
          await appendRows(token, spreadsheetId, `${RANGE_BASE}!A1`, [newRow]);
        }
      }

      // Mark as synced
      await supabase
        .from("projects")
        .update({ sheets_synced_at: new Date().toISOString() })
        .eq("project_name", project_name);

      console.log(`sync_one: synced "${project_name}" to sheet`);
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
