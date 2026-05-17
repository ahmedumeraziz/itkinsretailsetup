import { APPS_SCRIPT_URL, SCRIPT_TOKEN, SHEET_URLS, REQUIRED_HEADERS } from "../config";

// ─── SCRIPT CALLER ────────────────────────────────────────────────────────────
export async function callScript(payload) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("YOUR_")) return;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...payload, token: SCRIPT_TOKEN }),
      redirect: "follow",
    });
  } catch (e) {
    console.warn("Script call failed:", e.message);
  }
}

// ─── SCRIPT PING (with CORS response) ────────────────────────────────────────
export async function pingScript() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("YOUR_")) {
    return { ok: false, msg: "Script URL not configured" };
  }
  try {
    // GET ping — Apps Script doGet returns JSON
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(APPS_SCRIPT_URL, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, msg: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, msg: data.message || "Script online", version: data.version || "" };
  } catch (e) {
    return { ok: false, msg: e.message || "Unreachable" };
  }
}

// ─── SEND REPAIR VIA SCRIPT ───────────────────────────────────────────────────
export async function autoRepairSheets() {
  await callScript({ action: "ensureHeaders" });
}

// ─── SEND GENERATE ALL SHEETS ─────────────────────────────────────────────────
export async function generateAllSheets() {
  await callScript({ action: "generateAllSheets" });
}

// ─── DEEP CONNECTION TEST ─────────────────────────────────────────────────────
// Tests every sheet URL + script ping. Returns per-sheet results.
export async function deepTestConnections() {
  const results = {};
  const sheetKeys = ["items", "categories", "cashiers", "sales", "stocklog", "customers", "returns", "hr"];

  await Promise.all(sheetKeys.map(async key => {
    const r = {
      ok: false,
      reachable: false,
      headers: [],
      missingHeaders: [],
      extraHeaders: [],
      rowCount: 0,
      extraInfo: "",
    };
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(SHEET_URLS[key] + "&t=" + Date.now(), {
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!res.ok) { r.extraInfo = `HTTP ${res.status} — Sheet tab may not exist`; results[key] = r; return; }
      r.reachable = true;
      const text = await res.text();
      const lines = text.trim().split("\n");
      if (lines.length < 1 || text.trim() === "") {
        r.extraInfo = "Sheet is empty — no header row found";
        results[key] = r;
        return;
      }
      // Parse header row
      const rawHeaders = lines[0].split(",").map(h =>
        h.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").replace(/\s+/g, "").trim()
      );
      r.headers    = rawHeaders;
      r.rowCount   = Math.max(0, lines.length - 1);
      const required = REQUIRED_HEADERS[key] || [];
      r.missingHeaders = required.filter(rh => !rawHeaders.includes(rh));
      r.extraHeaders   = rawHeaders.filter(h => h && !required.includes(h));
      r.ok = r.missingHeaders.length === 0;
      if (r.ok) {
        r.extraInfo = `${r.rowCount} rows · All ${required.length} headers ✓`;
      } else {
        r.extraInfo = `Missing: ${r.missingHeaders.join(", ")}`;
      }
    } catch (e) {
      r.extraInfo = e.name === "AbortError" ? "Timeout — check internet" : e.message;
    }
    results[key] = r;
  }));

  // Script ping
  const scriptResult = await pingScript();
  results.script = {
    ok: scriptResult.ok,
    reachable: scriptResult.ok,
    headers: [],
    missingHeaders: [],
    extraInfo: scriptResult.ok
      ? `✓ Online — ${scriptResult.msg}`
      : `✗ ${scriptResult.msg}`,
  };

  return results;
}
