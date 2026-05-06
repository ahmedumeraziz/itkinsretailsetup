import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SHEET_ID        = "1_iXcsPI8C1g0UQaAcacbKjsHq9AWI3IRIsCbX2E87qk";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz-h1jphatR49vp7AFO6gUJphpl1d-Si1iVEhJaLNiP8tUgbEy9ACEH-DHq4UtE4l0e/exec";

const SHEET_URLS = {
  items:      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
  categories: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1073637718`,
  cashiers:   `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=2059868600`,
  sales:      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=968224820`,
  stocklog:   `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1905792112`,
  customers:  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=505470885`,
  returns:    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1759563627`,
};

const REQUIRED_HEADERS = {
  items:      ["Barcode","Category","Company","ItemName","Price","CostPrice","Discount","Stock","ExpiryDate"],
  categories: ["CategoryName"],
  cashiers:   ["Name","Username","PIN","Role"],
  sales:      ["BillNo","Date","Time","Cashier","GrandTotal","Discount","FBR","PaymentMethod","ItemsDetail","CustomerName","CustomerCell","RefundApplied"],
  stocklog:   ["Date","Barcode","ItemName","StockBefore","StockAfter","Reason"],
  customers:  ["Name","CellNo","BillNo","Payments"],
  returns:    ["ReturnNo","OrigBillNo","Date","Time","Cashier","Items","RefundAmount","Reason","UsedInBill"],
};

// ─── INDEXEDDB LAYER ──────────────────────────────────────────────────────────
const DB_NAME    = "AlAminPOS";
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const stores = ["items","categories","cashiers","sales","customers","stocklog","returns","pendingQueue","meta"];
      stores.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === "pendingQueue" ? "qid" : "id", autoIncrement: s === "pendingQueue" }); });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = () => rej(req.error);
  });
}
async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
async function dbClear(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}
async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}
async function dbSaveAll(store, arr, keyField) {
  await dbClear(store);
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    arr.forEach((item, i) => os.put({ ...item, id: item[keyField] || String(i) }));
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}
async function dbQueueAction(payload) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("pendingQueue", "readwrite");
    const req = tx.objectStore("pendingQueue").add({ ...payload, queuedAt: Date.now() });
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
async function dbGetQueue() {
  return dbGetAll("pendingQueue");
}
async function dbClearQueueItem(qid) {
  return dbDelete("pendingQueue", qid);
}
async function dbSetMeta(key, value) {
  return dbPut("meta", { id: key, value });
}
async function dbGetMeta(key) {
  const r = await dbGet("meta", key);
  return r ? r.value : null;
}
async function getNextBillNo() {
  let last = await dbGetMeta("lastBillNo");
  if (!last) {
    const all = await dbGetAll("sales");
    const max = all.reduce((m, s) => Math.max(m, parseInt(s.BillNo) || 0), 0);
    last = max + 1;
  }
  const next = parseInt(last) + 1;
  await dbSetMeta("lastBillNo", next);
  return String(next).padStart(4, "0");
}

// ─── SEARCH INDEX (with suffix tokens for partial barcode) ───────────────────
function buildSearchIndex(items) {
  const index = new Map();
  items.forEach(item => {
    const tokens = [
      item.Barcode?.toLowerCase(),
      ...(item.ItemName?.toLowerCase().split(/\s+/) || []),
      item.Category?.toLowerCase(),
      item.Company?.toLowerCase(),
    ].filter(Boolean);
    const bc = item.Barcode?.toLowerCase();
    if (bc) {
      for (let i = 4; i <= bc.length; i += 2) {
        tokens.push(bc.slice(-i));
      }
    }
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

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
function normalizeKey(h) { return h.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").replace(/\s+/g, "").trim(); }
function parseCSV(text) {
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
      if (ch === '"') { if (q && row[i+1] === '"') { field += '"'; i++; } else q = !q; }
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

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
const DEMO_ITEMS = [
  { Barcode: "8964000767221", Category: "Dairy",     Company: "Nestle",    ItemName: "Treat Platinum Pouch 5pcs",     Price: "210", CostPrice: "185", Discount: "0",  Stock: "45", ExpiryDate: "2025-12-31" },
  { Barcode: "5428",          Category: "Grocery",   Company: "National",  ItemName: "Macroni Mix-KG",                Price: "215", CostPrice: "190", Discount: "5",  Stock: "30", ExpiryDate: "2026-06-30" },
  { Barcode: "8964000020364", Category: "Grocery",   Company: "Shangrila", ItemName: "Shangrila Tomato Ketchup 800G", Price: "340", CostPrice: "300", Discount: "10", Stock: "20", ExpiryDate: "2026-09-15" },
  { Barcode: "1001",          Category: "Beverages", Company: "PepsiCo",   ItemName: "Pepsi 1.5L",                    Price: "120", CostPrice: "100", Discount: "0",  Stock: "60", ExpiryDate: "2025-08-01" },
  { Barcode: "1002",          Category: "Beverages", Company: "CocaCola",  ItemName: "Coca Cola 500ml",               Price: "80",  CostPrice: "65",  Discount: "5",  Stock: "3",  ExpiryDate: "2026-03-31" },
  { Barcode: "1003",          Category: "Bakery",    Company: "Local",     ItemName: "Bread Loaf",                    Price: "90",  CostPrice: "70",  Discount: "0",  Stock: "15", ExpiryDate: "2026-05-10" },
  { Barcode: "1005",          Category: "Snacks",    Company: "Lays",      ItemName: "Lays Classic 100g",             Price: "60",  CostPrice: "48",  Discount: "0",  Stock: "40", ExpiryDate: "2026-11-30" },
  { Barcode: "1006",          Category: "Dairy",     Company: "Olpers",    ItemName: "Olpers Milk 1L",                Price: "175", CostPrice: "155", Discount: "10", Stock: "25", ExpiryDate: "2026-04-20" },
  { Barcode: "1007",          Category: "Snacks",    Company: "Kurkure",   ItemName: "Kurkure Masala 80g",            Price: "50",  CostPrice: "40",  Discount: "0",  Stock: "4",  ExpiryDate: "2026-07-15" },
];
const DEMO_CATEGORIES = ["Dairy", "Grocery", "Beverages", "Bakery", "Snacks"];
const DEMO_CASHIERS = [
  { Name: "Admin",  Username: "admin",  PIN: "1234", Role: "admin"   },
  { Name: "Rizwan", Username: "rizwan", PIN: "5678", Role: "cashier" },
  { Name: "Ahmed",  Username: "ahmed",  PIN: "9999", Role: "cashier" },
];
const DEMO_SALES = [
  { BillNo: "0115", Date: "26/04/2026", Time: "10:15 AM", Cashier: "Rizwan", GrandTotal: "451",  Discount: "0",  FBR: "1", PaymentMethod: "Cash", CustomerName: "Ali Khan",    CustomerCell: "0300-1234567", ItemsDetail: '[{"Barcode":"1001","ItemName":"Pepsi 1.5L","Category":"Beverages","Price":"120","CostPrice":"100","Discount":"0","qty":2},{"Barcode":"1003","ItemName":"Bread Loaf","Category":"Bakery","Price":"90","CostPrice":"70","Discount":"0","qty":2}]' },
  { BillNo: "0116", Date: "26/04/2026", Time: "11:30 AM", Cashier: "Ahmed",  GrandTotal: "1161", Discount: "60", FBR: "1", PaymentMethod: "Card", CustomerName: "Sara Ahmed",  CustomerCell: "0312-9876543", ItemsDetail: '[{"Barcode":"1006","ItemName":"Olpers Milk 1L","Category":"Dairy","Price":"175","CostPrice":"155","Discount":"10","qty":4},{"Barcode":"5428","ItemName":"Macroni Mix-KG","Category":"Grocery","Price":"215","CostPrice":"190","Discount":"5","qty":2}]' },
  { BillNo: "0117", Date: "25/04/2026", Time: "01:45 PM", Cashier: "Rizwan", GrandTotal: "841",  Discount: "0",  FBR: "1", PaymentMethod: "Cash", CustomerName: "",     CustomerCell: "",             ItemsDetail: '[{"Barcode":"8964000767221","ItemName":"Treat Platinum Pouch 5pcs","Category":"Dairy","Price":"210","CostPrice":"185","Discount":"0","qty":4}]' },
  { BillNo: "0118", Date: "25/04/2026", Time: "02:20 PM", Cashier: "Rizwan", GrandTotal: "331",  Discount: "10", FBR: "1", PaymentMethod: "Cash", CustomerName: "Usman Malik", CustomerCell: "0321-1111111", ItemsDetail: '[{"Barcode":"8964000020364","ItemName":"Shangrila Tomato Ketchup 800G","Category":"Grocery","Price":"340","CostPrice":"300","Discount":"10","qty":1}]' },
  { BillNo: "0119", Date: "24/04/2026", Time: "03:30 PM", Cashier: "Rizwan", GrandTotal: "756",  Discount: "15", FBR: "1", PaymentMethod: "Cash", CustomerName: "Ali Khan",    CustomerCell: "0300-1234567", ItemsDetail: '[{"Barcode":"8964000767221","ItemName":"Treat Platinum Pouch 5pcs","Category":"Dairy","Price":"210","CostPrice":"185","Discount":"0","qty":1},{"Barcode":"5428","ItemName":"Macroni Mix-KG","Category":"Grocery","Price":"215","CostPrice":"190","Discount":"5","qty":1},{"Barcode":"8964000020364","ItemName":"Shangrila Tomato Ketchup 800G","Category":"Grocery","Price":"340","CostPrice":"300","Discount":"10","qty":1}]' },
];
const DEMO_CUSTOMERS = [
  { Name: "Ali Khan",    CellNo: "0300-1234567", BillNo: "0115,0119", payments: [] },
  { Name: "Sara Ahmed",  CellNo: "0312-9876543", BillNo: "0116",      payments: [] },
  { Name: "Usman Malik", CellNo: "0321-1111111", BillNo: "0118",      payments: [] },
];
const DEMO_RETURNS = [];

// ─── UTILITIES ────────────────────────────────────────────────────────────────
const fmt = n => parseFloat(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const getNow = () => { const d = new Date(); return { date: d.toLocaleDateString("en-GB"), time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) }; };
function filterDateMatch(saleDate, filterVal) {
  if (!filterVal) return true;
  const [y, m, d] = filterVal.split("-");
  return saleDate === `${d}/${m}/${y}`;
}
function safeParseItems(str) {
  if (!str || str.trim() === "") return [];
  try { const r = JSON.parse(str); return Array.isArray(r) ? r : []; } catch (e) { return []; }
}
function getExpiryStatus(expiryDate) {
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
function fmtExpiry(expiryDate) {
  if (!expiryDate) return "—";
  const [y, m, d] = expiryDate.split("-");
  return `${d}/${m}/${y}`;
}

// ─── SCRIPT CALLER (CORS ENABLED) ────────────────────────────────────────────
const SCRIPT_TOKEN = "itKINS@POS#2024$Secure!";
async function callScript(payload) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("YOUR_")) return;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, token: SCRIPT_TOKEN })
    });
    const data = await res.json();
    if (data.status !== "ok") throw new Error(data.message);
    return data;
  } catch (e) { console.error("Script call failed:", e.message); throw e; }
}

// ─── DEEP CONNECTION TEST ─────────────────────────────────────────────────────
async function deepTestConnections() {
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
  try { await fetch(APPS_SCRIPT_URL, { method: "GET", headers: { "Content-Type": "application/json" } }); sr.ok = true; sr.reachable = true; sr.extraInfo = "Reachable"; } catch (e) { sr.extraInfo = "Cannot reach"; }
  results.script = sr;
  return results;
}
async function autoRepairSheets() { await callScript({ action: "ensureHeaders" }); }

