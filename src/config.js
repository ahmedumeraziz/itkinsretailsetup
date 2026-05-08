// ─── CONFIG ───────────────────────────────────────────────────────────────────
export const SHEET_ID        = "1_iXcsPI8C1g0UQaAcacbKjsHq9AWI3IRIsCbX2E87qk";
export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzDhidE__TMvfqiyLxOTsk_Bkn3vmVEpYPIx-x9vP6UEe9bBaOvo9TgDf6OWgxynnwZ/exec";

export const SHEET_URLS = {
  items:      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
  categories: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1073637718`,
  cashiers:   `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=2059868600`,
  sales:      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=968224820`,
  stocklog:   `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1905792112`,
  customers:  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=505470885`,
  returns:    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1759563627`,
};

export const REQUIRED_HEADERS = {
  items:      ["Barcode","Category","Company","ItemName","Price","CostPrice","Discount","Stock","ExpiryDate"],
  categories: ["CategoryName"],
  cashiers:   ["Name","Username","PIN","Role"],
  sales:      ["BillNo","Date","Time","Cashier","GrandTotal","Discount","FBR","PaymentMethod","ItemsDetail","CustomerName","CustomerCell"],
  stocklog:   ["Date","Barcode","ItemName","StockBefore","StockAfter","Reason"],
  customers:  ["Name","CellNo","BillNo","Payments"],
  returns:    ["ReturnNo","OrigBillNo","Date","Time","Cashier","Items","RefundAmount","Reason","UsedInBill"],
};

export const SCRIPT_TOKEN = "itKINS@POS#2024$Secure!";

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
export const inSt  = { padding: "9px 12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,180,255,0.22)", borderRadius: 7, color: "#fff", fontSize: 13, outline: "none", width: "100%" };
export const slSt  = { padding: "9px 12px", background: "#0c1828", border: "1px solid rgba(0,180,255,0.22)", borderRadius: 7, color: "#fff", fontSize: 13, outline: "none", cursor: "pointer" };
export const lbSt  = { display: "block", color: "rgba(0,180,255,0.68)", fontSize: 10, letterSpacing: 1.5, marginBottom: 5, fontWeight: 600 };
export const bdgSt = color => ({ background: `rgba(${color === "#00b4ff" ? "0,180,255" : "255,255,255"},0.07)`, border: `1px solid rgba(${color === "#00b4ff" ? "0,180,255" : "255,255,255"},0.16)`, borderRadius: 20, padding: "3px 11px", color, fontSize: 11, fontWeight: 600 });
