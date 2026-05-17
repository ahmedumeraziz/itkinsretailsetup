// ─── SHEET CONFIG ─────────────────────────────────────────────────────────────
export const SHEET_ID        = "1_iXcsPI8C1g0UQaAcacbKjsHq9AWI3IRIsCbX2E87qk";
export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyZNvFVRBFRz8gIkbxnQDjAp-y2du0-3g2BGrf2EECm1maPqGJdiUwnyEwC4lTsT_IS/exec";

export const SHEET_URLS = {
  items:      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
  categories: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1073637718`,
  cashiers:   `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=2059868600`,
  sales:      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=968224820`,
  stocklog:   `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1905792112`,
  customers:  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=505470885`,
  returns:    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1759563627`,
  hr:         `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=111222333`,
};

export const REQUIRED_HEADERS = {
  items:      ["Barcode","Category","Company","ItemName","Price","CostPrice","Discount","Stock","ExpiryDate",
               "variable_unit_enabled","piece_sale_price","piece_cost_price","pieces_per_box","boxes_per_cotton",
               "box_sale_price","box_cost_price","cotton_sale_price","cotton_cost_price"],
  categories: ["CategoryName"],
  cashiers:   ["Name","Username","PIN","Role"],
  sales:      ["BillNo","Date","Time","Cashier","GrandTotal","Discount","FBR","PaymentMethod","ItemsDetail","CustomerName","CustomerCell","RefundApplied","RefundReturnNo"],
  stocklog:   ["Date","Barcode","ItemName","StockBefore","StockAfter","Reason"],
  customers:  ["Name","CellNo","BillNo","Payments","OpeningDebit"],
  returns:    ["ReturnNo","OrigBillNo","Date","Time","Cashier","Items","RefundAmount","Reason","UsedInBill"],
  hr:         ["ID","Type","Name","Category","Amount","Date","Note"],
};

export const SCRIPT_TOKEN = "itKINS@POS#2024$Secure!";

// ─── LIGHT THEME TOKENS ───────────────────────────────────────────────────────
export const T = {
  // Backgrounds
  bgPage:    "#f0f4f8",       // page / root background
  bgCard:    "#ffffff",       // cards, panels
  bgCardAlt: "#f8fafc",       // alternate card / subtle panels
  bgInput:   "#ffffff",       // input backgrounds
  bgSidebar: "#1e3a5f",       // POS right panel / dark sidebar
  bgTopBar:  "#1e3a5f",       // top bars
  bgTabAct:  "#2563eb",       // active tab background
  bgTabHov:  "#eff6ff",       // tab hover
  bgHover:   "#eff6ff",       // row hover
  bgOverlay: "rgba(15,30,60,0.55)", // modal overlays

  // Borders
  border:     "#d1dce8",      // default border
  borderFocus:"#2563eb",      // focused input border
  borderLight:"#e8eef4",      // very subtle border

  // Text
  textPrimary:   "#0f172a",   // headings, important text
  textSecondary: "#475569",   // body text
  textMuted:     "#94a3b8",   // placeholders, hints
  textInverse:   "#ffffff",   // text on dark backgrounds
  textOnAccent:  "#ffffff",   // text on accent buttons

  // Accent
  accent:        "#2563eb",   // primary blue
  accentHover:   "#1d4ed8",   // darker blue
  accentLight:   "#eff6ff",   // very light blue tint
  accentBorder:  "#bfdbfe",   // light blue border

  // Status colors
  success:       "#059669",   // green
  successLight:  "#ecfdf5",
  successBorder: "#a7f3d0",
  warning:       "#d97706",   // amber
  warningLight:  "#fffbeb",
  warningBorder: "#fde68a",
  danger:        "#dc2626",   // red
  dangerLight:   "#fef2f2",
  dangerBorder:  "#fecaca",
  info:          "#0284c7",   // sky blue
  infoLight:     "#f0f9ff",
  infoBorder:    "#bae6fd",

  // POS specific
  posGreen:  "#059669",       // "paid / in stock / save" green
  posOrange: "#ea580c",       // warnings, returns
  posGold:   "#b45309",       // discounts

  // Shadows
  shadow:    "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:  "0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.04)",
  shadowLg:  "0 10px 25px rgba(0,0,0,0.12), 0 4px 10px rgba(0,0,0,0.06)",
};

// ─── SHARED INPUT / LABEL STYLES ─────────────────────────────────────────────
export const inSt = {
  padding: "9px 12px",
  background: T.bgInput,
  border: `1px solid ${T.border}`,
  borderRadius: 7,
  color: T.textPrimary,
  fontSize: 13,
  outline: "none",
  width: "100%",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

export const slSt = {
  padding: "9px 12px",
  background: T.bgInput,
  border: `1px solid ${T.border}`,
  borderRadius: 7,
  color: T.textPrimary,
  fontSize: 13,
  outline: "none",
  cursor: "pointer",
};

export const lbSt = {
  display: "block",
  color: T.accent,
  fontSize: 10,
  letterSpacing: 1.5,
  marginBottom: 5,
  fontWeight: 700,
  textTransform: "uppercase",
};

export const bdgSt = color => {
  const map = {
    "#00b4ff": { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
    "#fff":    { bg: "#f1f5f9", border: "#cbd5e1", text: "#334155" },
    "#ff6b6b": { bg: "#fef2f2", border: "#fecaca", text: "#dc2626" },
    "#00e5a0": { bg: "#ecfdf5", border: "#a7f3d0", text: "#059669" },
    "#ffd700": { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
    "#ff9500": { bg: "#fff7ed", border: "#fed7aa", text: "#c2410c" },
  };
  const m = map[color] || { bg: "#f1f5f9", border: "#cbd5e1", text: "#334155" };
  return {
    background: m.bg,
    border: `1px solid ${m.border}`,
    borderRadius: 20,
    padding: "3px 11px",
    color: m.text,
    fontSize: 11,
    fontWeight: 700,
  };
};