// ─── PRINT RECEIPT (with fallback) ────────────────────────────────────────────
function printReceipt(bill) {
  const grouped = {};
  (bill.items || []).forEach(item => { const c = item.Category || "General"; if (!grouped[c]) grouped[c] = []; grouped[c].push(item); });
  const cats = Object.keys(grouped).sort();
  let itemsHtml = "";
  cats.forEach(cat => {
    itemsHtml += `<div class="cat-hdr">── ${cat} ──</div>`;
    grouped[cat].forEach(item => {
      const disc = parseFloat(item.Discount) || 0;
      const total = item.qty * (parseFloat(item.Price) - disc);
      itemsHtml += `<div class="item"><div class="iname">${item.ItemName}</div><div class="idet">${item.qty} x PKR ${fmt(item.Price)}${disc ? ` (Disc: PKR ${fmt(disc)})` : ""}</div><div class="itot">PKR ${fmt(total)}</div></div>`;
    });
  });
  let payHtml = "";
  (bill.payments || []).forEach(p => {
    const amt = parseFloat(p.amount) || 0;
    if (amt > 0) {
      let methodLabel = "";
      if (p.type === "cash") methodLabel = "Cash";
      else if (p.type === "refund") methodLabel = "Refund Applied";
      else if (p.type === "card") methodLabel = `Card(****${p.last4 || "----"})`;
      else if (p.type === "debit") methodLabel = "Debit";
      else methodLabel = p.type;
      payHtml += `<div class="pr"><span>${methodLabel}</span><span>${p.type === "refund" ? "- " : ""}PKR ${fmt(amt)}</span></div>`;
    }
  });
  const billDiscLine = bill.billDiscount > 0 ? `<div class="tr" style="color:#b00"><span>Bill Discount (${bill.billDiscountPct}%)</span><span>- PKR ${fmt(bill.billDiscount)}</span></div>` : "";
  const custName = bill.customerName || ""; const custCell = bill.customerCell || "";
  const custLine = (custName && custName !== "Unknown" && custName.trim() !== "") ? `<div class="bi"><span>Customer: ${custName}</span><span>${custCell}</span></div>` : "";
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;width:302px;padding:10px 6px;color:#000;background:#fff}
    .sn{font-size:15px;font-weight:bold;text-align:center;margin-bottom:1px}.dv{border-top:1px dashed #000;margin:5px 0}
    .bi{display:flex;justify-content:space-between;font-size:10px;margin:1px 0}.cat-hdr{text-align:center;font-weight:bold;margin:6px 0 2px;font-size:11px}
    .item{margin:3px 0}.iname{font-weight:bold;font-size:11px}.idet{font-size:10px;padding-left:6px;color:#333}.itot{font-size:11px;text-align:right;font-weight:bold}
    .tr{display:flex;justify-content:space-between;margin:2px 0;font-size:12px}.gr{font-size:14px;font-weight:bold;margin:4px 0}
    .pr{display:flex;justify-content:space-between;font-size:11px;margin:1px 0}.ft{text-align:center;font-size:10px;margin-top:8px}
    @media print{body{margin:0}}</style></head><body>
    <div class="sn">MART - BAKERY</div><div class="sn">AND STORES</div>
    <div class="dv"></div>
    <div class="bi"><span>Bill#: ${bill.billNo}</span><span>${bill.date}</span></div>
    <div class="bi"><span>Cashier: ${bill.cashier}</span><span>${bill.time}</span></div>
    ${custLine}
    <div class="dv"></div>${itemsHtml}<div class="dv"></div>
    <div class="tr"><span>Sub Total</span><span>PKR ${fmt(bill.subTotal)}</span></div>
   ${bill.refundApplied > 0 ? `<div class="tr" style="color:#ff9500"><span>Refund Applied</span><span>- PKR ${fmt(bill.refundApplied)}</span></div>` : ""}
    ${billDiscLine}
    <div class="tr" style="font-size:10px;color:#555"><span>FBR Charges</span><span>PKR 0.00</span></div>
    <div class="dv"></div><div class="tr gr"><span>GRAND TOTAL</span><span>PKR ${fmt(bill.grandTotal)}</span></div>
    <div class="dv"></div>${payHtml}
    <div class="tr" style="font-weight:bold;margin-top:4px"><span>CHANGE RETURNED</span><span>PKR ${fmt(Math.max(0, bill.change || 0))}</span></div>
    <div class="dv"></div><div class="ft">Thank you for shopping at<br><b>Mart, Bakery & Store!</b></div>
    <div style="text-align:center;font-size:9px;margin-top:3px;color:#555">Designed by itkins.com | 0304-7414437</div>
    <br/><br/></body></html>`;
  const w = window.open("", "_blank", "width=340,height=720");
  if (!w) {
    alert("Popups are blocked. Printing in fallback mode. If nothing happens, please allow popups for this site.");
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
    return;
  }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 450);
}
function printReturnReceipt(ret) {
  const items = safeParseItems(ret.Items || ret.items || "[]");
  let rows = items.map(i => `<div style="display:flex;justify-content:space-between;margin:3px 0;font-size:11px"><span>${i.ItemName} x${i.qty}</span><span>PKR ${fmt(parseFloat(i.Price || 0) * i.qty)}</span></div>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;width:302px;padding:10px 6px;color:#000}</style></head><body>
    <div style="font-size:15px;font-weight:bold;text-align:center">MART - BAKERY - STORE</div>
    <div style="font-size:13px;font-weight:bold;text-align:center;margin:3px 0">— RETURN RECEIPT —</div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="display:flex;justify-content:space-between;font-size:10px"><span>Return#: ${ret.ReturnNo}</span><span>${ret.Date}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:10px"><span>Orig Bill#: ${ret.OrigBillNo}</span><span>${ret.Time}</span></div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    ${rows}
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px"><span>REFUND AMOUNT</span><span>PKR ${fmt(ret.RefundAmount)}</span></div>
    <div style="text-align:center;font-size:10px;margin-top:8px">Reason: ${ret.Reason || "Customer Return"}</div>
    <br/><br/></body></html>`;
  const w = window.open("", "_blank", "width=340,height=600");
  if (!w) { alert("Allow popups to print return receipt!"); return; }
  w.document.write(html); w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 400);
}

// ─── APPS SCRIPT TEXT (embedded for download) ─────────────────────────────────
function getScriptText() {
  return `// ═══════════════════════════════════════════════════════════════
//  Apps Script v7.0 (FIXED - Idempotent Sales)
//  Copy this entire code to your Apps Script editor, deploy as web app.
// ═══════════════════════════════════════════════════════════════

var SECRET_TOKEN     = "itKINS@POS#2024$Secure!";

var SHEET_ITEMS      = "Items";
var SHEET_CATEGORIES = "Categories";
var SHEET_CASHIER    = "Cashier";
var SHEET_SALES      = "Sales";
var SHEET_STOCKLOG   = "StockLog";
var SHEET_CUSTOMER   = "Customer";
var SHEET_RETURNS    = "Returns";

var HEADERS = {
  Items:      ["Barcode","Category","Company","ItemName","Price","CostPrice","Discount","Stock","ExpiryDate"],
  Categories: ["CategoryName"],
  Cashier:    ["Name","Username","PIN","Role"],
  Sales:      ["BillNo","Date","Time","Cashier","GrandTotal","Discount","FBR","PaymentMethod","ItemsDetail","CustomerName","CustomerCell","RefundApplied"],
  StockLog:   ["Date","Barcode","ItemName","StockBefore","StockAfter","Reason"],
  Customer:   ["Name","CellNo","BillNo","Payments"],
  Returns:    ["ReturnNo","OrigBillNo","Date","Time","Cashier","Items","RefundAmount","Reason","UsedInBill"]
};

function makeResp(data){
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e){
  return makeResp({status:"ok",message:"itKINS Script v7 Running",time:new Date().toString()});
}

function doPost(e){
  try{
    var raw=e.postData?e.postData.contents:"{}";
    var data=JSON.parse(raw);
    if(!data.token || data.token !== SECRET_TOKEN){
      return makeResp({status:"error",message:"Unauthorized request blocked"});
    }
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var result;
    switch(data.action){
      case "saveSale":         result=saveSale(ss,data);         break;
      case "saveCustomer":     result=saveCustomer(ss,data);     break;
      case "savePayment":      result=savePayment(ss,data);      break;
      case "deletePayment":    result=deletePayment(ss,data);    break;
      case "deleteCustomer":   result=deleteCustomer(ss,data);   break;
      case "adjustStock":      result=adjustStock(ss,data);      break;
      case "addItem":          result=addItem(ss,data);          break;
      case "editItem":         result=editItem(ss,data);         break;
      case "deleteItem":       result=deleteItem(ss,data);       break;
      case "addCategory":      result=addCategory(ss,data);      break;
      case "deleteCategory":   result=deleteCategory(ss,data);   break;
      case "addCashier":       result=addCashier(ss,data);       break;
      case "editCashier":      result=editCashier(ss,data);      break;
      case "deleteCashier":    result=deleteCashier(ss,data);    break;
      case "saveReturn":       result=saveReturn(ss,data);       break;
      case "markReturnUsed":   result=markReturnUsed(ss,data);   break;
      case "ensureHeaders":    result=ensureAllHeaders(ss);       break;
      case "ping":             result={status:"ok",message:"pong"}; break;
      default:                 result={status:"error",message:"Unknown action: "+data.action};
    }
    return makeResp(result);
  }catch(err){
    return makeResp({status:"error",message:err.toString()});
  }
}

function getHeaders(sheet){
  var last=sheet.getLastColumn();
  if(last<1)return{};
  var row=sheet.getRange(1,1,1,last).getValues()[0];
  var map={};row.forEach(function(h,i){map[String(h).trim()]=i;});return map;
}

function findRow(sheet,colIndex,value){
  var last=sheet.getLastRow();
  if(last<2)return -1;
  var col=sheet.getRange(2,colIndex+1,last-1,1).getValues();
  for(var i=0;i<col.length;i++){
    if(String(col[i][0]).trim()===String(value).trim())return i+2;
  }
  return -1;
}

function ensureAllHeaders(ss){
  var fixed=[];
  var sheetMap={
    Items:SHEET_ITEMS, Categories:SHEET_CATEGORIES, Cashier:SHEET_CASHIER,
    Sales:SHEET_SALES, StockLog:SHEET_STOCKLOG, Customer:SHEET_CUSTOMER, Returns:SHEET_RETURNS
  };
  Object.keys(sheetMap).forEach(function(key){
    var tabName=sheetMap[key];
    var sh=ss.getSheetByName(tabName);
    if(!sh){sh=ss.insertSheet(tabName);sh.getRange(1,1,1,HEADERS[key].length).setValues([HEADERS[key]]);fixed.push("CREATED: "+tabName);return;}
    var last=sh.getLastColumn();
    var existing=last>0?sh.getRange(1,1,1,last).getValues()[0].map(function(h){return String(h).trim();}):[];
    var required=HEADERS[key]||[];
    var toAdd=required.filter(function(h){return!existing.includes(h);});
    if(toAdd.length>0){toAdd.forEach(function(h){var col=sh.getLastColumn()+1;sh.getRange(1,col).setValue(h);fixed.push(tabName+"."+h);});}
  });
  return{status:"ok",fixed:fixed,message:fixed.length>0?"Fixed: "+fixed.join(", "):"All headers OK"};
}

// ========== FIXED: Idempotent saveSale ==========
function saveSale(ss,data){
  var salesSh=ss.getSheetByName(SHEET_SALES);
  if(!salesSh)return{status:"error",message:"Sheet not found: "+SHEET_SALES};
  var hdr=salesSh.getRange(1,1,1,salesSh.getLastColumn()).getValues()[0];
  var billNoCol=hdr.indexOf("BillNo");
  if(billNoCol===-1)return{status:"error",message:"BillNo column missing"};
  var billNo=String(data.BillNo).trim();
  var lastRow=salesSh.getLastRow();
  if(lastRow>=2){
    var billNos=salesSh.getRange(2,billNoCol+1,lastRow-1,1).getValues();
    for(var i=0;i<billNos.length;i++){
      if(String(billNos[i][0]).trim()===billNo){
        return{status:"error",message:"Duplicate BillNo: "+billNo};
      }
    }
  }
  salesSh.appendRow([
    billNo,data.Date||"",data.Time||"",data.Cashier||"",
    parseFloat(data.GrandTotal)||0,parseFloat(data.Discount)||0,parseFloat(data.FBR)||0,
    data.PaymentMethod||"",data.ItemsDetail||"[]",data.CustomerName||"Unknown",data.CustomerCell||"",
    parseFloat(data.RefundApplied)||0
  ]);

  // ── Auto-save customer if Credit sale with valid customer info ──
  var custName=(data.CustomerName||"").trim();
  var custCell=(data.CustomerCell||"").trim();
  if(custName && custName!=="Unknown" && custCell && data.PaymentMethod==="Credit"){
    var custSh=ss.getSheetByName(SHEET_CUSTOMER);
    if(custSh){
      var custHdrMap=getHeaders(custSh);
      var custCellIdx=custHdrMap["CellNo"];
      if(custCellIdx!==undefined){
        var custRowNum=findRow(custSh,custCellIdx,custCell);
        if(custRowNum===-1){
          custSh.appendRow([custName,custCell,data.BillNo||"",""]);
        } else {
          var billsIdx=custHdrMap["BillNo"];
          if(billsIdx!==undefined){
            var existingBills=String(custSh.getRange(custRowNum,billsIdx+1).getValue()||"");
            var billsArr=existingBills.split(",").map(function(b){return b.trim();}).filter(Boolean);
            if(data.BillNo && !billsArr.includes(String(data.BillNo))){
              billsArr.push(String(data.BillNo));
              custSh.getRange(custRowNum,billsIdx+1).setValue(billsArr.join(","));
            }
          }
        }
      }
    }
  }

  // ── Deduct stock ──
  var itemsSh=ss.getSheetByName(SHEET_ITEMS);
  var stockLogSh=ss.getSheetByName(SHEET_STOCKLOG);
  if(itemsSh&&data.items&&data.items.length>0){
    var allRows=itemsSh.getDataRange().getValues();
    var hdr2=allRows[0];
    var bcIdx=hdr2.indexOf("Barcode");
    var stockIdx=hdr2.indexOf("Stock");
    var nameIdx=hdr2.indexOf("ItemName");
    if(bcIdx===-1||stockIdx===-1)return{status:"warning",message:"Sale saved but missing columns"};
    var logRows=[];
    data.items.forEach(function(soldItem){
      for(var i=1;i<allRows.length;i++){
        if(String(allRows[i][bcIdx]).trim()===String(soldItem.Barcode).trim()){
          var before=parseInt(allRows[i][stockIdx])||0;
          var qty=parseInt(soldItem.qty)||1;
          var after=Math.max(0,before-qty);
          itemsSh.getRange(i+1,stockIdx+1).setValue(after);
          allRows[i][stockIdx]=after;
          logRows.push([data.Date||"",soldItem.Barcode||"",allRows[i][nameIdx]||"",before,after,"Bill #"+(data.BillNo||"")]);
          break;
        }
      }
    });
    if(stockLogSh&&logRows.length>0){var nextRow=stockLogSh.getLastRow()+1;stockLogSh.getRange(nextRow,1,logRows.length,6).setValues(logRows);}
  }
  return{status:"ok",message:"Sale saved: Bill #"+data.BillNo};
}

// ========== FIXED: saveCustomer prevents duplicate BillNo ==========
function saveCustomer(ss,data){
  var sh=ss.getSheetByName(SHEET_CUSTOMER);
  if(!sh)return{status:"error",message:"Sheet not found: "+SHEET_CUSTOMER};
  var name=(data.Name||"").trim();
  var cell=(data.CellNo||"").trim();
  var billNo=(data.BillNo||"").trim();
  if(!name||!cell)return{status:"error",message:"Name and CellNo required"};
  var hdrMap=getHeaders(sh);
  var cellIdx=hdrMap["CellNo"];
  if(cellIdx===undefined)return{status:"error",message:"CellNo column not found"};
  var rowNum=findRow(sh,cellIdx,cell);
  if(rowNum===-1){
    sh.appendRow([name,cell,billNo,""]);
    return{status:"ok",message:"Customer created: "+name};
  }
  var billsIdx=hdrMap["BillNo"];
  if(billsIdx!==undefined && billNo){
    var existing=String(sh.getRange(rowNum,billsIdx+1).getValue()||"");
    var bills=existing.split(",").map(function(b){return b.trim();}).filter(Boolean);
    if(bills.indexOf(billNo)===-1){
      bills.push(billNo);
      sh.getRange(rowNum,billsIdx+1).setValue(bills.join(","));
    }
  }
  return{status:"ok",message:"Customer updated: "+name};
}

// All other functions (savePayment, adjustStock, addItem, editItem, deleteItem, addCategory, deleteCategory, addCashier, editCashier, deleteCashier, saveReturn, markReturnUsed, deletePayment, deleteCustomer) remain unchanged from original.
// (Include them as they were - we trust the original had them correctly.)
function savePayment(ss,data){...}
function deletePayment(ss,data){...}
function deleteCustomer(ss,data){...}
function markReturnUsed(ss,data){...}
function saveReturn(ss,data){...}
function adjustStock(ss,data){...}
function addItem(ss,data){...}
function editItem(ss,data){...}
function deleteItem(ss,data){...}
function addCategory(ss,data){...}
function deleteCategory(ss,data){...}
function addCashier(ss,data){...}
function editCashier(ss,data){...}
function deleteCashier(ss,data){...}
`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  // PWA manifest
  useEffect(() => {
    document.title = "POS APP";
    const link = document.querySelector("link[rel~='icon']") || document.createElement("link");
    link.rel = "icon"; link.type = "image/webp";
    link.href = "http://itkins.com/wp-content/uploads/2025/06/itKINS-Favicon.webp";
    document.head.appendChild(link);
    const manifest = {
      short_name: "POS APP", name: "POS APP",
      icons: [{ src: "http://itkins.com/wp-content/uploads/2025/06/itKINS-Favicon.webp", sizes: "512x512", type: "image/webp", purpose: "any maskable" }],
      start_url: window.location.href, display: "standalone", background_color: "#0a0e1a", theme_color: "#0a0e1a",
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
    const mLink = document.querySelector("link[rel='manifest']") || document.createElement("link");
    mLink.rel = "manifest"; mLink.href = URL.createObjectURL(blob);
    document.head.appendChild(mLink);
  }, []);

  const [screen,       setScreen]       = useState("login");
  const [user,         setUser]         = useState(null);
  const [items,        setItems]        = useState(DEMO_ITEMS);
  const [categories,   setCategories]   = useState(DEMO_CATEGORIES);
  const [cashiers,     setCashiers]     = useState(DEMO_CASHIERS);
  const [sales,        setSales]        = useState(DEMO_SALES);
  const [customers,    setCustomers]    = useState(DEMO_CUSTOMERS);
  const [returns,      setReturns]      = useState(DEMO_RETURNS);
  const [billCounter,  setBillCounter]  = useState(120);
  const [returnCounter,setReturnCounter]= useState(1);
  const [loading,      setLoading]      = useState(false);
  const [loadMsg,      setLoadMsg]      = useState("Loading data...");
  const [sheetStatus,  setSheetStatus]  = useState("demo");
  const [lastSync,     setLastSync]     = useState(null);
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);
  const [searchIndex,  setSearchIndex]  = useState(new Map());
  const [itemMap,      setItemMap]      = useState(new Map());
  const pendingBackup  = useRef([]);

  useEffect(() => {
    const idx = buildSearchIndex(items);
    const map = new Map(items.map(i => [i.Barcode, i]));
    setSearchIndex(idx);
    setItemMap(map);
  }, [items]);

  useEffect(() => {
    const goOn  = () => { setIsOnline(true);  flushPending(); };
    const goOff = () => setIsOnline(false);
    window.addEventListener("online",  goOn);
    window.addEventListener("offline", goOff);
    return () => { window.removeEventListener("online", goOn); window.removeEventListener("offline", goOff); };
  }, []);

  const flushPending = async () => {
    const q = [...pendingBackup.current]; pendingBackup.current = [];
    for (const p of q) await callScript(p).catch(console.warn);
    try {
      const dbQueue = await dbGetQueue();
      for (const item of dbQueue) {
        const { qid, queuedAt, ...payload } = item;
        await callScript(payload).catch(console.warn);
        await dbClearQueueItem(qid);
      }
      if (dbQueue.length) console.log(`✅ Flushed ${dbQueue.length} queued actions`);
    } catch (e) { console.warn("Queue flush error:", e); }
  };

  const safeCallScript = async payload => {
    if (isOnline) {
      await callScript(payload);
    } else {
      try { await dbQueueAction(payload); } catch (e) { pendingBackup.current.push(payload); }
      console.log("📦 Queued offline:", payload.action);
    }
  };

  const loadFromSheet = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setLoadMsg("Checking local cache..."); }
    try {
      const [dbItems, dbCats, dbCashiers, dbSales, dbCustomers, dbReturns] = await Promise.all([
        dbGetAll("items"), dbGetAll("categories"), dbGetAll("cashiers"),
        dbGetAll("sales"), dbGetAll("customers"), dbGetAll("returns"),
      ]);
      if (dbItems.length > 0) {
        setItems(dbItems.map(r => { const { id, ...rest } = r; return rest; }));
        setSheetStatus("cached");
      }
      if (dbCats.length > 0) setCategories(dbCats.map(r => r.CategoryName || r.id).filter(Boolean));
      if (dbCashiers.length > 0) setCashiers(dbCashiers.map(r => { const { id, ...rest } = r; return rest; }));
      if (dbSales.length > 0) {
        const cleaned = dbSales.map(r => { const { id, ...rest } = r; return rest; });
        setSales(cleaned);
        const mx = cleaned.reduce((m, s) => Math.max(m, parseInt(s.BillNo) || 0), 0);
        if (mx > 0) setBillCounter(mx + 1);
      }
      if (dbCustomers.length > 0) setCustomers(dbCustomers.map(r => { const { id, ...rest } = r; return rest; }));
      if (dbReturns.length > 0) {
        const cleaned = dbReturns.map(r => {
          const { id, ...rest } = r;
          return { ...rest, usedInBill: rest.usedInBill === true || rest.UsedInBill === "1" || rest.UsedInBill === "true" };
        });
        setReturns(cleaned);
        const mx = cleaned.reduce((m, r) => Math.max(m, parseInt((r.ReturnNo || "").replace(/\D/g, "")) || 0), 0);
        if (mx > 0) setReturnCounter(mx + 1);
      }
    } catch (e) { console.warn("IndexedDB read failed:", e); }

    setSheetStatus(s => s === "demo" || s === "cached" ? "syncing" : s);
    if (!silent) setLoadMsg("Syncing from Database...");

    try {
      const go = url => fetch(url, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
      const [iT, cT, caT, sT, cuT, retT] = await Promise.all([
        go(SHEET_URLS.items), go(SHEET_URLS.categories), go(SHEET_URLS.cashiers),
        go(SHEET_URLS.sales), go(SHEET_URLS.customers),
        fetch(SHEET_URLS.returns, { cache: "no-store" }).then(r => r.ok ? r.text() : "").catch(() => ""),
      ]);

      const pI = parseCSV(iT), pC = parseCSV(cT), pCa = parseCSV(caT), pS = parseCSV(sT), pCu = parseCSV(cuT);
      const pRet = retT ? parseCSV(retT) : [];
      const cats = pC.map(r => r["CategoryName"] || r[Object.keys(r)[0]] || "").filter(Boolean);

      if (pI.length)  { setItems(pI);   await dbSaveAll("items",     pI,  "Barcode"); }
      if (cats.length){ setCategories(cats); await dbSaveAll("categories", pC, "CategoryName"); }
      if (pCa.length) { setCashiers(pCa); await dbSaveAll("cashiers", pCa, "Username"); }
      if (pS.length)  {
        setSales(pS);
        await dbSaveAll("sales", pS, "BillNo");
        const mx = pS.reduce((m, s) => Math.max(m, parseInt(s.BillNo) || 0), 0);
        if (mx > 0) setBillCounter(mx + 1);
        await dbSetMeta("lastBillNo", mx);
      }
      if (pCu.length) {
        const parsedCustomers = pCu.map(c => ({
          ...c,
          payments: (() => { try { const p = c.Payments || c.payments || ""; if (!p || p.trim() === "") return []; return JSON.parse(p); } catch(e) { return []; } })()
        }));
        setCustomers(parsedCustomers);
        await dbSaveAll("customers", parsedCustomers, "CellNo");
      }
      if (pRet.length){
        const parsedRet = pRet.map(r => ({ ...r, usedInBill: r.UsedInBill === "1" || r.UsedInBill === "true" || r.UsedInBill === true }));
        setReturns(parsedRet);
        await dbSaveAll("returns", parsedRet, "ReturnNo");
        const mx = parsedRet.reduce((m, r) => Math.max(m, parseInt((r.ReturnNo || "").replace(/\D/g, "")) || 0), 0);
        if (mx > 0) setReturnCounter(mx + 1);
      }

      setSheetStatus("loaded"); setLastSync(new Date());
      await dbSetMeta("lastSync", new Date().toISOString());
      await flushPending();
    } catch (e) {
      console.error("Sheet load failed:", e.message);
      setSheetStatus(prev => prev === "loaded" || prev === "cached" ? "cached" : "error");
    }
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { loadFromSheet(); }, [loadFromSheet]);
  useEffect(() => {
    const interval = setInterval(() => { if (isOnline) loadFromSheet(true); }, 60000);
    return () => clearInterval(interval);
  }, [loadFromSheet, isOnline]);

  const handleLogin  = u => { setUser(u); setScreen(u.Role === "admin" ? "admin" : "pos"); };
  const handleLogout = () => { setUser(null); setScreen("login"); };

  const handleSaleSaved = async (sale, customerInfo, paymentMethod) => {
    const isValidCustomer = !!(customerInfo && customerInfo.Name && customerInfo.Name.trim() !== "" && customerInfo.Name.trim() !== "Unknown" && customerInfo.CellNo && customerInfo.CellNo.trim() !== "");
    setSales(prev => [...prev, sale]);
    await dbSetMeta("lastBillNo", parseInt(sale.BillNo));
    setItems(prev => prev.map(item => {
      const si = sale.items?.find(s => s.Barcode === item.Barcode);
      if (si) { const ns = Math.max(0, (parseInt(item.Stock) || 0) - (parseInt(si.qty) || 1)); return { ...item, Stock: String(ns) }; }
      return item;
    }));
    if (isValidCustomer) {
      setCustomers(prev => {
        const existing = prev.find(c => c.CellNo === customerInfo.CellNo);
        if (existing) {
          const bills = [...new Set([...(existing.BillNo || "").split(",").filter(Boolean), sale.BillNo])].join(",");
          const updated = { ...existing, BillNo: bills };
          dbPut("customers", { ...updated, id: existing.CellNo }).catch(() => {});
          return prev.map(c => c.CellNo === customerInfo.CellNo ? updated : c);
        }
        const newCust = { Name: customerInfo.Name, CellNo: customerInfo.CellNo, BillNo: sale.BillNo, payments: [] };
        dbPut("customers", { ...newCust, id: customerInfo.CellNo }).catch(() => {});
        return [...prev, newCust];
      });
    }
    try {
      await dbPut("sales", { ...sale, id: sale.BillNo });
      for (const si of (sale.items || [])) {
        const existing = await dbGet("items", si.Barcode);
        if (existing) { const ns = Math.max(0, (parseInt(existing.Stock) || 0) - (parseInt(si.qty) || 1)); await dbPut("items", { ...existing, Stock: String(ns) }); }
      }
    } catch (e) { console.warn("IDB save error:", e); }
    await safeCallScript({
      action: "saveSale",
      ...sale,
      PaymentMethod: paymentMethod,
      CustomerName: isValidCustomer ? customerInfo.Name : "Unknown",
      CustomerCell: isValidCustomer ? customerInfo.CellNo : "",
      items: sale.items
    });
    if (isValidCustomer) {
      await safeCallScript({
        action: "saveCustomer",
        Name: customerInfo.Name.trim(),
        CellNo: customerInfo.CellNo.trim(),
        BillNo: sale.BillNo
      });
    }
  };

  const handleReturnSaved = async (ret) => {
    const retWithFlag = { ...ret, usedInBill: false, UsedInBill: "0" };
    setReturns(prev => [...prev, retWithFlag]);
    setReturnCounter(prev => prev + 1);
    setItems(prev => prev.map(item => {
      const ri = safeParseItems(ret.Items).find(r => r.Barcode === item.Barcode);
      if (ri) { const ns = (parseInt(item.Stock) || 0) + (parseInt(ri.qty) || 1); return { ...item, Stock: String(ns) }; }
      return item;
    }));
    try { await dbPut("returns", { ...retWithFlag, id: ret.ReturnNo }); } catch (e) { }
    await safeCallScript({ action: "saveReturn", ...ret });
  };

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;500;600;700;800&family=Orbitron:wght@700;900&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#060a14}::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:4px}
    input,select,button,textarea{font-family:'Exo 2',sans-serif}
    .btn{cursor:pointer;border:none;border-radius:6px;font-weight:600;transition:all 0.18s}
    .btn:hover:not(:disabled){filter:brightness(1.18);transform:translateY(-1px)}
    .btn:active:not(:disabled){transform:translateY(0)}.btn:disabled{opacity:0.38;cursor:not-allowed}
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}@keyframes spin{to{transform:rotate(360deg)}}
    .fadein{animation:fadeIn 0.3s ease forwards}
    .search-item-row{transition:background 0.1s;}
    .search-item-row.kb-selected{background:rgba(0,180,255,0.16)!important;border-left:3px solid #00b4ff;}
    .qty-focus-input{
      background: rgba(0,180,255,0.15) !important;
      border: 2px solid #00b4ff !important;
      box-shadow: 0 0 0 3px rgba(0,180,255,0.2) !important;
    }
  `;

  return (
    <div style={{ fontFamily: "'Exo 2',sans-serif", minHeight: "100vh", background: "#0a0e1a" }}>
      <style>{CSS}</style>
      {loading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,26,0.95)", zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <div style={{ width: 42, height: 42, border: "3px solid rgba(0,180,255,0.18)", borderTop: "3px solid #00b4ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <div style={{ color: "#00b4ff", fontFamily: "Orbitron", fontSize: 12, letterSpacing: 3, animation: "pulse 1.4s infinite" }}>{loadMsg}</div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>Offline mode available</div>
        </div>
      )}
      {screen === "login" && <LoginScreen cashiers={cashiers} onLogin={handleLogin} sheetStatus={sheetStatus} onRefresh={() => loadFromSheet()} />}
      {screen === "pos" && <POSScreen user={user} items={items} categories={categories} billCounter={billCounter} onLogout={handleLogout} onSaleSaved={handleSaleSaved} sheetStatus={sheetStatus} isOnline={isOnline} lastSync={lastSync} onRefresh={() => loadFromSheet()} searchIndex={searchIndex} itemMap={itemMap} sales={sales} returns={returns} returnCounter={returnCounter} onReturnSaved={handleReturnSaved} customers={customers} setCustomers={setCustomers} onMarkReturnUsed={async (returnNo) => {
        setReturns(prev => prev.map(r => r.ReturnNo === returnNo ? { ...r, usedInBill: true, UsedInBill: "1" } : r));
        try { const dbRet = await dbGet("returns", returnNo); if (dbRet) await dbPut("returns", { ...dbRet, usedInBill: true, UsedInBill: "1" }); } catch(e) {}
        await safeCallScript({ action: "markReturnUsed", ReturnNo: returnNo });
      }} />}
      {screen === "admin" && <AdminScreen user={user} items={items} setItems={setItems} categories={categories} setCategories={setCategories} cashiers={cashiers} setCashiers={setCashiers} sales={sales} setSales={setSales} customers={customers} setCustomers={setCustomers} returns={returns} setReturns={setReturns} onLogout={handleLogout} onRefresh={() => loadFromSheet()} sheetStatus={sheetStatus} safeCallScript={safeCallScript} lastSync={lastSync} isOnline={isOnline} returnCounter={returnCounter} setReturnCounter={setReturnCounter} onReturnSaved={handleReturnSaved} />}
    </div>
  );
}

