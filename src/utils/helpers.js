// ─── UTILITIES ────────────────────────────────────────────────────────────────
export const fmt = n => parseFloat(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const getNow = () => { const d = new Date(); return { date: d.toLocaleDateString("en-GB"), time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) }; };

// Convert sale date DD/MM/YYYY → YYYY-MM-DD for reliable comparison
export function parseSaleDate(saleDate) {
  if (!saleDate) return "";
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return saleDate;
  // DD/MM/YYYY
  const parts = saleDate.split("/");
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
  return saleDate;
}

// Single-date equality (used by Returns tab)
export function filterDateMatch(saleDate, filterVal) {
  if (!filterVal) return true;
  return parseSaleDate(saleDate) === filterVal;
}

// Date range filter — filterFrom and filterTo are YYYY-MM-DD from <input type="date">
export function dateInRange(saleDate, filterFrom, filterTo) {
  if (!filterFrom && !filterTo) return true;
  const d = parseSaleDate(saleDate);
  if (!d) return true;
  if (filterFrom && d < filterFrom) return false;
  if (filterTo   && d > filterTo)   return false;
  return true;
}

export function safeParseItems(str) {
  if (!str || str.trim() === "") return [];
  try { const r = JSON.parse(str); return Array.isArray(r) ? r : []; } catch (e) { return []; }
}

// ─── EXPIRY HELPERS ───────────────────────────────────────────────────────────
export function getExpiryStatus(expiryDate) {
  if (!expiryDate) return { status: "none", label: "No Date", color: "rgba(255,255,255,0.22)", daysLeft: null };
  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = new Date(expiryDate); exp.setHours(0,0,0,0);
  const diff  = Math.round((exp - today) / (1000 * 60 * 60 * 24));
  if (diff < 0)   return { status: "expired",  label: `Expired ${Math.abs(diff)}d ago`, color: "#ff4444", daysLeft: diff };
  if (diff === 0) return { status: "today",    label: "Expires Today!",                 color: "#ff6b00", daysLeft: 0  };
  if (diff <= 7)  return { status: "critical", label: `${diff}d left`,                  color: "#ff6b00", daysLeft: diff };
  if (diff <= 30) return { status: "warning",  label: `${diff}d left`,                  color: "#ffd700", daysLeft: diff };
  return { status: "ok", label: `${diff}d left`, color: "#00e5a0", daysLeft: diff };
}

export function fmtExpiry(expiryDate) {
  if (!expiryDate) return "—";
  const [y, m, d] = expiryDate.split("-");
  return `${d}/${m}/${y}`;
}

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
function normalizeKey(h) { return h.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").replace(/\s+/g, "").trim(); }

export function parseCSV(text) {
  const lines = []; let cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQ = !inQ; cur += ch; }
    else if (ch === "\n" && !inQ) { lines.push(cur); cur = ""; }
    else if (ch === "\r" && !inQ) { /*skip*/ }
    else cur += ch;
  }
  if (cur) lines.push(cur);
  if (lines.length < 2) return [];
  const parseRow = row => {
    const vals = []; let field = "", q = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') { if (q && row[i + 1] === '"') { field += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { vals.push(field.trim()); field = ""; }
      else field += ch;
    }
    vals.push(field.trim()); return vals;
  };
  const headers = parseRow(lines[0]).map(normalizeKey);
  return lines.slice(1).map(line => {
    const vals = parseRow(line);
    const obj = {}; headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  }).filter(row => Object.values(row).some(v => v !== ""));
}

// ─── SEARCH INDEX ─────────────────────────────────────────────────────────────
export function buildSearchIndex(items) {
  const index = new Map();
  items.forEach(item => {
    const tokens = [
      item.Barcode?.toLowerCase(),
      ...(item.ItemName?.toLowerCase().split(/\s+/) || []),
      item.Category?.toLowerCase(),
      item.Company?.toLowerCase(),
    ].filter(Boolean);
    tokens.forEach(token => {
      for (let len = 1; len <= token.length; len++) {
        const prefix = token.slice(0, len);
        if (!index.has(prefix)) index.set(prefix, new Set());
        index.get(prefix).add(item.Barcode);
      }
    });
  });
  return index;
}
