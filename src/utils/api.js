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
      redirect: "follow"
    });
    console.log("✅ Sent:", payload.action);
  } catch (e) { console.warn("Script call failed:", e.message); }
}

// ─── DEEP CONNECTION TEST ─────────────────────────────────────────────────────
export async function deepTestConnections() {
  const results = {};
  const sheetKeys = ["items", "categories", "cashiers", "sales", "stocklog", "customers", "returns"];
  await Promise.all(sheetKeys.map(async key => {
    const r = { ok: false, reachable: false, headers: [], missingHeaders: [], extraInfo: "" };
    try {
      const res = await fetch(SHEET_URLS[key], { cache: "no-store" });
      if (!res.ok) { r.extraInfo = `HTTP ${res.status}`; results[key] = r; return; }
      r.reachable = true;
      const text = await res.text();
      const lines = text.trim().split("\n");
      if (lines.length < 1) { r.extraInfo = "Sheet is empty — no header row"; results[key] = r; return; }
      const raw = lines[0].split(",").map(h => h.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").replace(/\s+/g, "").trim());
      r.headers = raw;
      const required = REQUIRED_HEADERS[key] || [];
      r.missingHeaders = required.filter(rh => !raw.includes(rh));
      r.ok = r.missingHeaders.length === 0;
      r.extraInfo = r.ok ? `${lines.length - 1} data rows` : `Missing: ${r.missingHeaders.join(", ")}`;
    } catch (e) { r.extraInfo = e.message; }
    results[key] = r;
  }));
  const sr = { ok: false, reachable: false, extraInfo: "" };
  try { await fetch(APPS_SCRIPT_URL, { method: "GET", mode: "no-cors" }); sr.ok = true; sr.reachable = true; sr.extraInfo = "Reachable"; } catch (e) { sr.extraInfo = "Cannot reach"; }
  results.script = sr;
  return results;
}

export async function autoRepairSheets() { await callScript({ action: "ensureHeaders" }); }