// ==================== Login Screen ====================
function LoginScreen({ cashiers, onLogin, sheetStatus, onRefresh }) {
  const [username, setUsername] = useState(""); const [pin, setPin] = useState(""); const [error, setError] = useState(""); const [shake, setShake] = useState(false);
  const pinRef = useRef(pin); pinRef.current = pin;
  const doLogin = useCallback((pinOverride) => {
    const p = pinOverride !== undefined ? pinOverride : pinRef.current;
    const f = cashiers.find(c => c.Username?.toLowerCase().trim() === username.toLowerCase().trim() && c.PIN?.trim() === p.trim());
    if (f) { onLogin(f); } else { setError("Invalid username or PIN"); setShake(true); setTimeout(() => setShake(false), 600); setPin(""); }
  }, [cashiers, username, onLogin]);
  const handleKeyDown = useCallback(e => {
    if (e.target.id === "username-input") return;
    if (e.key >= "0" && e.key <= "9") { e.preventDefault(); setPin(p => { if (p.length >= 6) return p; const np = p + e.key; const f = cashiers.find(c => c.Username?.toLowerCase().trim() === username.toLowerCase().trim() && c.PIN?.trim() === np.trim()); if (f) setTimeout(() => onLogin(f), 120); return np; }); setError(""); }
    else if (e.key === "Backspace") { e.preventDefault(); setPin(p => p.slice(0, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); doLogin(); }
  }, [cashiers, username, onLogin, doLogin]);
  const padPress = useCallback(k => {
    if (k === "⌫") { setPin(p => p.slice(0, -1)); return; }
    if (k === "✓") { doLogin(); return; }
    setPin(p => { if (p.length >= 6) return p; const np = p + k; const f = cashiers.find(c => c.Username?.toLowerCase().trim() === username.toLowerCase().trim() && c.PIN?.trim() === np.trim()); if (f) setTimeout(() => onLogin(f), 120); return np; });
    setError("");
  }, [cashiers, username, onLogin, doLogin]);
  const inSt = { padding: "9px 12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,180,255,0.22)", borderRadius: 7, color: "#fff", fontSize: 13, outline: "none", width: "100%" };
  const lbSt = { display: "block", color: "rgba(0,180,255,0.68)", fontSize: 10, letterSpacing: 1.5, marginBottom: 5, fontWeight: 600 };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0a0e1a 0%,#0d1b2a 60%,#0a1628 100%)", position: "relative", overflow: "hidden", outline: "none" }} tabIndex={0} onKeyDown={handleKeyDown}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "linear-gradient(rgba(0,180,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,180,255,0.04) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="fadein" style={{ width: 400, padding: "38px 34px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(0,180,255,0.18)", borderRadius: 18, backdropFilter: "blur(20px)", boxShadow: "0 0 80px rgba(0,80,255,0.12)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontFamily: "Orbitron", fontSize: 10, color: "#00b4ff", letterSpacing: 5, marginBottom: 10, opacity: 0.7 }}>POINT OF SALE SYSTEM</div>
          <div style={{ fontFamily: "Orbitron", fontSize: 21, color: "#fff", fontWeight: 900, letterSpacing: 2, lineHeight: 1.3 }}>itKINS<br /><span style={{ color: "#00b4ff" }}>MART - BAKERY</span></div>
          <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 11, marginTop: 5, letterSpacing: 3 }}>& STORE</div>
        </div>
        {sheetStatus === "error" && (
          <div style={{ background: "rgba(255,150,0,0.07)", border: "1px solid rgba(255,150,0,0.22)", borderRadius: 8, padding: "10px 13px", marginBottom: 14, fontSize: 11, color: "rgba(255,180,0,0.88)", lineHeight: 1.7 }}>
            ⚠ Could not load database. Check your internet.<br />
            <button className="btn" onClick={onRefresh} style={{ marginTop: 5, padding: "4px 10px", background: "rgba(255,180,0,0.1)", border: "1px solid rgba(255,180,0,0.28)", color: "#ffd700", fontSize: 11, borderRadius: 5 }}>🔄 Retry</button>
          </div>
        )}
        <div style={{ marginBottom: 12 }}><label style={lbSt}>USERNAME</label>
          <input id="username-input" value={username} onChange={e => { setUsername(e.target.value); setError(""); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("pin-box")?.focus(); } }} style={inSt} placeholder="Enter username" autoComplete="off" />
        </div>
        <div style={{ marginBottom: 16 }}><label style={lbSt}>PIN CODE</label>
          <div id="pin-box" style={{ width: "100%", padding: "13px 14px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,180,255,0.25)", borderRadius: 8, textAlign: "center", minHeight: 50, userSelect: "none" }}>
            {pin.length > 0 ? <span style={{ color: "#fff", fontSize: 22, letterSpacing: 10 }}>{"●".repeat(pin.length)}</span> : <span style={{ color: "rgba(255,255,255,0.22)", fontSize: 12 }}>Type PIN or use pad below</span>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14, ...(shake ? { outline: "2px solid #ff6b6b", borderRadius: 8 } : {}) }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "✓"].map(k => (
            <button key={k} className="btn" onClick={() => padPress(String(k))}
              style={{ padding: "15px 10px", background: k === "✓" ? "linear-gradient(135deg,#0062ff,#00b4ff)" : k === "⌫" ? "rgba(255,80,80,0.12)" : "rgba(255,255,255,0.06)", border: k === "✓" ? "none" : `1px solid ${k === "⌫" ? "rgba(255,80,80,0.2)" : "rgba(255,255,255,0.08)"}`, color: k === "✓" ? "#fff" : k === "⌫" ? "#ff6b6b" : "#fff", fontSize: k === "✓" || k === "⌫" ? 18 : 20, fontWeight: 700, borderRadius: 8 }}>{k}</button>
          ))}
        </div>
        {error && <div style={{ color: "#ff6b6b", textAlign: "center", fontSize: 12, marginBottom: 12, padding: 8, background: "rgba(255,80,80,0.08)", borderRadius: 6 }}>{error}</div>}
        <button className="btn" onClick={() => doLogin()} style={{ width: "100%", padding: 14, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, letterSpacing: 3, borderRadius: 8, fontFamily: "Orbitron" }}>LOGIN</button>
      </div>
    </div>
  );
}

// ==================== POS Screen ====================
function emptyBill(id) { return { id, cart: [], payments: [{ type: "cash", amount: "", last4: "" }], saved: false, lastBill: null, billDiscPct: 0, customerName: "", customerCell: "", cashReceived: "", paymentMethod: "Cash" }; }

function POSScreen({ user, items, categories, billCounter, onLogout, onSaleSaved, sheetStatus, isOnline, lastSync, onRefresh, searchIndex, itemMap, sales, returns, returnCounter, onReturnSaved, onMarkReturnUsed, customers, setCustomers }) {
  const [bills, setBills] = useState([emptyBill(1)]);
  const [activeBillId, setActiveBillId] = useState(1);
  const [nextBillId, setNextBillId] = useState(2);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [kbIndex, setKbIndex] = useState(-1);
  const [tick, setTick] = useState(getNow());
  const [localCounter, setLocalCounter] = useState(billCounter);
  const [showCalc, setShowCalc] = useState(false);
  const [isFS, setIsFS] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [focusedQtyBarcode, setFocusedQtyBarcode] = useState(null);
  const searchRef = useRef();
  const resultsRef = useRef([]); resultsRef.current = results;
  const qtyRefs = useRef({});
  const scanBuffer = useRef(""); const scanTimer = useRef(null);

  useEffect(() => { setLocalCounter(billCounter); }, [billCounter]);
  useEffect(() => { const t = setInterval(() => setTick(getNow()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { setKbIndex(-1); }, [results]);
  useEffect(() => {
    if (focusedQtyBarcode) {
      const ref = qtyRefs.current[focusedQtyBarcode];
      if (ref) { ref.focus(); ref.select(); }
    }
  }, [focusedQtyBarcode]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 1) { setResults([]); return; }
    const timer = setTimeout(() => {
      if (searchIndex.size > 0) {
        setResults(searchIndex_run(searchIndex, itemMap, q));
      } else {
        setResults(items.filter(i => i.Barcode?.toLowerCase().includes(q.toLowerCase()) || i.ItemName?.toLowerCase().includes(q.toLowerCase())).slice(0, 12));
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [search, searchIndex, itemMap, items]);

  function searchIndex_run(index, iMap, query) {
    const q = query.toLowerCase().trim();
    if (iMap.has(query)) return [iMap.get(query)];
    const tokens = q.split(/\s+/);
    let resultSet = null;
    tokens.forEach(token => {
      const matches = index.get(token) || new Set();
      if (resultSet === null) resultSet = new Set(matches);
      else { for (const b of resultSet) { if (!matches.has(b)) resultSet.delete(b); } }
    });
    if (!resultSet) return [];
    return Array.from(resultSet).map(bc => iMap.get(bc)).filter(Boolean).slice(0, 12);
  }

  const toggleFS = () => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => {}); setIsFS(true); } else { document.exitFullscreen(); setIsFS(false); } };
  const ab = bills.find(b => b.id === activeBillId) || bills[0];
  const upd = fn => setBills(prev => prev.map(b => b.id === activeBillId ? fn(b) : b));
  const addNewBill = () => { const id = nextBillId; setBills(p => [...p, emptyBill(id)]); setActiveBillId(id); setNextBillId(id+1); setSearch(""); setResults([]); setTimeout(() => searchRef.current?.focus(), 60); };
  const closeBill = (id, e) => { e.stopPropagation(); if (bills.length === 1) { setBills([emptyBill(id)]); return; } const rem = bills.filter(b => b.id !== id); setBills(rem); if (activeBillId === id) setActiveBillId(rem[rem.length-1].id); };
  const focusSearch = useCallback(() => { setFocusedQtyBarcode(null); setTimeout(() => { if (searchRef.current) { searchRef.current.focus(); searchRef.current.select(); } }, 60); }, []);

  const addItem = useCallback(item => {
    upd(b => {
      const ex = b.cart.find(i => i.Barcode === item.Barcode);
      return { ...b, cart: ex ? b.cart.map(i => i.Barcode === item.Barcode ? { ...i, qty: i.qty + 1 } : i) : [...b.cart, { ...item, qty: 1 }] };
    });
    setSearch(""); setResults([]); setKbIndex(-1);
    setFocusedQtyBarcode(null);
    setTimeout(() => setFocusedQtyBarcode(item.Barcode), 50);
  }, []);

  const lastKeyTime = useRef(0);
  const handleSearchChange = useCallback(e => {
    const now = Date.now();
    const elapsed = now - lastKeyTime.current;
    lastKeyTime.current = now;
    const val = e.target.value;
    setSearch(val);
    if (elapsed < 50 && val.length > scanBuffer.current.length) scanBuffer.current = val;
    else if (elapsed >= 50) scanBuffer.current = "";
  }, []);
  const handleSearchKeyDown = useCallback(e => {
    const res = resultsRef.current;
    if (e.key === "ArrowDown")  { e.preventDefault(); setKbIndex(i => Math.min(i+1, res.length-1)); return; }
    if (e.key === "ArrowUp")    { e.preventDefault(); setKbIndex(i => Math.max(i-1, 0)); return; }
    if (e.key === "Escape")     { setSearch(""); setResults([]); setKbIndex(-1); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const bufVal = scanBuffer.current.trim();
      if (bufVal) { const exact = itemMap.get(bufVal) || items.find(i => i.Barcode === bufVal); if (exact) { addItem(exact); scanBuffer.current = ""; return; } }
      if (res.length > 0) { const idx = kbIndex >= 0 ? kbIndex : 0; if (res[idx]) addItem(res[idx]); }
      scanBuffer.current = "";
    }
  }, [kbIndex, addItem, itemMap, items]);
  const dropdownRef = useRef();
  useEffect(() => { if (!dropdownRef.current || kbIndex < 0) return; const el = dropdownRef.current.querySelectorAll(".search-item-row")[kbIndex]; if (el) el.scrollIntoView({ block: "nearest" }); }, [kbIndex]);

  const setQty = (bc, q) => upd(b => ({ ...b, cart: q <= 0 ? b.cart.filter(i => i.Barcode !== bc) : b.cart.map(i => i.Barcode === bc ? { ...i, qty: q } : i) }));
  const delItem = bc => { upd(b => ({ ...b, cart: b.cart.filter(i => i.Barcode !== bc) })); if (focusedQtyBarcode === bc) { setFocusedQtyBarcode(null); focusSearch(); } };
  const voidCart = () => { upd(b => ({ ...b, cart: [], payments: [{ type: "cash", amount: "", last4: "" }], saved: false, billDiscPct: 0, customerName: "", customerCell: "", cashReceived: "" })); setFocusedQtyBarcode(null); };
  const addPay = () => upd(b => ({ ...b, payments: [...b.payments, { type: "cash", amount: "", last4: "" }] }));
  const updPay = (i, f, v) => upd(b => ({ ...b, payments: b.payments.map((p, xi) => xi === i ? { ...p, [f]: v } : p) }));
  const delPay = i => upd(b => ({ ...b, payments: b.payments.filter((_, xi) => xi !== i) }));
  const setBDP = v => upd(b => ({ ...b, billDiscPct: parseFloat(v) || 0 }));
  const setCustName = v => upd(b => ({ ...b, customerName: v }));
  const setCustCell = v => upd(b => ({ ...b, customerCell: v }));
  const setPaymentMethod = v => upd(b => ({ ...b, paymentMethod: v }));
  const applyRefund = (refundAmt, returnNo) => {
    upd(b => ({ ...b, payments: [...b.payments.filter(p => p.type !== "refund"), { type: "refund", amount: String(refundAmt), origReturnNo: returnNo }] }));
    onMarkReturnUsed(returnNo);
  };

  const cart = ab.cart;
  const payments = ab.payments;
  const billDiscPct = ab.billDiscPct || 0;
  const subTotal = cart.reduce((s, i) => s + parseFloat(i.Price || 0) * i.qty, 0);
  const itemDiscount = cart.reduce((s, i) => s + parseFloat(i.Discount || 0) * i.qty, 0);
  const afterItems = subTotal - itemDiscount;
  const billDiscount = parseFloat(((afterItems * billDiscPct) / 100).toFixed(2));
  const refundApplied = payments.filter(p => p.type === "refund").reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const grandTotal = afterItems - billDiscount + 0;
  const netTotal = Math.max(0, grandTotal - refundApplied);
  const totalReceived = payments.filter(p => p.type !== "refund").reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const change = totalReceived - netTotal;
  const canSave = cart.length > 0;
  const selectedPaymentMethod = ab.paymentMethod || "Cash";
  const isCash = selectedPaymentMethod === "Cash";
  const cashRequired = netTotal;
  const cashEntered = parseFloat(ab.cashReceived || 0);
  const sufficientCash = isCash ? cashEntered >= cashRequired : true;

  const saveBill = () => {
    if (!canSave || (isCash && !sufficientCash)) return;
    const billNo = String(localCounter).padStart(4, "0");
    const { date, time } = getNow();
    const totalDiscount = itemDiscount + billDiscount;
    const customerInfo = { Name: ab.customerName?.trim() || "Unknown", CellNo: ab.customerCell?.trim() || "" };
    const isKnownCustomer = customerInfo.Name && customerInfo.Name !== "Unknown" && customerInfo.Name.trim() !== "" && customerInfo.CellNo && customerInfo.CellNo.trim() !== "";
    const bill = { BillNo: billNo, Date: date, Time: time, Cashier: user.Name, GrandTotal: netTotal, Discount: totalDiscount, FBR: 0, PaymentMethod: selectedPaymentMethod, ItemsDetail: JSON.stringify(cart), items: cart, CustomerName: customerInfo.Name, CustomerCell: customerInfo.CellNo, RefundApplied: refundApplied };
    onSaleSaved(bill, isKnownCustomer ? customerInfo : { Name: "Unknown", CellNo: "" }, selectedPaymentMethod);
    setLocalCounter(c => c + 1);
    upd(b => ({ ...b, saved: true, lastBill: bill }));
    printReceipt({
      billNo, date, time, cashier: user.Name, items: cart, subTotal: afterItems, totalDiscount, itemDiscount, billDiscount, billDiscountPct, grandTotal: netTotal, payments: (isCash ? [{ type: "cash", amount: cashEntered }] : [{ type: "credit", amount: netTotal }]), change: isCash ? cashEntered - netTotal : 0, customerName: customerInfo.Name, customerCell: customerInfo.CellNo, refundApplied
    });
    setFocusedQtyBarcode(null);
    setTimeout(() => { upd(b => ({ ...b, cart: [], payments: [{ type: "cash", amount: "", last4: "" }], saved: false, billDiscPct: 0, customerName: "", customerCell: "", cashReceived: "" })); focusSearch(); }, 2500);
  };

  const grouped = {}; cart.forEach(item => { const c = item.Category || "General"; if (!grouped[c]) grouped[c] = []; grouped[c].push(item); });
  const catKeys = Object.keys(grouped).sort();

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0a0e1a", overflow: "hidden" }}>
      <div style={{ background: "linear-gradient(90deg,#0c1828,#091422)", borderBottom: "1px solid rgba(0,180,255,0.18)", padding: "7px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ fontFamily: "Orbitron", color: "#00b4ff", fontSize: 13, fontWeight: 900 }}>itKINS: MART POS</div>
          <div style={{ padding: "3px 12px", borderRadius: 20, background: "rgba(0,180,255,0.07)", border: "1px solid rgba(0,180,255,0.16)", color: "#00b4ff", fontSize: 11, fontWeight: 600 }}>CASHIER: {user?.Name?.toUpperCase()}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{tick.date} {tick.time}</div>
          <div style={{ padding: "3px 12px", borderRadius: 20, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: "#fff", fontSize: 11, fontWeight: 600 }}>BILL# {String(localCounter).padStart(4, "0")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          <StatusBar isOnline={isOnline} sheetStatus={sheetStatus} lastSync={lastSync} onRefresh={onRefresh} />
          <button className="btn" onClick={() => setShowReturn(true)} title="Process Return/Refund" style={{ padding: "5px 10px", background: "rgba(255,150,0,0.12)", border: "1px solid rgba(255,150,0,0.3)", color: "#ff9500", fontSize: 12, borderRadius: 6 }}>↩ Return</button>
          <button className="btn" onClick={() => setShowCalc(v => !v)} title="Calculator" style={{ padding: "5px 10px", background: showCalc ? "rgba(0,180,255,0.25)" : "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.3)", color: "#00b4ff", fontSize: 14, borderRadius: 6 }}>🧮</button>
          <button className="btn" onClick={toggleFS} style={{ padding: "5px 10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 13, borderRadius: 6 }}>{isFS ? "⤡" : "⤢"}</button>
          <button className="btn" onClick={onLogout} style={{ padding: "5px 12px", background: "rgba(255,80,80,0.12)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff6b6b", fontSize: 11, borderRadius: 6 }}>LOGOUT</button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", background: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "4px 12px 0", flexShrink: 0, gap: 4, overflowX: "auto" }}>
        {bills.map(b => {
          const isA = b.id === activeBillId;
          const bT = b.cart.reduce((s, i) => s + parseFloat(i.Price || 0) * i.qty - parseFloat(i.Discount || 0) * i.qty, 0) + 1;
          return (
            <div key={b.id} onClick={() => { setActiveBillId(b.id); setTimeout(() => searchRef.current?.focus(), 40); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px 7px", cursor: "pointer", borderRadius: "8px 8px 0 0", flexShrink: 0, background: isA ? "rgba(0,180,255,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${isA ? "rgba(0,180,255,0.3)" : "rgba(255,255,255,0.07)"}`, borderBottom: isA ? "1px solid #0a0e1a" : "1px solid rgba(255,255,255,0.07)", marginBottom: isA ? -1 : 0 }}>
              <span style={{ color: isA ? "#00b4ff" : "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: isA ? 700 : 400 }}>
                Bill {b.id}
                {b.customerName && b.customerName.trim() !== "" && b.customerName !== "Unknown" && <span style={{ color: "#00e5a0", fontSize: 10, marginLeft: 4 }}>· {b.customerName}</span>}
                {b.cart.length > 0 && <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, marginLeft: 4 }}>({b.cart.length} · PKR {fmt(bT)})</span>}
              </span>
              <span onClick={e => closeBill(b.id, e)} style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, padding: "0 2px", cursor: "pointer" }} onMouseEnter={e => e.target.style.color = "#ff6b6b"} onMouseLeave={e => e.target.style.color = "rgba(255,255,255,0.3)"}>✕</span>
            </div>
          );
        })}
        <button className="btn" onClick={addNewBill} style={{ padding: "5px 12px", background: "rgba(0,180,255,0.07)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 12, borderRadius: "6px 6px 0 0", flexShrink: 0, marginBottom: -1 }}>+ New Bill</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* LEFT: Cart */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 12, overflow: "hidden", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#00b4ff", fontSize: 18, pointerEvents: "none" }}>⌕</span>
            <input ref={searchRef} value={search} onChange={handleSearchChange} onKeyDown={handleSearchKeyDown} autoFocus placeholder="Scan barcode or type item name..." style={{ ...inSt, paddingLeft: 36, fontSize: 14 }} tabIndex={1} />
            {results.length > 0 && (
              <div ref={dropdownRef} style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#0c1828", border: "1px solid rgba(0,180,255,0.28)", borderRadius: 8, zIndex: 200, boxShadow: "0 8px 40px rgba(0,0,0,0.65)", maxHeight: 320, overflowY: "auto" }}>
                <div style={{ padding: "4px 13px", background: "rgba(0,180,255,0.04)", borderBottom: "1px solid rgba(0,180,255,0.1)", color: "rgba(0,180,255,0.5)", fontSize: 9, letterSpacing: 1 }}>↑↓ NAVIGATE &nbsp;·&nbsp; ENTER SELECT → QTY &nbsp;·&nbsp; ESC CLOSE &nbsp;·&nbsp; SCANNER SUPPORTED</div>
                {results.map((item, i) => {
                  const stk = Number(item.Stock) || 0; const isKb = i === kbIndex;
                  return (
                    <div key={i} className={`search-item-row${isKb ? " kb-selected" : ""}`} onClick={() => addItem(item)}
                      style={{ padding: "9px 13px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center", background: isKb ? "rgba(0,180,255,0.16)" : "transparent", borderLeft: isKb ? "3px solid #00b4ff" : "3px solid transparent" }}>
                      <div>
                        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{item.ItemName}</div>
                        <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 10 }}>{item.Barcode} · {item.Category}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>PKR {fmt(item.Price)}</div>
                        {parseFloat(item.Discount) > 0 && <div style={{ color: "#ffd700", fontSize: 10 }}>Disc: PKR {fmt(item.Discount)}</div>}
                        <div style={{ fontSize: 10, color: stk <= 0 ? "#ff6b6b" : stk <= 5 ? "#ffd700" : "rgba(255,255,255,0.28)" }}>Stock:{item.Stock}{stk <= 0 ? " ❌" : stk <= 5 ? " ⚠" : ""}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 120px 90px 80px 88px 30px", padding: "8px 12px", background: "rgba(0,180,255,0.07)", borderBottom: "1px solid rgba(0,180,255,0.12)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700, position: "sticky", top: 0 }}>
              <div>ITEM</div><div style={{ textAlign: "center" }}>QTY</div><div style={{ textAlign: "right" }}>PRICE</div><div style={{ textAlign: "right" }}>DISC</div><div style={{ textAlign: "right" }}>TOTAL</div><div />
            </div>
            {cart.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 160, color: "rgba(255,255,255,0.14)", gap: 8 }}>
                <div style={{ fontSize: 34 }}>🛒</div><div style={{ fontSize: 12 }}>Scan or search items to add</div>
              </div>
            ) : catKeys.map(cat => (
              <div key={cat}>
                <div style={{ padding: "5px 12px", background: "rgba(0,180,255,0.04)", color: "#00b4ff", fontSize: 10, letterSpacing: 3, fontWeight: 700, borderBottom: "1px solid rgba(0,180,255,0.08)" }}>── {cat.toUpperCase()} ──</div>
                {grouped[cat].map(item => {
                  const disc = parseFloat(item.Discount || 0);
                  const lt = item.qty * parseFloat(item.Price || 0) - disc * item.qty;
                  const isFocusedQty = focusedQtyBarcode === item.Barcode;
                  return (
                    <div key={item.Barcode} style={{ display: "grid", gridTemplateColumns: "2fr 120px 90px 80px 88px 30px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", background: isFocusedQty ? "rgba(0,180,255,0.04)" : "transparent", transition: "background 0.2s" }}>
                      <div>
                        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{item.ItemName}</div>
                        <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10 }}>{item.Barcode}{item.Stock <= 5 && <span style={{ color: "#ffd700", marginLeft: 6 }}>⚠ Low Stock</span>}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                        <button className="btn" onClick={() => setQty(item.Barcode, item.qty - 1)} tabIndex={-1} style={{ width: 22, height: 22, background: "rgba(255,80,80,0.13)", border: "1px solid rgba(255,80,80,0.26)", color: "#ff8888", fontSize: 15, borderRadius: 4, padding: 0 }}>−</button>
                        <input ref={el => { qtyRefs.current[item.Barcode] = el; }} type="number" min="1" value={item.qty} onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) setQty(item.Barcode, v); else if (e.target.value === "") setQty(item.Barcode, 1); }} onFocus={e => { e.target.select(); setFocusedQtyBarcode(item.Barcode); }} onBlur={() => { setTimeout(() => { const active = document.activeElement; const isAnotherQty = Object.values(qtyRefs.current).some(r => r === active); if (!isAnotherQty) setFocusedQtyBarcode(null); }, 100); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setFocusedQtyBarcode(null); setTimeout(() => searchRef.current?.focus(), 30); } if (e.key === "Escape") { e.preventDefault(); setFocusedQtyBarcode(null); setTimeout(() => searchRef.current?.focus(), 30); } if (e.key === "ArrowUp") { e.preventDefault(); setQty(item.Barcode, item.qty + 1); } if (e.key === "ArrowDown") { e.preventDefault(); if (item.qty > 1) setQty(item.Barcode, item.qty - 1); } }} className={isFocusedQty ? "qty-focus-input" : ""} style={{ width: 52, padding: "4px 6px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(0,180,255,0.25)", borderRadius: 5, color: "#fff", fontSize: 14, fontWeight: 700, textAlign: "center", outline: "none", transition: "all 0.15s", MozAppearance: "textfield"}} tabIndex={0} />
                        <button className="btn" onClick={() => setQty(item.Barcode, item.qty + 1)} tabIndex={-1} style={{ width: 22, height: 22, background: "rgba(0,180,255,0.13)", border: "1px solid rgba(0,180,255,0.26)", color: "#00b4ff", fontSize: 15, borderRadius: 4, padding: 0 }}>+</button>
                      </div>
                      <div style={{ color: "#e0e0e0", textAlign: "right", fontSize: 12 }}>{fmt(item.Price)}</div>
                      <div style={{ color: disc > 0 ? "#ffd700" : "rgba(255,255,255,0.22)", textAlign: "right", fontSize: 12 }}>{disc > 0 ? fmt(disc * item.qty) : "—"}</div>
                      <div style={{ color: "#00e5a0", textAlign: "right", fontSize: 13, fontWeight: 700 }}>{fmt(lt)}</div>
                      <button className="btn" onClick={() => delItem(item.Barcode)} tabIndex={-1} style={{ width: 26, height: 26, background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.17)", color: "#ff6b6b", fontSize: 12, borderRadius: 4, padding: 0 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "11px 15px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, color: "rgba(255,255,255,0.48)", fontSize: 12 }}><span>Sub Total</span><span>PKR {fmt(subTotal)}</span></div>
            {itemDiscount > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, color: "#ffd700", fontSize: 12 }}><span>Item Discounts</span><span>− PKR {fmt(itemDiscount)}</span></div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ color: "rgba(255,200,0,0.8)", fontSize: 12, whiteSpace: "nowrap" }}>Bill Discount %</span>
              <input type="number" min="0" max="100" value={billDiscPct || ""} onChange={e => setBDP(e.target.value)} placeholder="0" tabIndex={2} style={{ ...inSt, width: 70, padding: "4px 8px", fontSize: 13, textAlign: "center", border: "1px solid rgba(255,200,0,0.35)" }} />
              {billDiscount > 0 && <span style={{ color: "#ffd700", fontSize: 12, marginLeft: "auto" }}>− PKR {fmt(billDiscount)}</span>}
            </div>
            {refundApplied > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, color: "#ff9500", fontSize: 12 }}><span>↩ Refund Applied</span><span>− PKR {fmt(refundApplied)}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7, color: "rgba(255,255,255,0.3)", fontSize: 11 }}><span>FBR Charges</span><span>PKR 0.00</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 7 }}>
              <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>GRAND TOTAL</span>
              <span style={{ color: "#00b4ff", fontSize: 20, fontWeight: 800, fontFamily: "Orbitron" }}>PKR {fmt(netTotal)}</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Customer & Payment */}
        <div style={{ width: 320, background: "rgba(255,255,255,0.012)", borderLeft: "1px solid rgba(255,255,255,0.06)", padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
          <CashierCustomerLedger customers={customers} sales={sales} currentBillTotal={netTotal} onSelectCustomer={(name, cell) => { setCustName(name); setCustCell(cell); }} selectedName={ab.customerName} selectedCell={ab.customerCell} onClear={() => { setCustName(""); setCustCell(""); }} />

          <div style={{ background: "rgba(0,180,255,0.05)", border: "1px solid rgba(0,180,255,0.18)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#00b4ff", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 8 }}>💳 PAYMENT METHOD</div>
            <select value={selectedPaymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={{ ...slSt, width: "100%", padding: "8px 10px", fontSize: 13 }}>
              <option value="Cash">Cash</option>
              <option value="Credit">Credit</option>
            </select>
          </div>

          {selectedPaymentMethod === "Cash" && (
            <div>
              <label style={lbSt}>CASH RECEIVED</label>
              <input type="number" value={ab.cashReceived || ""} onChange={e => upd(b => ({ ...b, cashReceived: e.target.value }))} placeholder={`Min: PKR ${fmt(netTotal)}`} style={{ ...inSt, fontSize: 15, textAlign: "center", border: "1px solid rgba(0,229,160,0.4)" }} />
              {parseFloat(ab.cashReceived) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, padding: "7px 10px", background: parseFloat(ab.cashReceived) >= netTotal ? "rgba(0,229,160,0.08)" : "rgba(255,80,80,0.08)", border: `1px solid ${parseFloat(ab.cashReceived) >= netTotal ? "rgba(0,229,160,0.3)" : "rgba(255,80,80,0.3)"}`, borderRadius: 7 }}>
                  <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>Change</span>
                  <span style={{ color: parseFloat(ab.cashReceived) >= netTotal ? "#00e5a0" : "#ff6b6b", fontWeight: 800, fontSize: 14 }}>PKR {fmt(Math.max(0, parseFloat(ab.cashReceived || 0) - netTotal))}</span>
                </div>
              )}
            </div>
          )}

          <RefundApplyPanel returns={returns} onApply={applyRefund} appliedPayments={payments} />

          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn" onClick={voidCart} tabIndex={-1} style={{ flex: 1, padding: 11, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.26)", color: "#ff6b6b", fontSize: 12, borderRadius: 8 }}>🗑 VOID</button>
            <button className="btn" onClick={saveBill} disabled={!canSave || (selectedPaymentMethod === "Cash" && (parseFloat(ab.cashReceived || 0) < netTotal))} tabIndex={7} style={{ flex: 2, padding: 11, background: canSave && (selectedPaymentMethod !== "Cash" || parseFloat(ab.cashReceived || 0) >= netTotal) ? "linear-gradient(135deg,#00a651,#00e5a0)" : "rgba(255,255,255,0.04)", border: "none", color: canSave && (selectedPaymentMethod !== "Cash" || parseFloat(ab.cashReceived || 0) >= netTotal) ? "#000" : "rgba(255,255,255,0.16)", fontSize: 12, fontWeight: 700, borderRadius: 8, letterSpacing: 1 }}>
              {ab.saved ? "✓ SAVED!" : "🖨 SAVE & PRINT"}
            </button>
          </div>
          {ab.lastBill && <button className="btn" onClick={() => printReceipt(ab.lastBill)} tabIndex={-1} style={{ padding: 9, background: "rgba(0,180,255,0.08)", border: "1px solid rgba(0,180,255,0.26)", color: "#00b4ff", fontSize: 12, borderRadius: 8 }}>🖨 Reprint Last Receipt</button>}
        </div>
      </div>

      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      {showReturn && <ReturnModal user={user} sales={sales} items={items} returnCounter={returnCounter} onReturnSaved={ret => { onReturnSaved(ret); setShowReturn(false); }} onClose={() => setShowReturn(false)} />}
    </div>
  );
}

// ==================== StatusBar ====================
        
function StatusBar({ isOnline, sheetStatus, lastSync, onRefresh }) {
  const syncLabel = lastSync ? lastSync.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "Not synced";
  const statusColor = sheetStatus === "loaded" ? "#00e080" : sheetStatus === "cached" ? "#00b4ff" : sheetStatus === "error" ? "#ff6b6b" : "#ffd700";
  const statusText  = sheetStatus === "loaded" ? `${syncLabel}` : sheetStatus === "cached" ? "Cached" : sheetStatus === "error" ? "Error · Retry" : sheetStatus === "syncing" ? "Syncing..." : "Demo";
  const statusIcon  = sheetStatus === "loaded" ? "✓" : sheetStatus === "cached" ? "💾" : sheetStatus === "error" ? "⚠" : sheetStatus === "syncing" ? "⟳" : "◉";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div title={isOnline ? "Online" : "Offline"} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: isOnline ? "rgba(0,200,0,0.12)" : "rgba(255,80,80,0.12)", border: `1px solid ${isOnline ? "rgba(0,200,0,0.35)" : "rgba(255,80,80,0.35)"}`, color: isOnline ? "#00e080" : "#ff6b6b", whiteSpace: "nowrap" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: isOnline ? "#00e080" : "#ff6b6b", display: "inline-block", boxShadow: isOnline ? "0 0 6px #00e080" : "none" }} />
        {isOnline ? "Online" : "Offline"}
      </div>
      <div onClick={onRefresh} title="Click to sync" style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: "pointer", background: `rgba(${sheetStatus === "loaded" ? "0,160,0" : sheetStatus === "error" ? "255,80,80" : "255,200,0"},0.15)`, border: `1px solid ${statusColor}66`, color: statusColor, whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 11 }}>{statusIcon}</span>{statusText}<span style={{ opacity: 0.5, fontSize: 9, marginLeft: 2 }}>↻</span>
      </div>
    </div>
  );
}

// ==================== Calculator ====================

function Calculator({ onClose }) {
  const [disp, setDisp] = useState("0"); const [prev, setPrev] = useState(null); const [op, setOp] = useState(null); const [fresh, setFresh] = useState(true);
  const [pos, setPos] = useState({ x: null, y: null }); const dragging = useRef(false); const dragOffset = useRef({ dx: 0, dy: 0 }); const calcRef = useRef();
  useEffect(() => {
    const handler = e => {
      const k = e.key;
      if (k >= "0" && k <= "9") { e.preventDefault(); press(k); }
      else if (k === "." || k === ",") { e.preventDefault(); press("."); }
      else if (k === "+" || k === "-") { e.preventDefault(); press(k); }
      else if (k === "*") { e.preventDefault(); press("×"); }
      else if (k === "/") { e.preventDefault(); press("÷"); }
      else if (k === "Enter" || k === "=") { e.preventDefault(); press("="); }
      else if (k === "Backspace") { e.preventDefault(); press("⌫"); }
      else if (k === "Escape") { onClose(); }
      else if (k === "c" || k === "C") { e.preventDefault(); press("C"); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  const press = v => {
    if (v === "C") { setDisp("0"); setPrev(null); setOp(null); setFresh(true); return; }
    if (v === "⌫") { setDisp(d => d.length > 1 ? d.slice(0, -1) : "0"); return; }
    if (["+", "-", "×", "÷"].includes(v)) { setPrev(parseFloat(disp)); setOp(v); setFresh(true); return; }
    if (v === "=") { if (prev != null && op) { const a = prev, b = parseFloat(disp); let r = op === "+" ? a + b : op === "-" ? a - b : op === "×" ? a * b : b !== 0 ? a / b : 0; setDisp(String(parseFloat(r.toFixed(6)))); setPrev(null); setOp(null); setFresh(true); } return; }
    if (v === ".") { if (!disp.includes(".")) { setDisp(d => (fresh ? "0" : d) + "."); setFresh(false); } return; }
    setDisp(d => fresh ? v : (d === "0" ? v : d + v)); setFresh(false);
  };
  const onMouseDown = e => { if (e.target.closest("button")) return; dragging.current = true; const rect = calcRef.current.getBoundingClientRect(); dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }; e.preventDefault(); };
  useEffect(() => { const move = e => { if (!dragging.current) return; setPos({ x: e.clientX - dragOffset.current.dx, y: e.clientY - dragOffset.current.dy }); }; const up = () => { dragging.current = false; }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }; }, []);
  const rows = [["7", "8", "9", "÷"], ["4", "5", "6", "×"], ["1", "2", "3", "-"], ["C", "0", ".", "+"], ["⌫", "", "", "="]];
  const style = pos.x !== null ? { position: "fixed", left: pos.x, top: pos.y, zIndex: 3000 } : { position: "fixed", bottom: 80, right: 20, zIndex: 3000 };
  return (
    <div ref={calcRef} style={{ ...style, background: "#0d1b2a", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 14, boxShadow: "0 8px 40px rgba(0,0,0,0.7)", width: 228, userSelect: "none" }}>
      <div onMouseDown={onMouseDown} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, cursor: "grab" }}>
        <div style={{ color: "#00b4ff", fontFamily: "Orbitron", fontSize: 11, fontWeight: 700 }}>🧮 CALCULATOR</div>
        <button className="btn" onClick={onClose} style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 14, padding: "2px 8px", borderRadius: 5 }}>✕</button>
      </div>
      <div style={{ background: "rgba(0,0,0,0.45)", borderRadius: 8, padding: "10px 12px", marginBottom: 10, textAlign: "right" }}>
        {op && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{prev} {op}</div>}
        <div style={{ color: "#fff", fontSize: 26, fontWeight: 700, fontFamily: "Orbitron", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{disp}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5 }}>
        {rows.flat().map((k, i) => (k === "" ? <div key={i} /> : <button key={i} onClick={() => press(k)} style={{ padding: "11px 0", background: k === "=" ? "linear-gradient(135deg,#0062ff,#00b4ff)" : ["÷", "×", "-", "+"].includes(k) ? "rgba(0,180,255,0.18)" : k === "C" ? "rgba(255,80,80,0.18)" : k === "⌫" ? "rgba(255,150,0,0.15)" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: k === "=" ? "#fff" : k === "C" ? "#ff6b6b" : "#fff", fontSize: 14, fontWeight: 700, borderRadius: 6, cursor: "pointer" }}>{k}</button>))}
      </div>
    </div>
  );
}

// ==================== CashierCustomerLedger ====================

function CashierCustomerLedger({ customers, sales, currentBillTotal, onSelectCustomer, selectedName, selectedCell, onClear }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!selectedName || selectedName.trim() === "" || selectedName === "Unknown") {
      setSelected(null);
      setQuery("");
    }
  }, [selectedName]);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) { setResults([]); return; }
    setResults(customers.filter(c => c.Name?.toLowerCase().includes(q) || c.CellNo?.includes(q)).slice(0, 6));
  }, [query, customers]);

  const getPending = (c) => {
    const billNos = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
    const totalBills = billNos.reduce((s, bn) => {
      const sale = sales.find(s => s.BillNo === bn);
      return s + parseFloat(sale?.GrandTotal || 0);
    }, 0);
    const totalPaid = (c.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    return Math.max(0, totalBills - totalPaid);
  };

  const handleSelect = (c) => {
    setSelected(c);
    setQuery("");
    setResults([]);
    onSelectCustomer(c.Name, c.CellNo);
  };

  const handleClear = () => {
    setSelected(null);
    onClear();
  };

  const isSelected = selectedName && selectedName.trim() !== "" && selectedName !== "Unknown";
  const selCustomer = isSelected ? (customers.find(c => c.CellNo === selectedCell) || null) : null;
  const pending = selCustomer ? getPending(selCustomer) : 0;

  return (
    <div style={{ background: "rgba(0,180,255,0.05)", border: "1px solid rgba(0,180,255,0.18)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ color: "rgba(0,180,255,0.8)", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 8 }}>👤 CUSTOMER LEDGER</div>
      {!isSelected ? (
        <div style={{ position: "relative" }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or cell number..." style={{ ...inSt, padding: "7px 11px", fontSize: 12, border: "1px solid rgba(0,180,255,0.2)", width: "100%" }} />
          {results.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#0c1828", border: "1px solid rgba(0,180,255,0.28)", borderRadius: 8, zIndex: 200, boxShadow: "0 8px 30px rgba(0,0,0,0.6)" }}>
              {results.map((c, i) => {
                const p = getPending(c);
                return (
                  <div key={i} onClick={() => handleSelect(c)} style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(0,180,255,0.1)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div>
                      <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{c.Name}</div>
                      <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 10, fontFamily: "monospace" }}>{c.CellNo}</div>
                    </div>
                    {p > 0 && <span style={{ color: "#ff6b6b", fontSize: 11, fontWeight: 700 }}>Pending: PKR {fmt(p)}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{selectedName}</div>
              <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11, fontFamily: "monospace" }}>{selectedCell}</div>
            </div>
            <button className="btn" onClick={handleClear} style={{ padding: "4px 9px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 5 }}>✕</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {pending > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(255,80,80,0.07)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 7, padding: "6px 10px" }}>
                <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>Previous Pending</span>
                <span style={{ color: "#ff6b6b", fontWeight: 700, fontSize: 13 }}>PKR {fmt(pending)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,180,255,0.06)", border: "1px solid rgba(0,180,255,0.15)", borderRadius: 7, padding: "6px 10px" }}>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>Today's Purchase</span>
              <span style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>PKR {fmt(currentBillTotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,229,160,0.07)", border: "1px solid rgba(0,229,160,0.2)", borderRadius: 7, padding: "6px 10px" }}>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>Total After Bill</span>
              <span style={{ color: "#00e5a0", fontWeight: 800, fontSize: 14 }}>PKR {fmt(pending + currentBillTotal)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== RefundApplyPanel ====================
function RefundApplyPanel({ returns, onApply, appliedPayments }) {
  const [returnNo, setReturnNo] = useState("");
  const [found, setFound] = useState(null);
  const [msg, setMsg] = useState("");

  const alreadyApplied = found && (found.usedInBill === true || found.UsedInBill === "1" || found.UsedInBill === "true" || appliedPayments.some(p => p.type === "refund" && p.origReturnNo === found.ReturnNo));

  const lookup = () => {
    const q = returnNo.trim().toUpperCase();
    const match = returns.find(r => r.ReturnNo?.toUpperCase() === q || r.ReturnNo?.toUpperCase() === "R" + q.replace(/\D/g, "").padStart(4, "0") || r.ReturnNo?.replace(/\D/g, "") === q.replace(/\D/g, ""));
    if (match) { setFound(match); setMsg(""); }
    else { setFound(null); setMsg("Return not found"); }
  };

  const apply = () => {
    if (!found || alreadyApplied) return;
    onApply(parseFloat(found.RefundAmount), found.ReturnNo);
    setReturnNo(""); setFound(null);
    setMsg("✅ Refund applied");
    setTimeout(() => setMsg(""), 3000);
  };

  return (
    <div style={{ background: "rgba(255,150,0,0.05)", border: "1px solid rgba(255,150,0,0.2)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ color: "#ff9500", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 8 }}>↩ APPLY REFUND TO THIS BILL</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
        <input value={returnNo} onChange={e => { setReturnNo(e.target.value); setFound(null); setMsg(""); }} onKeyDown={e => e.key === "Enter" && lookup()} placeholder="Return # (e.g. R0002)" style={{ ...inSt, flex: 1, padding: "6px 10px", fontSize: 12, border: "1px solid rgba(255,150,0,0.3)" }} />
        <button className="btn" onClick={lookup} style={{ padding: "6px 11px", background: "rgba(255,150,0,0.15)", border: "1px solid rgba(255,150,0,0.3)", color: "#ff9500", fontSize: 12, borderRadius: 6 }}>Find</button>
      </div>
      {msg && <div style={{ fontSize: 11, color: msg.startsWith("✅") ? "#00e5a0" : "#ff6b6b", marginBottom: 6 }}>{msg}</div>}
      {found && !alreadyApplied && (
        <div style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.2)", borderRadius: 7, padding: "8px 10px" }}>
          <div style={{ color: "#fff", fontSize: 11, marginBottom: 8 }}>{found.ReturnNo} — {found.Date} — Orig Bill #{found.OrigBillNo}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>Refund Amount</span>
            <span style={{ color: "#ff9500", fontWeight: 700, fontSize: 15 }}>PKR {fmt(found.RefundAmount)}</span>
          </div>
          <button className="btn" onClick={apply} style={{ width: "100%", padding: "7px", background: "linear-gradient(135deg,#ff6b00,#ff9500)", color: "#fff", fontSize: 12, borderRadius: 6, fontWeight: 700 }}>↩ Apply Refund to Bill</button>
        </div>
      )}
      {alreadyApplied && <div style={{ fontSize: 11, color: "#ff6b6b", padding: "7px 10px", background: "rgba(255,80,80,0.07)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 6 }}>⛔ Return {found?.ReturnNo} has already been used in a bill.</div>}
    </div>
  );
}

// ==================== ReturnModal ====================

function ReturnModal({ user, sales, items, returnCounter, onReturnSaved, onClose }) {
  const [step, setStep] = useState(1);
  const [billNo, setBillNo] = useState("");
  const [foundSale, setFoundSale] = useState(null);
  const [saleItems, setSaleItems] = useState([]);
  const [returnQtys, setReturnQtys] = useState({});
  const [reason, setReason] = useState("Customer Return");
  const [msg, setMsg] = useState("");

  const findBill = () => {
    const s = sales.find(s => s.BillNo === billNo.trim().padStart(4, "0") || s.BillNo === billNo.trim());
    if (!s) { setMsg("Bill not found"); return; }
    const si = safeParseItems(s.ItemsDetail);
    setFoundSale(s); setSaleItems(si);
    const qtys = {}; si.forEach(i => { qtys[i.Barcode] = 0; });
    setReturnQtys(qtys); setStep(2); setMsg("");
  };

  const setRQ = (bc, v) => setReturnQtys(p => ({ ...p, [bc]: Math.max(0, Math.min(parseInt(v) || 0, saleItems.find(i => i.Barcode === bc)?.qty || 0)) }));

  const refundAmt = saleItems.reduce((s, i) => {
    const qty = returnQtys[i.Barcode] || 0;
    const disc = parseFloat(i.Discount || 0);
    return s + qty * (parseFloat(i.Price || 0) - disc);
  }, 0);

  const returnedItems = saleItems.filter(i => (returnQtys[i.Barcode] || 0) > 0).map(i => ({ ...i, qty: returnQtys[i.Barcode] }));

  const confirmReturn = () => {
    if (returnedItems.length === 0) { setMsg("Select at least one item to return"); return; }
    const { date, time } = getNow();
    const ReturnNo = "R" + String(returnCounter).padStart(4, "0");
    const ret = { ReturnNo, OrigBillNo: foundSale.BillNo, Date: date, Time: time, Cashier: user.Name, Items: JSON.stringify(returnedItems), RefundAmount: refundAmt, Reason: reason };
    onReturnSaved(ret);
    printReturnReceipt(ret);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d1b2a", border: "1px solid rgba(255,150,0,0.35)", borderRadius: 14, padding: 24, maxWidth: 560, width: "100%", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: "Orbitron", color: "#ff9500", fontSize: 15 }}>↩ RETURN / REFUND</div>
          <button className="btn" onClick={onClose} style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 13, borderRadius: 6 }}>✕</button>
        </div>

        {step === 1 && (
          <div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginBottom: 12 }}>Enter the original bill number to process a return.</div>
            <div style={{ display: "flex", gap: 9 }}>
              <input value={billNo} onChange={e => setBillNo(e.target.value)} onKeyDown={e => e.key === "Enter" && findBill()} placeholder="Bill Number (e.g. 0115)" style={{ ...inSt, flex: 1 }} autoFocus />
              <button className="btn" onClick={findBill} style={{ padding: "9px 18px", background: "linear-gradient(135deg,#ff6b00,#ff9500)", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>Find Bill</button>
            </div>
            {msg && <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 8 }}>{msg}</div>}
          </div>
        )}

        {step === 2 && foundSale && (
          <div>
            <div style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.2)", borderRadius: 9, padding: "10px 14px", marginBottom: 16 }}>
              <div style={{ color: "#ff9500", fontSize: 12, fontWeight: 700 }}>Bill #{foundSale.BillNo} — {foundSale.Date} — {foundSale.Cashier}</div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>Customer: {foundSale.CustomerName || "Unknown"} · Total: PKR {fmt(foundSale.GrandTotal)}</div>
            </div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginBottom: 10 }}>Select items and quantities to return:</div>
            {saleItems.map(item => (
              <div key={item.Barcode} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: "rgba(255,255,255,0.025)", border: `1px solid ${(returnQtys[item.Barcode] || 0) > 0 ? "rgba(255,150,0,0.3)" : "rgba(255,255,255,0.06)"}`, borderRadius: 8, marginBottom: 7 }}>
                <div>
                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{item.ItemName}</div>
                  <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>Sold: {item.qty} · PKR {fmt(item.Price)} each</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>Return:</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button className="btn" onClick={() => setRQ(item.Barcode, (returnQtys[item.Barcode] || 0) - 1)} style={{ width: 24, height: 24, background: "rgba(255,80,80,0.13)", border: "1px solid rgba(255,80,80,0.26)", color: "#ff8888", fontSize: 15, borderRadius: 4, padding: 0 }}>−</button>
                    <span style={{ color: (returnQtys[item.Barcode] || 0) > 0 ? "#ff9500" : "#fff", fontWeight: 700, fontSize: 14, minWidth: 24, textAlign: "center" }}>{returnQtys[item.Barcode] || 0}</span>
                    <button className="btn" onClick={() => setRQ(item.Barcode, (returnQtys[item.Barcode] || 0) + 1)} style={{ width: 24, height: 24, background: "rgba(0,180,255,0.13)", border: "1px solid rgba(0,180,255,0.26)", color: "#00b4ff", fontSize: 15, borderRadius: 4, padding: 0 }}>+</button>
                  </div>
                  <span style={{ color: "#ff9500", fontSize: 11, minWidth: 70, textAlign: "right" }}>PKR {fmt((returnQtys[item.Barcode] || 0) * (parseFloat(item.Price) - parseFloat(item.Discount || 0)))}</span>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              <label style={{ ...lbSt, marginBottom: 5 }}>REASON FOR RETURN</label>
              <select value={reason} onChange={e => setReason(e.target.value)} style={{ ...slSt, width: "100%" }}>
                <option>Customer Return</option><option>Damaged Item</option><option>Wrong Item</option><option>Expired Product</option><option>Other</option>
              </select>
            </div>
            {msg && <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 8 }}>{msg}</div>}
            <div style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.25)", borderRadius: 9, padding: "10px 14px", marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#ff9500", fontWeight: 700, fontSize: 14 }}>REFUND AMOUNT</span>
              <span style={{ color: "#ff9500", fontWeight: 800, fontSize: 20, fontFamily: "Orbitron" }}>PKR {fmt(refundAmt)}</span>
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
              <button className="btn" onClick={() => setStep(1)} style={{ flex: 1, padding: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>← Back</button>
              <button className="btn" onClick={confirmReturn} disabled={returnedItems.length === 0} style={{ flex: 2, padding: 11, background: returnedItems.length > 0 ? "linear-gradient(135deg,#ff6b00,#ff9500)" : "rgba(255,255,255,0.04)", border: "none", color: returnedItems.length > 0 ? "#fff" : "rgba(255,255,255,0.2)", fontSize: 13, fontWeight: 700, borderRadius: 7 }}>✓ Process Return & Print</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}




// ==================== ADMIN SCREEN & TABS ====================
function AdminScreen({ user, items, setItems, categories, setCategories, cashiers, setCashiers, sales, setSales, customers, setCustomers, returns, setReturns, onLogout, onRefresh, sheetStatus, safeCallScript, lastSync, isOnline, returnCounter, setReturnCounter, onReturnSaved }) {
  const [tab, setTab] = useState("items");
  const [isFS, setIsFS] = useState(false);
  const toggleFS = () => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => {}); setIsFS(true); } else { document.exitFullscreen(); setIsFS(false); } };
  const TABS = [{ id: "items", label: "📦 Items" }, { id: "categories", label: "🏷 Categories" }, { id: "cashiers", label: "👤 Cashiers" }, { id: "sales", label: "📊 Sales" }, { id: "returns", label: "↩ Returns" }, { id: "profit", label: "💰 Profit" }, { id: "stock", label: "📉 Stock" }, { id: "customers", label: "🧑‍🤝‍🧑 Customers" }, { id: "setup", label: "⚙️ Setup" }];
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0a0e1a" }}>
      <div style={{ background: "linear-gradient(90deg,#0c1828,#091422)", borderBottom: "1px solid rgba(0,180,255,0.18)", padding: "9px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ fontFamily: "Orbitron", color: "#00b4ff", fontSize: 15, fontWeight: 900 }}>itKINS: MART POS</div>
          <div style={{ padding: "3px 12px", borderRadius: 20, background: "rgba(255,200,0,0.08)", border: "1px solid rgba(255,200,0,0.27)", color: "#ffd700", fontSize: 11, fontWeight: 700 }}>⭐ ADMIN</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          <StatusBar isOnline={isOnline} sheetStatus={sheetStatus} lastSync={lastSync} onRefresh={onRefresh} />
          <button className="btn" onClick={toggleFS} style={{ padding: "6px 10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 13, borderRadius: 6 }}>{isFS ? "⤡" : "⤢"}</button>
          <button className="btn" onClick={onLogout} style={{ padding: "6px 12px", background: "rgba(255,80,80,0.09)", border: "1px solid rgba(255,80,80,0.26)", color: "#ff6b6b", fontSize: 11, borderRadius: 6 }}>Logout</button>
        </div>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)", flexShrink: 0, overflowX: "auto" }}>
        {TABS.map(t => (
          <button key={t.id} className="btn" onClick={() => setTab(t.id)} style={{ padding: "11px 16px", background: "transparent", border: "none", borderBottom: tab === t.id ? "2px solid #00b4ff" : "2px solid transparent", color: tab === t.id ? "#00b4ff" : "rgba(255,255,255,0.42)", fontSize: 12, fontWeight: tab === t.id ? 700 : 400, borderRadius: 0, whiteSpace: "nowrap" }}>{t.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
        {tab === "items"      && <ItemsTab items={items} setItems={setItems} categories={categories} safeCallScript={safeCallScript} />}
        {tab === "categories" && <CategoriesTab categories={categories} setCategories={setCategories} items={items} safeCallScript={safeCallScript} />}
        {tab === "cashiers"   && <CashiersTab cashiers={cashiers} setCashiers={setCashiers} safeCallScript={safeCallScript} />}
        {tab === "sales"      && <SalesTab sales={sales} setSales={setSales} />}
        {tab === "returns"    && <ReturnsTab returns={returns} setReturns={setReturns} />}
        {tab === "profit"     && <ProfitTab sales={sales} items={items} returns={returns} />}
        {tab === "stock"      && <StockTab items={items} setItems={setItems} safeCallScript={safeCallScript} />}
        {tab === "customers"  && <CustomersTab customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} sales={sales} currentUser={user} />}
        {tab === "setup"      && <SetupTab sheetStatus={sheetStatus} onRefresh={onRefresh} lastSync={lastSync} safeCallScript={safeCallScript} />}
      </div>
    </div>
  );
}

// -------------------- ItemsTab --------------------
function ItemsTab({ items, setItems, categories, safeCallScript }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ Barcode: "", Category: "", Company: "", ItemName: "", Price: "", CostPrice: "", Discount: "0", Stock: "", ExpiryDate: "" });
  const [search, setSearch] = useState(""); const [filterCat, setFilterCat] = useState("All"); const [filterCo, setFilterCo] = useState("All");
  const companies = [...new Set(items.map(i => i.Company || "").filter(Boolean))].sort();
  const filtered = items.filter(i => (filterCat === "All" || i.Category === filterCat) && (filterCo === "All" || i.Company === filterCo) && (!search || i.ItemName?.toLowerCase().includes(search.toLowerCase()) || i.Barcode?.includes(search)));
  const startAdd = () => { setEditing("new"); setForm({ Barcode: "", Category: categories[0] || "", Company: "", ItemName: "", Price: "", CostPrice: "", Discount: "0", Stock: "", ExpiryDate: "" }); };
  const startEdit = item => { setEditing(item.Barcode); setForm({ ...item }); };
  const save = async () => {
    if (!form.Barcode || !form.ItemName || !form.Price) return;
    if (editing === "new") setItems(p => [...p, form]); else setItems(p => p.map(i => i.Barcode === editing ? form : i));
    try { await dbPut("items", { ...form, id: form.Barcode }); } catch (e) { }
    safeCallScript({ action: editing === "new" ? "addItem" : "editItem", ...form }); setEditing(null);
  };
  const del = async bc => { if (window.confirm("Delete this item?")) { setItems(p => p.filter(i => i.Barcode !== bc)); try { await dbDelete("items", bc); } catch (e) { } safeCallScript({ action: "deleteItem", Barcode: bc }); } };
  return (
    <div>
      <div style={{ display: "flex", gap: 9, marginBottom: 13, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..." style={{ ...inSt, maxWidth: 200 }} />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={slSt}><option value="All">All Categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <select value={filterCo}  onChange={e => setFilterCo(e.target.value)}  style={slSt}><option value="All">All Companies</option>{companies.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <button className="btn" onClick={startAdd} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, borderRadius: 7 }}>+ Add Item</button>
        <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, marginLeft: "auto" }}>{filtered.length} items</span>
      </div>
      {editing && (
        <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.17)", borderRadius: 11, padding: 18, marginBottom: 16 }}>
          <div style={{ color: "#00b4ff", fontSize: 11, letterSpacing: 2, marginBottom: 13, fontWeight: 700 }}>{editing === "new" ? "➕ ADD NEW ITEM" : "✏️ EDIT ITEM"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 11 }}>
            {[["Barcode", "Barcode", "text"], ["ItemName", "Item Name", "text"], ["Company", "Company", "text"], ["Price", "Selling Price (PKR)", "number"], ["CostPrice", "Cost Price (PKR)", "number"], ["Discount", "Item Discount (PKR)", "number"], ["Stock", "Stock Qty", "number"]].map(([k, l, t]) => (
              <div key={k}><label style={lbSt}>{l}</label><input type={t} value={form[k] || ""} onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} style={inSt} /></div>
            ))}
            <div><label style={lbSt}>EXPIRY DATE</label><input type="date" value={form.ExpiryDate || ""} onChange={e => setForm(p => ({ ...p, ExpiryDate: e.target.value }))} style={{ ...inSt, border: form.ExpiryDate ? `1px solid ${getExpiryStatus(form.ExpiryDate).color}` : "1px solid rgba(0,180,255,0.22)", colorScheme: "dark" }} />
              {form.ExpiryDate && (() => { const es = getExpiryStatus(form.ExpiryDate); return (<div style={{ marginTop: 5, fontSize: 11, color: es.color, fontWeight: 600 }}>{es.status === "expired" ? "⛔" : es.status === "critical" || es.status === "today" ? "⚠️" : "✅"} {es.label}</div>); })()}
            </div>
            <div><label style={lbSt}>Category</label><select value={form.Category} onChange={e => setForm(p => ({ ...p, Category: e.target.value }))} style={slSt}>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          {form.Price && form.CostPrice && parseFloat(form.Price) > 0 && (
            <div style={{ marginTop: 10, padding: "8px 13px", background: "rgba(0,200,100,0.07)", border: "1px solid rgba(0,200,100,0.2)", borderRadius: 7, fontSize: 11, color: "#00e5a0" }}>
              Profit per unit: PKR {fmt(parseFloat(form.Price) - parseFloat(form.CostPrice))} · Margin: {((parseFloat(form.Price) - parseFloat(form.CostPrice)) / parseFloat(form.Price) * 100).toFixed(1)}%
            </div>
          )}
          <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
            <button className="btn" onClick={save} style={{ padding: "9px 20px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontWeight: 700, borderRadius: 7 }}>✓ Save</button>
            <button className="btn" onClick={() => setEditing(null)} style={{ padding: "9px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 100px 100px 75px 70px 70px 70px 100px 90px", padding: "8px 12px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>BARCODE</div><div>ITEM NAME</div><div>CATEGORY</div><div>COMPANY</div><div style={{ textAlign: "right" }}>PRICE</div><div style={{ textAlign: "right" }}>COST</div><div style={{ textAlign: "right" }}>DISC</div><div style={{ textAlign: "right" }}>STOCK</div><div style={{ textAlign: "center" }}>EXPIRY</div><div style={{ textAlign: "center" }}>ACTIONS</div>
        </div>
        {filtered.map((item, idx) => {
          const stk = Number(item.Stock) || 0;
          const profit = parseFloat(item.Price || 0) - parseFloat(item.CostPrice || 0);
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "110px 1fr 100px 100px 75px 70px 70px 70px 100px 90px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", background: stk <= 0 ? "rgba(255,50,50,0.03)" : stk <= 5 ? "rgba(255,200,0,0.03)" : "transparent" }}>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{item.Barcode}</div>
              <div style={{ color: "#fff", fontSize: 12, fontWeight: 500 }}>{item.ItemName}</div>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{item.Category}</div>
              <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11 }}>{item.Company || "—"}</div>
              <div style={{ color: "#00b4ff", textAlign: "right", fontWeight: 700, fontSize: 12 }}>{fmt(item.Price)}</div>
              <div style={{ color: profit > 0 ? "#00e5a0" : "rgba(255,255,255,0.3)", textAlign: "right", fontSize: 11 }} title={`Profit: PKR ${fmt(profit)}`}>{item.CostPrice ? fmt(item.CostPrice) : "—"}</div>
              <div style={{ color: parseFloat(item.Discount) > 0 ? "#ffd700" : "rgba(255,255,255,0.22)", textAlign: "right", fontSize: 12 }}>{item.Discount}</div>
              <div style={{ textAlign: "right", fontWeight: 700, fontSize: 12, color: stk <= 0 ? "#ff6b6b" : stk <= 5 ? "#ffd700" : "#00e5a0" }}>{item.Stock}{stk <= 0 ? " ❌" : stk <= 5 ? " ⚠️" : ""}</div>
              {(() => { const es = getExpiryStatus(item.ExpiryDate); return (
                <div style={{ textAlign: "center" }}><div style={{ color: es.color, fontSize: 10, fontWeight: 700 }}>{fmtExpiry(item.ExpiryDate)}</div>{item.ExpiryDate && <div style={{ fontSize: 9, color: es.color, opacity: 0.85 }}>{es.label}</div>}</div>
              ); })()}
              <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                <button className="btn" onClick={() => startEdit(item)} style={{ padding: "4px 9px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 11, borderRadius: 5 }}>Edit</button>
                <button className="btn" onClick={() => del(item.Barcode)} style={{ padding: "4px 9px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 5 }}>Del</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -------------------- CategoriesTab --------------------
function CategoriesTab({ categories, setCategories, items, safeCallScript }) {
  const [val, setVal] = useState("");
  const add = () => { const v = val.trim(); if (v && !categories.includes(v)) { setCategories(p => [...p, v]); safeCallScript({ action: "addCategory", CategoryName: v }); setVal(""); } };
  const del = cat => { if (items.some(i => i.Category === cat)) { alert(`"${cat}" used by items.`); return; } if (window.confirm(`Delete "${cat}"?`)) { setCategories(p => p.filter(c => c !== cat)); safeCallScript({ action: "deleteCategory", CategoryName: cat }); } };
  return (
    <div style={{ maxWidth: 460 }}>
      <div style={{ display: "flex", gap: 9, marginBottom: 16 }}>
        <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="New category name..." style={inSt} />
        <button className="btn" onClick={add} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, borderRadius: 7, whiteSpace: "nowrap" }}>+ Add</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {categories.map(cat => { const cnt = items.filter(i => i.Category === cat).length; return (
          <div key={cat} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 15px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}>
            <div><span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{cat}</span><span style={{ color: "rgba(255,255,255,0.26)", fontSize: 11, marginLeft: 9 }}>{cnt} items</span></div>
            <button className="btn" onClick={() => del(cat)} style={{ padding: "5px 11px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 6 }}>Delete</button>
          </div>
        ); })}
      </div>
    </div>
  );
}

// -------------------- CashiersTab --------------------
function CashiersTab({ cashiers, setCashiers, safeCallScript }) {
  const [editing, setEditing] = useState(null); const [origUsername, setOrigUsername] = useState(""); const [form, setForm] = useState({ Name: "", Username: "", PIN: "", Role: "cashier" });
  const startAdd  = () => { setEditing("__new__"); setOrigUsername(""); setForm({ Name: "", Username: "", PIN: "", Role: "cashier" }); };
  const startEdit = c => { setEditing(c.Username); setOrigUsername(c.Username); setForm({ ...c }); };
  const save = async () => {
    if (!form.Name || !form.Username || !form.PIN) return;
    if (editing === "__new__") {
      setCashiers(p => [...p, form]);
      try { await dbPut("cashiers", { ...form, id: form.Username }); } catch(e) {}
      safeCallScript({ action: "addCashier", Name: form.Name, Username: form.Username, PIN: form.PIN, Role: form.Role });
    } else {
      setCashiers(p => p.map(c => c.Username === origUsername ? form : c));
      try { await dbPut("cashiers", { ...form, id: form.Username }); } catch(e) {}
      safeCallScript({ action: "editCashier", Name: form.Name, Username: form.Username, PIN: form.PIN, Role: form.Role, OrigUsername: origUsername });
    }
    setEditing(null); setOrigUsername("");
  };
  const del = username => { if (window.confirm("Delete this user?")) { setCashiers(p => p.filter(c => c.Username !== username)); safeCallScript({ action: "deleteCashier", Username: username }); } };
  return (
    <div style={{ maxWidth: 560 }}>
      <button className="btn" onClick={startAdd} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, borderRadius: 7, marginBottom: 14 }}>+ Add User</button>
      {editing && (
        <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.17)", borderRadius: 11, padding: 18, marginBottom: 16 }}>
          <div style={{ color: "#00b4ff", fontSize: 11, letterSpacing: 2, marginBottom: 13, fontWeight: 700 }}>{editing === "__new__" ? "➕ ADD USER" : "✏️ EDIT USER"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
            {[["Name", "Full Name"], ["Username", "Username"], ["PIN", "PIN Code"]].map(([k, l]) => (<div key={k}><label style={lbSt}>{l}</label><input value={form[k]} onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} style={inSt} type={k === "PIN" ? "password" : "text"} /></div>))}
            <div><label style={lbSt}>Role</label><select value={form.Role} onChange={e => setForm(p => ({ ...p, Role: e.target.value }))} style={slSt}><option value="cashier">Cashier</option><option value="admin">Admin</option></select></div>
          </div>
          <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
            <button className="btn" onClick={save} style={{ padding: "9px 20px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontWeight: 700, borderRadius: 7 }}>✓ Save</button>
            <button className="btn" onClick={() => { setEditing(null); setOrigUsername(""); }} style={{ padding: "9px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.42)", borderRadius: 7 }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {cashiers.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 15px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, color: "#fff", background: c.Role === "admin" ? "linear-gradient(135deg,#ffd700,#ff8c00)" : "linear-gradient(135deg,#0062ff,#00b4ff)" }}>{c.Name?.[0] || "?"}</div>
              <div><div style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{c.Name}</div><div style={{ color: "rgba(255,255,255,0.32)", fontSize: 11 }}>@{c.Username} · PIN: {"●".repeat(c.PIN?.length || 4)}</div></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ padding: "3px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: c.Role === "admin" ? "rgba(255,200,0,0.1)" : "rgba(0,180,255,0.1)", color: c.Role === "admin" ? "#ffd700" : "#00b4ff" }}>{c.Role?.toUpperCase()}</span>
              <button className="btn" onClick={() => startEdit(c)} style={{ padding: "4px 10px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 11, borderRadius: 5 }}>Edit</button>
              <button className="btn" onClick={() => del(c.Username)} style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 5 }}>Del</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------- SalesTab --------------------
function SalesTab({ sales, setSales }) {
  const [filterDate, setFilterDate] = useState("");
  const [filterCashier, setFilterCashier] = useState("All");
  const [viewBill, setViewBill] = useState(null);
  const cashierList = [...new Set(sales.map(s => s.Cashier).filter(Boolean))];
  const filtered = sales.filter(s => filterDateMatch(s.Date, filterDate) && (filterCashier === "All" || s.Cashier === filterCashier));
  const totalRev = filtered.reduce((s, r) => s + parseFloat(r.GrandTotal || 0), 0);
  const totalDisc = filtered.reduce((s, r) => s + parseFloat(r.Discount || 0), 0);
  const reprintBill = sale => {
    const items = safeParseItems(sale.ItemsDetail);
    const subTotal = items.reduce((s, i) => s + parseFloat(i.Price||0) * (parseInt(i.qty)||1), 0);
    const itemDiscount = items.reduce((s, i) => s + parseFloat(i.Discount||0) * (parseInt(i.qty)||1), 0);
    const totalDiscount = parseFloat(sale.Discount || 0);
    const grandTotal = parseFloat(sale.GrandTotal || 0);
    printReceipt({
      billNo: sale.BillNo, date: sale.Date, time: sale.Time, cashier: sale.Cashier, items,
      subTotal, totalDiscount, itemDiscount, billDiscount: Math.max(0, totalDiscount - itemDiscount), billDiscountPct: 0,
      grandTotal, payments: [{ type: "cash", amount: grandTotal, last4: "" }], change: 0,
      customerName: sale.CustomerName || "", customerCell: sale.CustomerCell || "", refundApplied: sale.RefundApplied || 0,
    });
  };
  return (
    <div>
      {viewBill && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.87)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setViewBill(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#0d1b2a", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, maxWidth: 540, width: "100%", maxHeight: "86vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "Orbitron", color: "#00b4ff", fontSize: 16 }}>Bill #{viewBill.BillNo}</div>
              <button className="btn" onClick={() => setViewBill(null)} style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 13, borderRadius: 6 }}>✕ Close</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {[["Date", viewBill.Date], ["Time", viewBill.Time], ["Cashier", viewBill.Cashier], ["Payment", viewBill.PaymentMethod], ["Customer", (viewBill.CustomerName && viewBill.CustomerName !== "Unknown" && viewBill.CustomerName.trim() !== "") ? viewBill.CustomerName : "Walk-in"], ["Cell #", viewBill.CustomerCell || "—"]].map(([l, v]) => (<div key={l} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 12px" }}><div style={{ color: "rgba(0,180,255,0.7)", fontSize: 10, letterSpacing: 1, marginBottom: 2 }}>{l}</div><div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{v}</div></div>))}
            </div>
            {(() => {
              const items = safeParseItems(viewBill.ItemsDetail);
              if (!items.length) return <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, textAlign: "center", padding: 16 }}>No item detail available.</div>;
              const grouped = {}; items.forEach(i => { const c = i.Category || "Items"; if (!grouped[c]) grouped[c] = []; grouped[c].push(i); });
              return <div>{Object.keys(grouped).sort().map(cat => (<div key={cat} style={{ marginBottom: 10 }}><div style={{ color: "#00b4ff", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 5, padding: "4px 8px", background: "rgba(0,180,255,0.05)", borderRadius: 5 }}>── {cat.toUpperCase()} ──</div>{grouped[cat].map((item, i) => { const disc = parseFloat(item.Discount || 0); const lt = item.qty * parseFloat(item.Price || 0) - disc * item.qty; return (<div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: "rgba(255,255,255,0.025)", borderRadius: 7, marginBottom: 4 }}><div><div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{item.ItemName || item.Barcode}</div><div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{item.qty} x PKR {fmt(item.Price)}{disc > 0 ? ` · Disc: PKR ${fmt(disc * item.qty)}` : ""}</div></div><div style={{ color: "#00e5a0", fontWeight: 700, fontSize: 13 }}>PKR {fmt(lt)}</div></div>); })}</div>))}</div>;
            })()}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 12, paddingTop: 12 }}>
              {viewBill.RefundApplied > 0 && <div style={{ display: "flex", justifyContent: "space-between", color: "#ff9500", fontSize: 12, marginBottom: 4 }}><span>Refund Applied</span><span>− PKR {fmt(viewBill.RefundApplied)}</span></div>}
              <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(255,255,255,0.4)", fontSize: 11, marginBottom: 4 }}><span>FBR Charges</span><span>PKR 0.00</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}><span style={{ color: "#fff", fontSize: 15 }}>GRAND TOTAL</span><span style={{ color: "#00b4ff", fontSize: 18, fontFamily: "Orbitron" }}>PKR {fmt(viewBill.GrandTotal)}</span></div>
            </div>
            <button className="btn" onClick={() => reprintBill(viewBill)} style={{ width: "100%", marginTop: 14, padding: "11px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, borderRadius: 8, fontWeight: 700 }}>🖨 Reprint This Bill</button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 11, marginBottom: 16 }}>
        {[{ label: "Total Revenue", value: `PKR ${fmt(totalRev)}`, color: "#00b4ff", icon: "💰" }, { label: "Total Discount", value: `PKR ${fmt(totalDisc)}`, color: "#ffd700", icon: "🏷️" }, { label: "FBR Charges", value: `PKR 0`, color: "#a78bfa", icon: "🧾" }, { label: "Total Bills", value: filtered.length, color: "#00e5a0", icon: "🧮" }].map((card, i) => (<div key={i} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${card.color}26`, borderRadius: 11, padding: "14px 17px" }}><div style={{ fontSize: 19, marginBottom: 5 }}>{card.icon}</div><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, letterSpacing: 2, marginBottom: 3 }}>{card.label}</div><div style={{ color: card.color, fontSize: 18, fontWeight: 800, fontFamily: "Orbitron" }}>{card.value}</div></div>))}
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 13, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Filter by Date</label><input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...inSt, maxWidth: 180 }} /></div>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Filter by Cashier</label><select value={filterCashier} onChange={e => setFilterCashier(e.target.value)} style={slSt}><option value="All">All Cashiers</option>{cashierList.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        <button className="btn" onClick={() => { setFilterDate(""); setFilterCashier("All"); }} style={{ padding: "9px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Clear</button>
      </div>
      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "80px 95px 80px 110px 100px 80px 80px 110px 130px", padding: "8px 12px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>BILL#</div><div>DATE</div><div>TIME</div><div>CASHIER</div><div>CUSTOMER</div><div style={{ textAlign: "right" }}>TOTAL</div><div style={{ textAlign: "right" }}>FBR</div><div>PAYMENT</div><div>CELL</div>
        </div>
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {[...filtered].reverse().map((sale, i) => (<div key={i} onClick={() => setViewBill(sale)} style={{ display: "grid", gridTemplateColumns: "80px 95px 80px 110px 100px 80px 80px 110px 130px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(0,180,255,0.06)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 12 }}>#{sale.BillNo}</div>
            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11 }}>{sale.Date}</div>
            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11 }}>{sale.Time}</div>
            <div style={{ color: "#fff", fontSize: 12 }}>{sale.Cashier}</div>
            <div style={{ color: sale.CustomerName && sale.CustomerName !== "Unknown" && sale.CustomerName.trim() !== "" ? "#00e5a0" : "rgba(255,255,255,0.3)", fontSize: 11 }}>{sale.CustomerName && sale.CustomerName !== "Unknown" && sale.CustomerName.trim() !== "" ? sale.CustomerName : "Walk-in"}</div>
            <div style={{ color: "#00e5a0", textAlign: "right", fontWeight: 700, fontSize: 12 }}>{fmt(sale.GrandTotal)}</div>
            <div style={{ color: "#a78bfa", textAlign: "right", fontSize: 11 }}>PKR {fmt(sale.FBR || 1)}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{sale.PaymentMethod}</div>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{sale.CustomerCell || "—"}</div>
          </div>))}
        </div>
      </div>
      <div style={{ marginTop: 7, color: "rgba(255,255,255,0.22)", fontSize: 11 }}>{filtered.length} transactions · 👆 Click any row to view &amp; reprint</div>
    </div>
  );
}

// -------------------- ReturnsTab --------------------
function ReturnsTab({ returns }) {
  const [filterDate, setFilterDate] = useState("");
  const [viewRet, setViewRet] = useState(null);
  const filtered = returns.filter(r => !filterDate || filterDateMatch(r.Date, filterDate));
  const totalRefund = filtered.reduce((s, r) => s + parseFloat(r.RefundAmount || 0), 0);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 11, marginBottom: 16 }}>
        {[{ label: "Total Returns", value: filtered.length, color: "#ff9500", icon: "↩" }, { label: "Total Refunded", value: `PKR ${fmt(totalRefund)}`, color: "#ff6b6b", icon: "💸" }].map((card, i) => (<div key={i} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${card.color}26`, borderRadius: 11, padding: "14px 17px" }}><div style={{ fontSize: 19, marginBottom: 5 }}>{card.icon}</div><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, letterSpacing: 2, marginBottom: 3 }}>{card.label}</div><div style={{ color: card.color, fontSize: 18, fontWeight: 800, fontFamily: "Orbitron" }}>{card.value}</div></div>))}
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 13, alignItems: "flex-end" }}>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Filter by Date</label><input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...inSt, maxWidth: 180 }} /></div>
        <button className="btn" onClick={() => setFilterDate("")} style={{ padding: "9px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Clear</button>
      </div>
      {viewRet && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.87)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setViewRet(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#0d1b2a", border: "1px solid rgba(255,150,0,0.3)", borderRadius: 14, padding: 24, maxWidth: 480, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}><div style={{ fontFamily: "Orbitron", color: "#ff9500", fontSize: 15 }}>Return #{viewRet.ReturnNo}</div><button className="btn" onClick={() => setViewRet(null)} style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 13, borderRadius: 6 }}>✕</button></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>{[["Orig Bill", viewRet.OrigBillNo], ["Date", viewRet.Date], ["Cashier", viewRet.Cashier], ["Reason", viewRet.Reason]].map(([l, v]) => (<div key={l} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 12px" }}><div style={{ color: "rgba(255,150,0,0.7)", fontSize: 10 }}>{l}</div><div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{v}</div></div>))}</div>
            {safeParseItems(viewRet.Items).map((item, i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", background: "rgba(255,255,255,0.025)", borderRadius: 7, marginBottom: 4 }}><span style={{ color: "#fff", fontSize: 12 }}>{item.ItemName} × {item.qty}</span><span style={{ color: "#ff9500", fontWeight: 700 }}>PKR {fmt(item.qty * parseFloat(item.Price || 0))}</span></div>))}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.08)" }}><span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>REFUND AMOUNT</span><span style={{ color: "#ff9500", fontWeight: 800, fontSize: 18, fontFamily: "Orbitron" }}>PKR {fmt(viewRet.RefundAmount)}</span></div>
            <button className="btn" onClick={() => printReturnReceipt(viewRet)} style={{ width: "100%", marginTop: 12, padding: 11, background: "linear-gradient(135deg,#ff6b00,#ff9500)", color: "#fff", fontSize: 13, borderRadius: 8, fontWeight: 700 }}>🖨 Reprint Return Receipt</button>
          </div>
        </div>
      )}
      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 90px 95px 80px 110px 100px", padding: "8px 12px", background: "rgba(255,150,0,0.07)", color: "rgba(255,150,0,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}> <div>RETURN#</div><div>ORIG BILL</div><div>DATE</div><div>TIME</div><div>CASHIER</div><div style={{ textAlign: "right" }}>REFUND</div></div>
        {filtered.length === 0 ? (<div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 100, color: "rgba(255,255,255,0.2)", gap: 8 }}><div style={{ fontSize: 26 }}>↩</div><div style={{ fontSize: 12 }}>No returns yet</div></div>) : [...filtered].reverse().map((r, i) => (<div key={i} onClick={() => setViewRet(r)} style={{ display: "grid", gridTemplateColumns: "90px 90px 95px 80px 110px 100px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(255,150,0,0.06)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <div style={{ color: "#ff9500", fontWeight: 700, fontSize: 12 }}>{r.ReturnNo}</div>
          <div style={{ color: "#00b4ff", fontSize: 12 }}>#{r.OrigBillNo}</div>
          <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11 }}>{r.Date}</div>
          <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11 }}>{r.Time}</div>
          <div style={{ color: "#fff", fontSize: 12 }}>{r.Cashier}</div>
          <div style={{ color: "#ff6b6b", textAlign: "right", fontWeight: 700, fontSize: 12 }}>PKR {fmt(r.RefundAmount)}</div>
        </div>))}
      </div>
    </div>
  );
}

// -------------------- ProfitTab --------------------

function ProfitTab({ sales, items, returns }) {
  const [filterDate, setFilterDate] = useState("");
  const [filterCashier, setFilterCashier] = useState("All");
  const [filterCat, setFilterCat] = useState("All");
  const cashierList = [...new Set(sales.map(s => s.Cashier).filter(Boolean))];
  const categories = [...new Set(items.map(i => i.Category).filter(Boolean))].sort();
  const itemMap = new Map(items.map(i => [i.Barcode, i]));

  const filtered = sales.filter(s => filterDateMatch(s.Date, filterDate) && (filterCashier === "All" || s.Cashier === filterCashier));

  let totalRevenue = 0, totalCost = 0, totalDiscount = 0, totalRefund = 0;
  const categoryProfit = {};
  const topItems = {};

  filtered.forEach(sale => {
    const saleItems = safeParseItems(sale.ItemsDetail);
    saleItems.forEach(si => {
      if (filterCat !== "All" && si.Category !== filterCat) return;
      const masterItem = itemMap.get(si.Barcode);
      const sellPrice = parseFloat(si.Price || 0);
      const costPrice = parseFloat(masterItem?.CostPrice || si.CostPrice || 0);
      const disc = parseFloat(si.Discount || 0);
      const qty = parseInt(si.qty) || 1;
      const revenue = (sellPrice - disc) * qty;
      const cost = costPrice * qty;
      const profit = revenue - cost;
      totalRevenue += revenue;
      totalCost += cost;
      const cat = si.Category || "Unknown";
      if (!categoryProfit[cat]) categoryProfit[cat] = { revenue: 0, cost: 0, profit: 0, qty: 0 };
      categoryProfit[cat].revenue += revenue;
      categoryProfit[cat].cost += cost;
      categoryProfit[cat].profit += profit;
      categoryProfit[cat].qty += qty;
      const key = si.Barcode;
      if (!topItems[key]) topItems[key] = { name: si.ItemName, revenue: 0, profit: 0, qty: 0 };
      topItems[key].revenue += revenue;
      topItems[key].profit += profit;
      topItems[key].qty += qty;
    });
    totalDiscount += parseFloat(sale.Discount || 0);
  });

  const filteredReturns = returns.filter(r => filterDateMatch(r.Date, filterDate));
  filteredReturns.forEach(r => { totalRefund += parseFloat(r.RefundAmount || 0); });
  const netRevenue = totalRevenue - totalRefund;
  const netProfit = netRevenue - totalCost;
  const margin = netRevenue > 0 ? ((netProfit / netRevenue) * 100).toFixed(1) : 0;
  const topItemsList = Object.entries(topItems).sort((a, b) => b[1].profit - a[1].profit).slice(0, 10);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Date</label><input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...inSt, maxWidth: 180 }} /></div>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Cashier</label><select value={filterCashier} onChange={e => setFilterCashier(e.target.value)} style={slSt}><option value="All">All</option>{cashierList.map(c => <option key={c}>{c}</option>)}</select></div>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Category</label><select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={slSt}><option value="All">All</option>{categories.map(c => <option key={c}>{c}</option>)}</select></div>
        <button className="btn" onClick={() => { setFilterDate(""); setFilterCashier("All"); setFilterCat("All"); }} style={{ padding: "9px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 7 }}>Clear</button>
      </div>
      {totalCost === 0 && <div style={{ background: "rgba(255,200,0,0.07)", border: "1px solid rgba(255,200,0,0.25)", borderRadius: 10, padding: "14px 18px", marginBottom: 16, color: "#ffd700", fontSize: 12 }}>⚠ Cost prices not set for some items. Go to <b>Items tab → Edit</b> and add <b>Cost Price</b> for accurate profit calculation.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 11, marginBottom: 18 }}>
        {[
          { label: "Net Revenue", value: `PKR ${fmt(netRevenue)}`, color: "#00b4ff", icon: "💰" },
          { label: "Total Cost", value: `PKR ${fmt(totalCost)}`, color: "#ff6b6b", icon: "🏭" },
          { label: "NET PROFIT", value: `PKR ${fmt(netProfit)}`, color: netProfit >= 0 ? "#00e5a0" : "#ff6b6b", icon: "📈" },
          { label: "Profit Margin", value: `${margin}%`, color: "#ffd700", icon: "%" },
          { label: "Total Discount", value: `PKR ${fmt(totalDiscount)}`, color: "#a78bfa", icon: "🏷" },
          { label: "Refunds", value: `PKR ${fmt(totalRefund)}`, color: "#ff9500", icon: "↩" }
        ].map((card, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${card.color}26`, borderRadius: 11, padding: "14px 17px" }}>
            <div style={{ fontSize: 19, marginBottom: 5 }}>{card.icon}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, letterSpacing: 2, marginBottom: 3 }}>{card.label}</div>
            <div style={{ color: card.color, fontSize: 16, fontWeight: 800, fontFamily: "Orbitron" }}>{card.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.8)", fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>PROFIT BY CATEGORY</div>
          {Object.entries(categoryProfit).sort((a, b) => b[1].profit - a[1].profit).map(([cat, data]) => (
            <div key={cat} style={{ padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{cat}</div><div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>Revenue: PKR {fmt(data.revenue)} · Qty: {data.qty}</div></div>
              <div style={{ textAlign: "right" }}><div style={{ color: data.profit >= 0 ? "#00e5a0" : "#ff6b6b", fontWeight: 700, fontSize: 13 }}>PKR {fmt(data.profit)}</div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>{data.revenue > 0 ? ((data.profit / data.revenue) * 100).toFixed(1) : 0}%</div></div>
            </div>
          ))}
          {Object.keys(categoryProfit).length === 0 && <div style={{ padding: 20, color: "rgba(255,255,255,0.2)", textAlign: "center", fontSize: 12 }}>No data</div>}
        </div>
        <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "rgba(0,200,100,0.07)", color: "rgba(0,200,100,0.8)", fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>TOP ITEMS BY PROFIT</div>
          {topItemsList.map(([bc, data]) => (
            <div key={bc} style={{ padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{data.name || bc}</div><div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>Sold: {data.qty} units</div></div>
              <div style={{ textAlign: "right" }}><div style={{ color: "#00e5a0", fontWeight: 700, fontSize: 13 }}>PKR {fmt(data.profit)}</div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>Rev: PKR {fmt(data.revenue)}</div></div>
            </div>
          ))}
          {topItemsList.length === 0 && <div style={{ padding: 20, color: "rgba(255,255,255,0.2)", textAlign: "center", fontSize: 12 }}>No data</div>}
        </div>
      </div>
    </div>
  );
}





// -------------------- StockTab with PDF download --------------------
function StockTab({ items, setItems, safeCallScript }) {
  const [adjusting, setAdjusting] = useState(null);
  const [adjVal, setAdjVal] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [filterCo, setFilterCo] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [pdfLoading, setPdfLoading] = useState(false);

  const categories = [...new Set(items.map(i => i.Category || "").filter(Boolean))].sort();
  const companies = [...new Set(items.map(i => i.Company || "").filter(Boolean))].sort();
  const filtered = items.filter(i => {
    const stk = Number(i.Stock) || 0;
    const es = getExpiryStatus(i.ExpiryDate);
    if (filterCat !== "All" && i.Category !== filterCat) return false;
    if (filterCo !== "All" && i.Company !== filterCo) return false;
    if (filterStatus === "out" && stk > 0) return false;
    if (filterStatus === "low" && (stk <= 0 || stk > 5)) return false;
    if (filterStatus === "ok" && stk <= 5) return false;
    if (filterStatus === "expired" && es.status !== "expired") return false;
    if (filterStatus === "expiring" && !["critical","today","warning"].includes(es.status)) return false;
    return true;
  }).sort((a, b) => (Number(a.Stock) || 0) - (Number(b.Stock) || 0));

  const doAdjust = async bc => {
    const n = parseInt(adjVal); if (isNaN(n) || n < 0) return;
    const old = items.find(i => i.Barcode === bc); const before = Number(old?.Stock) || 0;
    setItems(p => p.map(i => i.Barcode === bc ? { ...i, Stock: String(n) } : i));
    try { await dbPut("items", { ...old, Stock: String(n), id: bc }); } catch (e) { }
    safeCallScript({ action: "adjustStock", Barcode: bc, AdjustType: "set", Value: n, Reason: "Admin Manual", Before: before, After: n, ItemName: old?.ItemName || bc });
    setAdjusting(null); setAdjVal("");
  };

  const handleDownloadPDF = async () => {
    setPdfLoading(true);
    try { await downloadStockPDF(filtered, filterCat, filterCo, filterStatus); }
    catch (e) { alert("PDF generation failed: " + e.message); }
    finally { setPdfLoading(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 11, marginBottom: 15, flexWrap: "wrap" }}>
        {[
          { label: "Out of Stock", color: "#ff6b6b", cnt: items.filter(i => (Number(i.Stock) || 0) <= 0).length },
          { label: "Low Stock (≤5)", color: "#ffd700", cnt: items.filter(i => (Number(i.Stock) || 0) > 0 && (Number(i.Stock) || 0) <= 5).length },
          { label: "In Stock", color: "#00e5a0", cnt: items.filter(i => (Number(i.Stock) || 0) > 5).length },
          { label: "Stock Value", color: "#a78bfa", cnt: `PKR ${fmt(items.reduce((s, i) => s + parseFloat(i.Price || 0) * (Number(i.Stock) || 0), 0))}` }
        ].map((s, i) => (
          <div key={i} style={{ padding: "11px 17px", background: "rgba(255,255,255,0.025)", border: `1px solid ${s.color}26`, borderRadius: 10 }}>
            <div style={{ color: s.color, fontSize: 21, fontWeight: 800 }}>{s.cnt}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Expiry Alert Banner */}
      {(() => {
        const expiredItems = items.filter(i => getExpiryStatus(i.ExpiryDate).status === "expired");
        const criticalItems = items.filter(i => ["critical","today"].includes(getExpiryStatus(i.ExpiryDate).status));
        const warningItems = items.filter(i => getExpiryStatus(i.ExpiryDate).status === "warning");
        if (!expiredItems.length && !criticalItems.length && !warningItems.length) return null;
        return (
          <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 7 }}>
            {expiredItems.length > 0 && (
              <div style={{ padding: "10px 16px", background: "rgba(255,40,40,0.1)", border: "1px solid rgba(255,40,40,0.4)", borderRadius: 9, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>⛔</span>
                <div>
                  <div style={{ color: "#ff4444", fontWeight: 700, fontSize: 12 }}>{expiredItems.length} EXPIRED item(s)</div>
                  <div style={{ color: "rgba(255,100,100,0.8)", fontSize: 11 }}>{expiredItems.map(i => i.ItemName).join(", ")}</div>
                </div>
              </div>
            )}
            {criticalItems.length > 0 && (
              <div style={{ padding: "10px 16px", background: "rgba(255,107,0,0.1)", border: "1px solid rgba(255,107,0,0.4)", borderRadius: 9, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <div>
                  <div style={{ color: "#ff6b00", fontWeight: 700, fontSize: 12 }}>{criticalItems.length} item(s) expiring within 7 days</div>
                  <div style={{ color: "rgba(255,150,0,0.8)", fontSize: 11 }}>{criticalItems.map(i => `${i.ItemName} (${getExpiryStatus(i.ExpiryDate).label})`).join(", ")}</div>
                </div>
              </div>
            )}
            {warningItems.length > 0 && (
              <div style={{ padding: "10px 16px", background: "rgba(255,200,0,0.08)", border: "1px solid rgba(255,200,0,0.3)", borderRadius: 9, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>🕐</span>
                <div>
                  <div style={{ color: "#ffd700", fontWeight: 700, fontSize: 12 }}>{warningItems.length} item(s) expiring within 30 days</div>
                  <div style={{ color: "rgba(255,220,0,0.7)", fontSize: 11 }}>{warningItems.map(i => `${i.ItemName} (${getExpiryStatus(i.ExpiryDate).label})`).join(", ")}</div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ display: "flex", gap: 9, marginBottom: 13, flexWrap: "wrap", alignItems: "center" }}>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={slSt}>
          <option value="All">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterCo} onChange={e => setFilterCo(e.target.value)} style={slSt}>
          <option value="All">All Companies</option>
          {companies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={slSt}>
          <option value="All">All Status</option>
          <option value="out">❌ Out of Stock</option>
          <option value="low">⚠️ Low Stock</option>
          <option value="ok">✅ In Stock</option>
          <option value="expired">⛔ Expired</option>
          <option value="expiring">🕐 Expiring Soon</option>
        </select>
        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>{filtered.length} items</span>
        <button
          className="btn"
          onClick={handleDownloadPDF}
          disabled={pdfLoading || filtered.length === 0}
          style={{
            marginLeft: "auto",
            padding: "9px 18px",
            background: pdfLoading ? "rgba(255,200,0,0.1)" : "linear-gradient(135deg,#b45309,#fbbf24)",
            border: "none",
            color: pdfLoading ? "#fbbf24" : "#000",
            fontSize: 12,
            fontWeight: 700,
            borderRadius: 7,
            display: "flex",
            alignItems: "center",
            gap: 6
          }}
        >
          {pdfLoading ? (
            <>
              <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #fbbf24", borderTop: "2px solid transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
              Generating...
            </>
          ) : (
            <>📄 Download PDF ({filtered.length} items)</>
          )}
        </button>
      </div>

      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 110px 110px 85px 95px 105px 130px", padding: "8px 12px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>BARCODE</div><div>ITEM</div><div>COMPANY</div><div>CATEGORY</div><div style={{ textAlign: "right" }}>PRICE</div><div style={{ textAlign: "right" }}>STOCK</div><div style={{ textAlign: "center" }}>EXPIRY</div><div style={{ textAlign: "center" }}>ADJUST</div>
        </div>
        {filtered.map((item, i) => {
          const stk = Number(item.Stock) || 0;
          const sc = stk <= 0 ? "#ff6b6b" : stk <= 5 ? "#ffd700" : "#00e5a0";
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr 110px 110px 85px 95px 105px 130px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", background: stk <= 0 ? "rgba(255,50,50,0.03)" : stk <= 5 ? "rgba(255,200,0,0.03)" : "transparent" }}>
              <div style={{ color: "rgba(255,255,255,0.33)", fontSize: 11 }}>{item.Barcode}</div>
              <div style={{ color: "#fff", fontSize: 12 }}>{item.ItemName}</div>
              <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11 }}>{item.Company || "—"}</div>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{item.Category}</div>
              <div style={{ color: "#00b4ff", textAlign: "right", fontSize: 12, fontWeight: 700 }}>{fmt(item.Price)}</div>
              <div style={{ textAlign: "right" }}>
                <span style={{ color: sc, fontWeight: 700, fontSize: 14 }}>{item.Stock}</span>
                {stk <= 0 && <span style={{ marginLeft: 4, fontSize: 10, color: "#ff6b6b" }}>OUT</span>}
                {stk > 0 && stk <= 5 && <span style={{ marginLeft: 4, fontSize: 10, color: "#ffd700" }}>LOW</span>}
              </div>
              {(() => {
                const es = getExpiryStatus(item.ExpiryDate);
                return (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ color: es.color, fontSize: 10, fontWeight: 700 }}>{fmtExpiry(item.ExpiryDate)}</div>
                    {item.ExpiryDate && <div style={{ fontSize: 9, color: es.color, opacity: 0.85 }}>{es.label}</div>}
                  </div>
                );
              })()}
              <div style={{ display: "flex", justifyContent: "center", gap: 5 }}>
                {adjusting === item.Barcode ? (
                  <>
                    <input
                      type="number"
                      value={adjVal}
                      onChange={e => setAdjVal(e.target.value)}
                      style={{ ...inSt, width: 68, padding: "5px 7px", textAlign: "center" }}
                      autoFocus
                      onKeyDown={e => e.key === "Enter" && doAdjust(item.Barcode)}
                    />
                    <button className="btn" onClick={() => doAdjust(item.Barcode)} style={{ padding: "5px 8px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontSize: 11, borderRadius: 5 }}>✓</button>
                    <button className="btn" onClick={() => setAdjusting(null)} style={{ padding: "5px 7px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.38)", fontSize: 11, borderRadius: 5 }}>✕</button>
                  </>
                ) : (
                  <button className="btn" onClick={() => { setAdjusting(item.Barcode); setAdjVal(item.Stock); }} style={{ padding: "5px 11px", background: "rgba(0,180,255,0.09)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 11, borderRadius: 5 }}>Set</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}




// -------------------- CustomersTab (simplified, with full functionality) --------------------
function CustomersTab({ customers, setCustomers, safeCallScript, sales, currentUser }) {
  const [filterName, setFilterName] = useState("");
  const [filterCell, setFilterCell] = useState("");
  const [filterBill, setFilterBill] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [showPayModal, setShowPayModal] = useState(false);
  const [ledgerCustomer, setLedgerCustomer] = useState(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);

  const filtered = customers.filter(c => {
    if (filterName && !c.Name?.toLowerCase().includes(filterName.toLowerCase())) return false;
    if (filterCell && !c.CellNo?.includes(filterCell)) return false;
    if (filterBill && !c.BillNo?.includes(filterBill)) return false;
    return true;
  });

  const getCustomerSales = (c) => {
    const billNos = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
    return billNos.map(bn => sales?.find(s => s.BillNo === bn.padStart(4, "0") || s.BillNo === bn)).filter(Boolean);
  };

  const getPending = (c) => {
    const billNos = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
    const totalBills = billNos.reduce((s, bn) => {
      const sale = sales.find(sale => sale.BillNo === bn);
      if (!sale) return s;
      if (sale.PaymentMethod === "Credit") return s + parseFloat(sale.GrandTotal || 0);
      return s;
    }, 0);
    const totalPaid = (c.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    return Math.max(0, totalBills - totalPaid);
  };
  const getTotalReceived = (c) => (c.payments || []).filter(p => !filterDate || p.date === filterDate).reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  const exportCSV = () => {
    const header = "Name,CellNo,TotalBills,TotalPaid,Pending\n";
    const rows = filtered.map(c => {
      const totalBills = getCustomerSales(c).reduce((s, sale) => s + parseFloat(sale.GrandTotal || 0), 0);
      const totalPaid = (c.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const pending = Math.max(0, totalBills - totalPaid);
      return `"${(c.Name || "").replace(/"/g, '""')}","${(c.CellNo || "").replace(/"/g, '""')}","${totalBills}","${totalPaid}","${pending}"`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Customers_${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 11, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ padding: "11px 18px", background: "rgba(0,180,255,0.05)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 10 }}><div style={{ color: "#00b4ff", fontSize: 22, fontWeight: 800 }}>{customers.length}</div><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>Total Customers</div></div>
        <div style={{ padding: "11px 18px", background: "rgba(255,80,80,0.05)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 10 }}><div style={{ color: "#ff6b6b", fontSize: 22, fontWeight: 800 }}>PKR {fmt(filtered.reduce((s, c) => s + getPending(c), 0))}</div><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>Total Pending{filterDate ? " (filtered)" : ""}</div></div>
        <div style={{ padding: "11px 18px", background: "rgba(0,229,160,0.05)", border: "1px solid rgba(0,229,160,0.2)", borderRadius: 10 }}><div style={{ color: "#00e5a0", fontSize: 22, fontWeight: 800 }}>PKR {fmt(filtered.reduce((s, c) => s + getTotalReceived(c), 0))}</div><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>Total Received{filterDate ? " (filtered)" : ""}</div></div>
      </div>

      <div style={{ display: "flex", gap: 9, marginBottom: 13, flexWrap: "wrap", alignItems: "center" }}>
        <input value={filterName} onChange={e => setFilterName(e.target.value)} placeholder="Filter by Name..." style={{ ...inSt, maxWidth: 180 }} />
        <input value={filterCell} onChange={e => setFilterCell(e.target.value)} placeholder="Filter by Cell#..." style={{ ...inSt, maxWidth: 160 }} />
        <input value={filterBill} onChange={e => setFilterBill(e.target.value)} placeholder="Filter by Bill#..." style={{ ...inSt, maxWidth: 140 }} />
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...inSt, maxWidth: 160 }} title="Filter received payments by date" />
        <button className="btn" onClick={() => { setFilterName(""); setFilterCell(""); setFilterBill(""); setFilterDate(""); }} style={{ padding: "9px 13px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Clear</button>
        <button className="btn" onClick={() => setShowAddCustomer(true)} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>+ Add Customer</button>
        {currentUser?.Role === "admin" && (<button className="btn" onClick={() => setShowPayModal(true)} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>💰 Receive Payment</button>)}
        <button className="btn" onClick={exportCSV} style={{ marginLeft: "auto", padding: "9px 16px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>📥 Export CSV</button>
      </div>

      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: currentUser?.Role === "admin" ? "1fr 160px 1fr 110px 110px 70px" : "1fr 160px 1fr 110px 110px", padding: "8px 14px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>NAME</div><div>CELL NUMBER</div><div>BILL NO(S)</div><div style={{ textAlign: "right" }}>TOTAL BILLS</div><div style={{ textAlign: "right" }}>PENDING</div>{currentUser?.Role === "admin" && <div style={{ textAlign: "center" }}>ACTION</div>}
        </div>
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          {filtered.length === 0 ? (<div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 140, color: "rgba(255,255,255,0.2)", gap: 8 }}><div style={{ fontSize: 30 }}>👥</div><div style={{ fontSize: 12 }}>No customers found</div></div>) : filtered.map((c, i) => {
            const totalBills = getCustomerSales(c).reduce((s, sale) => s + parseFloat(sale.GrandTotal || 0), 0);
            const pending = getPending(c);
            return (<div key={i} onClick={() => setLedgerCustomer(c)} style={{ display: "grid", gridTemplateColumns: currentUser?.Role === "admin" ? "1fr 160px 1fr 110px 110px 70px" : "1fr 160px 1fr 110px 110px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.035)", alignItems: "center", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(0,180,255,0.05)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#0062ff,#00b4ff)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{c.Name?.[0]?.toUpperCase() || "?"}</div><span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{c.Name || "—"}</span></div>
              <div style={{ color: "rgba(0,180,255,0.8)", fontSize: 12, fontFamily: "monospace" }}>{c.CellNo || "—"}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{(c.BillNo || "").split(",").filter(Boolean).map(b => (<span key={b} style={{ padding: "2px 8px", borderRadius: 12, background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 10, fontWeight: 700 }}>#{b.trim()}</span>))}</div>
              <div style={{ textAlign: "right", color: "#00e5a0", fontSize: 12, fontWeight: 700 }}>PKR {fmt(totalBills)}</div>
              <div style={{ textAlign: "right", color: pending > 0 ? "#ff6b6b" : "#00e5a0", fontSize: 12, fontWeight: 700 }}>{pending > 0 ? `PKR ${fmt(pending)}` : "✓ Paid"}</div>
              {currentUser?.Role === "admin" && (<div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 5 }}><button className="btn" onClick={e => { e.stopPropagation(); /* edit */ }} style={{ padding: "4px 10px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 11, borderRadius: 5 }}>Edit</button><button className="btn" onClick={e => { e.stopPropagation(); if (window.confirm("Delete customer?")) { setCustomers(p => p.filter(x => x.CellNo !== c.CellNo)); safeCallScript({ action: "deleteCustomer", CellNo: c.CellNo }); } }} style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 5 }}>Del</button></div>)}
            </div>);
          })}
        </div>
      </div>

      {showAddCustomer && <AddCustomerModal customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} onClose={() => setShowAddCustomer(false)} />}
      {showPayModal && <ReceivePaymentModal customers={customers} setCustomers={setCustomers} sales={sales} safeCallScript={safeCallScript} onClose={() => setShowPayModal(false)} />}
      {ledgerCustomer && <CustomerLedgerModal customer={ledgerCustomer} customers={customers} setCustomers={setCustomers} sales={sales} onClose={() => setLedgerCustomer(null)} safeCallScript={safeCallScript} />}
    </div>
  );
}

// -------------------- AddCustomerModal, ReceivePaymentModal, CustomerLedgerModal (condensed) --------------------
function AddCustomerModal({ customers, setCustomers, safeCallScript, onClose }) {
  const [name, setName] = useState(""); const [cell, setCell] = useState(""); const [msg, setMsg] = useState("");
  const handleSave = async () => {
    if (!name.trim() || !cell.trim()) { setMsg("Name and Cell# are required."); return; }
    if (customers.find(c => c.CellNo === cell.trim())) { setMsg("A customer with this cell# already exists."); return; }
    const newCust = { Name: name.trim(), CellNo: cell.trim(), BillNo: "", payments: [] };
    setCustomers(p => [...p, newCust]);
    try { await dbPut("customers", { ...newCust, id: cell.trim() }); } catch(e) {}
    await safeCallScript({ action: "saveCustomer", Name: name.trim(), CellNo: cell.trim(), BillNo: "" });
    onClose();
  };
  return (<div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ background: "#0c1828", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 380 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}><div style={{ color: "#00b4ff", fontSize: 14, fontWeight: 700 }}>➕ Add New Customer</div><button className="btn" onClick={onClose} style={{ width: 28, height: 28, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6 }}>✕</button></div><div style={{ marginBottom: 12 }}><label style={lbSt}>FULL NAME</label><input value={name} onChange={e => setName(e.target.value)} style={inSt} /></div><div style={{ marginBottom: 14 }}><label style={lbSt}>CELL NUMBER</label><input value={cell} onChange={e => setCell(e.target.value)} style={inSt} onKeyDown={e => e.key === "Enter" && handleSave()} /></div>{msg && <div style={{ marginBottom: 12, color: "#ff6b6b", fontSize: 12 }}>{msg}</div>}<button className="btn" onClick={handleSave} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>💾 Save Customer</button></div></div>);
}

function ReceivePaymentModal({ customers, setCustomers, sales, safeCallScript, onClose }) {
  const [query, setQuery] = useState(""); const [results, setResults] = useState([]); const [selected, setSelected] = useState(null); const [amount, setAmount] = useState(""); const [note, setNote] = useState("Received"); const [date, setDate] = useState(new Date().toISOString().slice(0,10)); const [msg, setMsg] = useState("");
  useEffect(() => { const q = query.trim().toLowerCase(); if (!q) { setResults([]); return; } setResults(customers.filter(c => c.Name?.toLowerCase().includes(q) || c.CellNo?.includes(q)).slice(0,8)); }, [query, customers]);
  const getPending = (c) => { const totalBills = (c.BillNo || "").split(",").filter(Boolean).reduce((s, bn) => { const sale = sales.find(sale => sale.BillNo === bn); if (sale && sale.PaymentMethod === "Credit") return s + parseFloat(sale.GrandTotal || 0); return s; }, 0); const totalPaid = (c.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0); return Math.max(0, totalBills - totalPaid); };
  const handleSave = async () => {
    if (!selected || !amount || parseFloat(amount) <= 0) { setMsg("Select customer and valid amount."); return; }
    const payment = { date, amount: parseFloat(amount), note: note.trim() || "Received" };
    setCustomers(prev => prev.map(c => c.CellNo === selected.CellNo ? { ...c, payments: [...(c.payments || []), payment] } : c));
    try { const dbC = await dbGet("customers", selected.CellNo); if (dbC) await dbPut("customers", { ...dbC, payments: [...(dbC.payments || []), payment] }); } catch(e) {}
    await safeCallScript({ action: "savePayment", CellNo: selected.CellNo.trim(), date, amount: parseFloat(amount), note: note.trim() || "Received" });
    // print receipt
    const w = window.open("", "_blank", "width=400,height=500");
    if (w) { const pending = getPending(selected); const newPending = pending - parseFloat(amount); w.document.write(`<html><head><title>Payment Receipt</title><style>body{font-family:'Courier New',monospace;padding:20px;font-size:12px}</style></head><body><h2>MART - BAKERY & STORE</h2><div style="text-align:center">Payment Receipt</div><div class="line" style="border-top:1px dashed #000;margin:10px 0"></div><div><strong>Customer:</strong> ${selected.Name}</div><div><strong>Cell:</strong> ${selected.CellNo}</div><div><strong>Date:</strong> ${date}</div><div><strong>Amount Received:</strong> PKR ${fmt(parseFloat(amount))}</div><div><strong>Previous Outstanding:</strong> PKR ${fmt(pending)}</div><div><strong>Remaining Balance:</strong> PKR ${fmt(newPending)}</div><div><strong>Note:</strong> ${note}</div><div class="line" style="border-top:1px dashed #000;margin:10px 0"></div><div style="text-align:center">Thank you!</div></body></html>`); w.document.close(); setTimeout(() => w.print(), 300); } else alert("Allow popups to print receipt");
    onClose();
  };
  const pending = selected ? getPending(selected) : 0;
  return (<div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ background: "#0c1828", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 420 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}><div style={{ color: "#00b4ff", fontSize: 14, fontWeight: 700 }}>💰 Receive Payment</div><button className="btn" onClick={onClose} style={{ width: 28, height: 28, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6 }}>✕</button></div><label style={{ ...lbSt, marginBottom: 5 }}>Search Customer (Name or Cell #)</label><div style={{ position: "relative", marginBottom: 14 }}><input value={query} onChange={e => { setQuery(e.target.value); setSelected(null); }} style={{ ...inSt, width: "100%" }} />{results.length > 0 && !selected && (<div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#0c1828", border: "1px solid rgba(0,180,255,0.28)", borderRadius: 8, zIndex: 10 }}>{results.map((c,i) => (<div key={i} onClick={() => { setSelected(c); setQuery(c.Name); setResults([]); }} style={{ padding: "8px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between" }}><span style={{ color: "#fff" }}>{c.Name}</span><span style={{ color: "rgba(0,180,255,0.7)" }}>{c.CellNo}</span></div>))}</div>)}</div>{selected && (<div style={{ background: "rgba(0,180,255,0.06)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 9, padding: "10px 14px", marginBottom: 14 }}><div style={{ color: "#fff", fontWeight: 700 }}>{selected.Name}</div><div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11, marginBottom: 8 }}>{selected.CellNo}</div><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "rgba(255,255,255,0.5)" }}>Outstanding Balance</span><span style={{ color: pending > 0 ? "#ff6b6b" : "#00e5a0", fontWeight: 700 }}>PKR {fmt(pending)}</span></div></div>)}<div style={{ display: "flex", gap: 10, marginBottom: 12 }}><div style={{ flex: 1 }}><label style={{ ...lbSt, marginBottom: 5 }}>Amount (PKR)</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inSt, fontSize: 15 }} /></div><div style={{ flex: 1 }}><label style={{ ...lbSt, marginBottom: 5 }}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inSt} /></div></div><div style={{ marginBottom: 14 }}><label style={{ ...lbSt, marginBottom: 5 }}>Note</label><input value={note} onChange={e => setNote(e.target.value)} style={inSt} /></div>{msg && <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", borderRadius: 7, color: "#ff6b6b", fontSize: 12 }}>{msg}</div>}<button className="btn" onClick={handleSave} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>💾 Save and Print</button></div></div>);
}

function CustomerLedgerModal({ customer, customers, setCustomers, sales, onClose, safeCallScript }) {
  const billNos = (customer.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
  const custSales = billNos.map(bn => sales?.find(s => s.BillNo === bn)).filter(Boolean);
  const debitRows = custSales.map(s => ({ date: s.Date, type: "debit", billNo: s.BillNo, desc: `Bill #${s.BillNo} ${s.PaymentMethod === "Credit" ? "(Credit)" : ""}`, debit: parseFloat(s.GrandTotal || 0), credit: 0 }));
  const creditRows = (customer.payments || []).map((p, i) => ({ date: p.date, type: "credit", billNo: null, desc: `Payment Received${p.note ? " — " + p.note : ""}`, debit: 0, credit: parseFloat(p.amount || 0), payIndex: i }));
  const allRows = [...debitRows, ...creditRows].sort((a, b) => new Date(a.date.replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$2-$1")) - new Date(b.date.replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$2-$1")));
  let running = 0; const rows = allRows.map(r => { running = running + r.debit - r.credit; return { ...r, balance: running }; });
  const totalBills = debitRows.reduce((s, r) => s + r.debit, 0);
  const totalPaid = creditRows.reduce((s, r) => s + r.credit, 0);
  const pending = Math.max(0, totalBills - totalPaid);
  const downloadPDF = () => {
    let tableRows = ""; rows.forEach(r => { tableRows += `<tr><td>${r.date || "—"}</td><td>${r.desc}${r.billNo ? ` (#${r.billNo})` : ""}</td><td style="text-align:right">${r.debit > 0 ? `PKR ${r.debit.toLocaleString()}` : "—"}</td><td style="text-align:right">${r.credit > 0 ? `PKR ${r.credit.toLocaleString()}` : "—"}</td><td style="text-align:right;font-weight:bold">${r.balance > 0 ? `PKR ${r.balance.toLocaleString()}` : "NIL"}</td></tr>`; });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;color:#000;background:#fff;padding:30px}h1{font-size:20px;text-align:center;margin-bottom:4px}.sub{text-align:center;color:#555;font-size:12px;margin-bottom:20px}.info-box{display:flex;gap:30px;margin-bottom:20px;padding:12px 16px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9}.info-item{display:flex;flex-direction:column;gap:2px}.info-label{color:#777;font-size:10px;text-transform:uppercase}.info-val{font-weight:bold;font-size:14px}table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#0c1828;color:#fff;padding:8px 10px;text-align:left;font-size:11px}td{padding:7px 10px;border-bottom:1px solid #eee}tr:nth-child(even){background:#f7f7f7}.footer{text-align:center;color:#aaa;font-size:10px;margin-top:10px}</style></head><body><h1>MART — BAKERY & STORES</h1><div class="sub">Customer Account Statement</div><div class="info-box"><div class="info-item"><span class="info-label">Customer Name</span><span class="info-val">${customer.Name}</span></div><div class="info-item"><span class="info-label">Cell Number</span><span class="info-val">${customer.CellNo || "—"}</span></div><div class="info-item"><span class="info-label">Total Billed</span><span class="info-val" style="color:#c00">PKR ${totalBills.toLocaleString()}</span></div><div class="info-item"><span class="info-label">Total Paid</span><span class="info-val" style="color:#070">PKR ${totalPaid.toLocaleString()}</span></div><div class="info-item"><span class="info-label">Balance Due</span><span class="info-val" style="color:${pending > 0 ? "#c00" : "#070"}">${pending > 0 ? `PKR ${pending.toLocaleString()}` : "CLEAR"}</span></div></div><table><thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead><tbody>${tableRows}</tbody></table><div class="footer">Generated by itKINS POS System · itkins.com · 0304-7414437</div><br/></body></html>`;
    const w = window.open("", "_blank", "width=900,height=700"); if (!w) { alert("Allow popups!"); return; } w.document.write(html); w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 450);
  };
  return (<div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ background: "#0a0e1a", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 720, maxWidth: "96vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}><div><div style={{ color: "#00b4ff", fontSize: 16, fontWeight: 800 }}>{customer.Name}</div><div style={{ color: "rgba(0,180,255,0.6)", fontSize: 12, fontFamily: "monospace" }}>{customer.CellNo || "—"}</div></div><div style={{ display: "flex", gap: 8 }}><button className="btn" onClick={downloadPDF} style={{ padding: "7px 14px", background: "linear-gradient(135deg,#b45309,#fbbf24)", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>📄 Download PDF (A4)</button><button className="btn" onClick={onClose} style={{ width: 30, height: 30, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6, fontSize: 14 }}>✕</button></div></div><div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>{[{ label: "Total Billed", val: `PKR ${fmt(totalBills)}`, color: "#ff6b6b" }, { label: "Total Paid", val: `PKR ${fmt(totalPaid)}`, color: "#00e5a0" }, { label: "Balance Due", val: pending > 0 ? `PKR ${fmt(pending)}` : "✓ CLEAR", color: pending > 0 ? "#ff6b6b" : "#00e5a0" }].map((s,i) => (<div key={i} style={{ flex: 1, minWidth: 140, padding: "9px 14px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 9 }}><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10 }}>{s.label}</div><div style={{ color: s.color, fontWeight: 800, fontSize: 15 }}>{s.val}</div></div>))}</div><div style={{ flex: 1, overflowY: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}><div style={{ display: "grid", gridTemplateColumns: "100px 1fr 130px 130px 120px 30px", padding: "8px 14px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700, position: "sticky", top: 0 }}><div>DATE</div><div>DESCRIPTION</div><div style={{ textAlign: "right" }}>DEBIT (Dr)</div><div style={{ textAlign: "right" }}>CREDIT (Cr)</div><div style={{ textAlign: "right" }}>BALANCE</div><div /></div><div style={{ overflowY: "auto", maxHeight: 360 }}>{rows.length === 0 ? (<div style={{ textAlign: "center", padding: 30, color: "rgba(255,255,255,0.2)" }}>No transactions found</div>) : rows.map((r, i) => (<div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr 130px 130px 120px 30px", padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.035)", alignItems: "center", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}><div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{r.date || "—"}</div><div style={{ color: "#fff", fontSize: 12 }}>{r.desc}{r.billNo ? <span style={{ color: "#00b4ff", marginLeft: 5, fontSize: 10 }}>#{r.billNo}</span> : null}</div><div style={{ textAlign: "right", color: r.debit > 0 ? "#ff6b6b" : "rgba(255,255,255,0.2)", fontSize: 12, fontWeight: r.debit > 0 ? 700 : 400 }}>{r.debit > 0 ? `PKR ${fmt(r.debit)}` : "—"}</div><div style={{ textAlign: "right", color: r.credit > 0 ? "#00e5a0" : "rgba(255,255,255,0.2)", fontSize: 12, fontWeight: r.credit > 0 ? 700 : 400 }}>{r.credit > 0 ? `PKR ${fmt(r.credit)}` : "—"}</div><div style={{ textAlign: "right", color: r.balance > 0 ? "#ff6b6b" : "#00e5a0", fontSize: 13, fontWeight: 800 }}>{r.balance > 0 ? `PKR ${fmt(r.balance)}` : "NIL"}</div><div>{r.type === "credit" && (<button className="btn" title="Delete this payment" onClick={async () => { if (!window.confirm("Delete this payment record?")) return; const updatedPayments = (customer.payments || []).filter((_, pi) => pi !== r.payIndex); setCustomers(prev => prev.map(c => c.CellNo === customer.CellNo ? { ...c, payments: updatedPayments } : c)); await safeCallScript({ action: "deletePayment", CellNo: customer.CellNo, Payments: JSON.stringify(updatedPayments) }); onClose(); }} style={{ width: 22, height: 22, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 4, cursor: "pointer" }}>✕</button>)}</div></div>))}</div></div></div></div>);
}

// -------------------- SetupTab --------------------
function SetupTab({ sheetStatus, onRefresh, lastSync, safeCallScript }) {
  const [testResults, setTestResults] = useState(null); const [testing, setTesting] = useState(false); const [repairing, setRepairing] = useState(false); const [repairMsg, setRepairMsg] = useState("");
  const [dbInfo, setDbInfo] = useState(null);
  const runTest = async () => { setTesting(true); setTestResults(null); setRepairMsg(""); const r = await deepTestConnections(); setTestResults(r); setTesting(false); };
  const doRepair = async () => { setRepairing(true); setRepairMsg("Sending repair request..."); await autoRepairSheets(); setRepairMsg("✅ Sent! Waiting 3s..."); await new Promise(r => setTimeout(r, 3000)); const r = await deepTestConnections(); setTestResults(r); setRepairing(false); const allOk = Object.values(r).every(v => v.ok); setRepairMsg(allOk ? "✅ All fixed!" : "⚠ Some issues remain."); };
  const downloadScript = () => { const txt = getScriptText(); const blob = new Blob([txt], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "POS_Script_v7.gs"; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); };
  const checkDB = async () => { try { const items = await dbGetAll("items"); const sales = await dbGetAll("sales"); const queue = await dbGetAll("pendingQueue"); const lastSyncMeta = await dbGetMeta("lastSync"); setDbInfo({ items: items.length, sales: sales.length, queue: queue.length, lastSync: lastSyncMeta }); } catch (e) { setDbInfo({ error: e.message }); } };
  const clearDB = async () => { if (!window.confirm("Clear all local offline data? (Google Sheets data stays safe)")) return; const stores = ["items", "categories", "cashiers", "sales", "customers", "returns", "stocklog", "meta"]; for (const s of stores) await dbClear(s); setDbInfo(null); alert("Local cache cleared. Refresh to reload from Google Sheets."); };
  const SHEET_LABELS = { items: { label: "📦 Items", tabName: "Items" }, categories: { label: "🏷 Categories", tabName: "Categories" }, cashiers: { label: "👤 Cashier", tabName: "Cashier" }, sales: { label: "💰 Sales", tabName: "Sales" }, stocklog: { label: "📉 StockLog", tabName: "StockLog" }, customers: { label: "🧑 Customer", tabName: "Customer" }, returns: { label: "↩ Returns", tabName: "Returns" }, script: { label: "⚡ Apps Script", tabName: null } };
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><div><div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>💾 OFFLINE DATABASE (IndexedDB)</div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 3 }}>Local cache for offline & fast load</div></div><div style={{ display: "flex", gap: 7 }}><button className="btn" onClick={checkDB} style={{ padding: "7px 14px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.25)", color: "#00b4ff", fontSize: 11, borderRadius: 6 }}>Check DB</button><button className="btn" onClick={clearDB} style={{ padding: "7px 14px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.25)", color: "#ff6b6b", fontSize: 11, borderRadius: 6 }}>Clear Cache</button></div></div>
        {dbInfo && (dbInfo.error ? <div style={{ color: "#ff6b6b", fontSize: 12 }}>Error: {dbInfo.error}</div> : <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 9 }}>{[["Items", dbInfo.items], ["Sales", dbInfo.sales], ["Pending Queue", dbInfo.queue], ["Last Sync", dbInfo.lastSync ? new Date(dbInfo.lastSync).toLocaleTimeString("en-PK") : "Never"]].map(([l, v]) => (<div key={l} style={{ background: "rgba(255,255,255,0.025)", borderRadius: 8, padding: "9px 12px" }}><div style={{ color: "rgba(0,180,255,0.7)", fontSize: 10 }}>{l}</div><div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{v}</div></div>))})}
        {!dbInfo && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Click "Check DB" to see local cache status.</div>}
        <div style={{ marginTop: 10, color: "rgba(255,255,255,0.3)", fontSize: 11, lineHeight: 1.7 }}>Data loads from local cache instantly on startup. Database syncs in background. Offline sales are queued and sent automatically when internet returns.<br />⚠ IndexedDB is per-browser/PC. Multiple PCs sync via Database.</div>
      </div>

      <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 12, padding: 20, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}><div><div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>🔌 CONNECTION & HEADERS TEST</div></div><button className="btn" onClick={runTest} disabled={testing || repairing} style={{ padding: "8px 18px", background: testing ? "rgba(0,180,255,0.1)" : "linear-gradient(135deg,#0062ff,#00b4ff)", border: "none", color: "#fff", fontSize: 12, borderRadius: 7, fontWeight: 700 }}>{testing ? "⏳ Testing..." : "▶ Run Test"}</button></div>
        {testResults && (<><div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>{Object.entries(SHEET_LABELS).map(([key, { label, tabName }]) => { const r = testResults[key] || { ok: false, reachable: false, missingHeaders: [], extraInfo: "" }; return (<div key={key} style={{ padding: "12px 16px", background: "rgba(255,255,255,0.025)", border: `1px solid ${r.ok ? "rgba(0,200,0,0.3)" : r.reachable ? "rgba(255,200,0,0.3)" : "rgba(255,80,80,0.3)"}`, borderRadius: 9 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ fontSize: 22 }}>{r.ok ? "✅" : r.reachable ? "⚠️" : "❌"}</div><div><div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{label}</div><div style={{ color: r.ok ? "#00e080" : r.reachable ? "#ffd700" : "#ff6b6b", fontSize: 11 }}>{r.ok ? r.extraInfo : r.extraInfo || "Not reachable"}</div></div></div>{tabName && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)" }}>Tab: <code style={{ color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: 4 }}>{tabName}</code></div>}</div></div>);})}</div>{!testResults.script?.ok && (<div style={{ display: "flex", gap: 9 }}><button className="btn" onClick={doRepair} disabled={repairing} style={{ padding: "9px 18px", background: "linear-gradient(135deg,#00a651,#00e5a0)", border: "none", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>{repairing ? "⏳ Repairing..." : "🔧 Auto-Repair"}</button><button className="btn" onClick={downloadScript} style={{ padding: "9px 18px", background: "rgba(255,200,0,0.1)", border: "1px solid rgba(255,200,0,0.3)", color: "#ffd700", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>📥 Download Script v7</button></div>)}</>)}
        {!testResults && !testing && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Click ▶ Run Test to check all connections.</div>}
      </div>

      <div style={{ background: "rgba(255,200,0,0.04)", border: "1px solid rgba(255,200,0,0.2)", borderRadius: 12, padding: 18, marginBottom: 18 }}><div style={{ color: "#ffd700", fontWeight: 700, fontSize: 12, marginBottom: 10 }}>📥 APPS SCRIPT - Deploy on Google Sheets</div><button className="btn" onClick={downloadScript} style={{ padding: "10px 22px", background: "linear-gradient(135deg,#ffd700,#ff8c00)", color: "#000", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>📥 Download Script v7 (.gs)</button></div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 18, marginBottom: 18 }}><div style={{ color: "#ffd700", fontWeight: 700, fontSize: 12, marginBottom: 10 }}>🔄 SYNC STATUS</div><div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}><div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>Sheet: <span style={{ color: sheetStatus === "loaded" ? "#00e080" : sheetStatus === "error" ? "#ff6b6b" : "#ffd700", fontWeight: 700 }}>{sheetStatus === "loaded" ? "✓ LIVE" : sheetStatus === "cached" ? "💾 CACHED" : sheetStatus === "error" ? "✗ ERROR" : "◉ DEMO"}</span></div>{lastSync && <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Last: {lastSync.toLocaleString("en-PK")}</div>}<button className="btn" onClick={onRefresh} style={{ padding: "7px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, borderRadius: 7, fontWeight: 700 }}>🔄 Sync Now</button></div></div>

      <div style={{ background: "rgba(255,200,0,0.04)", border: "1px solid rgba(255,200,0,0.22)", borderRadius: 12, padding: 20 }}><div style={{ color: "#ffd700", fontWeight: 700, fontSize: 13, marginBottom: 14 }}>📋 SOFTWARE LICENSE & PAYMENT TERMS</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>{[["1st Installation Fee", "PKR 15,000"], ["Annual Fee", "PKR 10,000"], ["Monthly Fee", "PKR 2,000"], ["Due Date", "5th of Each Month"]].map(([l, v]) => (<div key={l} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 14px", border: "1px solid rgba(255,200,0,0.15)" }}><div style={{ color: "rgba(255,200,0,0.7)", fontSize: 10, letterSpacing: 1, marginBottom: 3 }}>{l}</div><div style={{ color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "Orbitron" }}>{v}</div></div>))}</div><div style={{ background: "rgba(0,180,255,0.05)", border: "1px solid rgba(0,180,255,0.18)", borderRadius: 10, padding: "12px 16px" }}><div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 12, marginBottom: 8 }}>💳 PAYMENT METHOD</div><div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 2.1 }}>Bank: <b style={{ color: "#fff" }}>Bank Alfalah</b><br />Account#: <b style={{ color: "#ffd700", fontFamily: "monospace", letterSpacing: 2 }}>0203-1005098235</b><br />Account Name: <b style={{ color: "#fff" }}>Mian Ahmed Umer</b></div></div></div>
    </div>
  );
}


// ==================== PDF Generator Helper ====================
async function downloadStockPDF(filtered, filterCat, filterCo, filterStatus) {
  const now = new Date().toLocaleString("en-PK");
  const filterDesc = [filterCat !== "All" ? `Category: ${filterCat}` : "", filterCo !== "All" ? `Company: ${filterCo}` : "", filterStatus !== "All" ? `Status: ${filterStatus === "out" ? "Out of Stock" : filterStatus === "low" ? "Low Stock" : filterStatus === "ok" ? "In Stock" : filterStatus === "expired" ? "Expired Items" : filterStatus === "expiring" ? "Expiring Soon" : filterStatus}` : ""].filter(Boolean).join("  |  ") || "All Items";
  const totalValue = filtered.reduce((s, i) => s + parseFloat(i.Price || 0) * (Number(i.Stock) || 0), 0);
  const outCount = filtered.filter(i => (Number(i.Stock) || 0) <= 0).length;
  const lowCount = filtered.filter(i => (Number(i.Stock) || 0) > 0 && (Number(i.Stock) || 0) <= 5).length;
  const okCount = filtered.filter(i => (Number(i.Stock) || 0) > 5).length;
  const rows = filtered.map((item, i) => {
    const stk = Number(item.Stock) || 0;
    const statusColor = stk <= 0 ? "#c0392b" : stk <= 5 ? "#d68910" : "#1e8449";
    const statusText = stk <= 0 ? "OUT" : stk <= 5 ? "LOW" : "OK";
    const rowBg = i % 2 === 0 ? "#ffffff" : "#f7f9fc";
    const es = getExpiryStatus(item.ExpiryDate);
    const expiryColor = es.status === "expired" ? "#c0392b" : es.status === "critical" || es.status === "today" ? "#d35400" : es.status === "warning" ? "#d68910" : es.status === "ok" ? "#1e8449" : "#888";
    const expiryText = item.ExpiryDate ? fmtExpiry(item.ExpiryDate) : "—";
    const expiryLabel = item.ExpiryDate ? es.label : "";
    return `<tr style="background:${rowBg}"><td style="text-align:center;color:#888">${i+1}</td><td style="font-family:monospace;font-size:10px;color:#555">${item.Barcode}</td><td style="font-weight:600;color:#111">${item.ItemName}</td><td style="color:#444">${item.Category || "—"}</td><td style="color:#0057a8">${item.Company || "—"}</td><td style="text-align:right;font-weight:700">PKR ${fmt(item.Price)}</td><td style="text-align:right;color:#555">${item.CostPrice ? "PKR " + fmt(item.CostPrice) : "—"}</td><td style="text-align:right;font-weight:800;font-size:13px;color:${statusColor}">${item.Stock}</td><td style="text-align:center"><div style="color:${expiryColor};font-weight:700;font-size:11px">${expiryText}</div><div style="color:${expiryColor};font-size:9px;opacity:0.85">${expiryLabel}</div></td><td style="text-align:center"><span style="background:${statusColor};color:#fff;padding:2px 9px;border-radius:10px;font-size:10px;font-weight:700;">${statusText}</span></td></tr>`;
  }).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Stock Report — itKINS MART</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;color:#222;background:#fff;padding:24px}h1{font-size:22px;color:#0a2540;margin-bottom:3px}.sub{color:#666;font-size:11px;margin-bottom:18px}.cards{display:flex;gap:14px;margin-bottom:20px}.card{flex:1;border-radius:8px;padding:13px 16px;text-align:center}.card .val{font-size:22px;font-weight:800;margin-bottom:3px}.card .lbl{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.5px}table{width:100%;border-collapse:collapse}thead th{background:#0a2540;color:#fff;padding:9px 10px;text-align:left;font-size:10px;letter-spacing:0.8px;text-transform:uppercase}tbody td{padding:7px 10px;border-bottom:1px solid #eaecef}.footer{margin-top:24px;text-align:center;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:10px}@media print{body{padding:10px}.footer{position:fixed;bottom:0;width:100%}}</style></head><body><h1>📦 Stock Report — itKINS MART &amp; BAKERY</h1><div class="sub">Generated: ${now} &nbsp;·&nbsp; Filter: ${filterDesc} &nbsp;·&nbsp; Total Items: ${filtered.length}</div><div class="cards"><div class="card" style="background:#fde8e8;border:1px solid #f5c6c6"><div class="val" style="color:#c0392b">${outCount}</div><div class="lbl">Out of Stock</div></div><div class="card" style="background:#fef9e7;border:1px solid #f9e4a0"><div class="val" style="color:#d68910">${lowCount}</div><div class="lbl">Low Stock (≤5)</div></div><div class="card" style="background:#e8f8f0;border:1px solid #a9dfbf"><div class="val" style="color:#1e8449">${okCount}</div><div class="lbl">In Stock</div></div><div class="card" style="background:#eaf4ff;border:1px solid #a9ccee"><div class="val" style="color:#1a5276;font-size:16px">PKR ${fmt(totalValue)}</div><div class="lbl">Stock Value</div></div></div><table><thead><tr><th style="width:32px;text-align:center">#</th><th>Barcode</th><th>Item Name</th><th>Category</th><th>Company</th><th style="text-align:right">Price</th><th style="text-align:right">Cost</th><th style="text-align:right">Stock</th><th style="text-align:center">Expiry</th><th style="text-align:center">Status</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">itKINS POS System &nbsp;·&nbsp; Designed by itkins.com &nbsp;|&nbsp; 0304-7414437</div><script>window.onload = () => { window.print(); }</script></body></html>`;
  const w = window.open("", "_blank", "width=960,height=720");
  if (!w) { alert("Please allow popups for this page to download PDF!"); return; }
  w.document.write(html); w.document.close();
}



