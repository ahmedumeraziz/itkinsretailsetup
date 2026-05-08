import { useState, useEffect, useRef, useCallback } from "react";
import { SHEET_URLS } from "./config";
import {
  openDB, dbGetAll, dbSaveAll, dbPut, dbGet, dbQueueAction,
  dbGetQueue, dbClearQueueItem, dbSetMeta, dbGetMeta,
} from "./utils/db";
import { parseCSV, buildSearchIndex } from "./utils/helpers";
import { callScript } from "./utils/api";
import {
  DEMO_ITEMS, DEMO_CATEGORIES, DEMO_CASHIERS,
  DEMO_SALES, DEMO_CUSTOMERS, DEMO_RETURNS,
} from "./data/demoData";
import LoginScreen  from "./components/LoginScreen";
import POSScreen    from "./components/POSScreen";
import AdminScreen  from "./components/AdminScreen";

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0e1a; color: #e0e8f0; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
  ::-webkit-scrollbar-thumb { background: rgba(0,180,255,0.3); border-radius: 3px; }
  button.btn { cursor: pointer; font-family: inherit; transition: opacity 0.15s, transform 0.1s; border: none; }
  button.btn:hover  { opacity: 0.88; }
  button.btn:active { transform: scale(0.97); }
  button.btn:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }
  .fadein { animation: fadeIn 0.35s ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
  input[type=number] { -moz-appearance: textfield; }
  .qty-focus-input { border-color: rgba(0,180,255,0.7) !important; box-shadow: 0 0 0 2px rgba(0,180,255,0.18); }
  .kb-selected { background: rgba(0,180,255,0.16) !important; }
`;

// ─── FETCH CSV HELPER ─────────────────────────────────────────────────────────
async function fetchCSV(url, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url + "&t=" + Date.now(), { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    return parseCSV(text);
  } finally { clearTimeout(timer); }
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── Data state ──
  const [items,      setItems]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [cashiers,   setCashiers]   = useState([]);
  const [sales,      setSales]      = useState([]);
  const [customers,  setCustomers]  = useState([]);
  const [returns,    setReturns]    = useState([]);

  // ── Search index ──
  const [searchIndex, setSearchIndex] = useState(new Map());
  const [itemMap,     setItemMap]     = useState(new Map());

  // ── UI state ──
  const [user,          setUser]          = useState(null);
  const [view,          setView]          = useState("login"); // login | pos | admin
  const [sheetStatus,   setSheetStatus]   = useState("loading");
  const [isOnline,      setIsOnline]      = useState(navigator.onLine);
  const [lastSync,      setLastSync]      = useState(null);
  const [billCounter,   setBillCounter]   = useState(1);
  const [returnCounter, setReturnCounter] = useState(1);

  // ── Refs ──
  const syncLock = useRef(false);

  // ── Inject global CSS ──
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = globalCSS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // ── Online/offline ──
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Rebuild search index when items change ──
  useEffect(() => {
    if (items.length === 0) return;
    const idx = buildSearchIndex(items);
    const map = new Map(items.map(i => [i.Barcode, i]));
    setSearchIndex(idx);
    setItemMap(map);
  }, [items]);

  // ── Load from IndexedDB cache first, then sync from sheets ──
  const loadFromCache = useCallback(async () => {
    try {
      await openDB();
      const [ci, cc, cca, cs, ccu, cr] = await Promise.all([
        dbGetAll("items"), dbGetAll("categories"), dbGetAll("cashiers"),
        dbGetAll("sales"), dbGetAll("customers"),  dbGetAll("returns"),
      ]);
      const lastSyncTs = await dbGetMeta("lastSync");
      const billCnt    = await dbGetMeta("billCounter");
      const retCnt     = await dbGetMeta("returnCounter");
      if (ci.length)  { setItems(ci);      }
      if (cc.length)  { setCategories(cc.map(c => c.CategoryName || c.id)); }
      if (cca.length) { setCashiers(cca);  }
      if (cs.length)  { setSales(cs);      }
      if (ccu.length) { setCustomers(ccu); }
      if (cr.length)  { setReturns(cr);    }
      if (billCnt)    setBillCounter(parseInt(billCnt) || 1);
      if (retCnt)     setReturnCounter(parseInt(retCnt) || 1);
      if (lastSyncTs) setLastSync(new Date(lastSyncTs));
      return { hasCache: ci.length > 0 || cca.length > 0 };
    } catch (e) {
      console.warn("Cache load failed:", e);
      return { hasCache: false };
    }
  }, []);

  const loadDemo = useCallback(() => {
    setItems(DEMO_ITEMS);
    setCategories(DEMO_CATEGORIES);
    setCashiers(DEMO_CASHIERS);
    setSales(DEMO_SALES);
    setCustomers(DEMO_CUSTOMERS.map(c => ({ ...c, payments: c.payments || [] })));
    setReturns(DEMO_RETURNS);
    setSheetStatus("demo");
    setBillCounter(120);
    setReturnCounter(1);
  }, []);

  const syncFromSheets = useCallback(async () => {
    if (syncLock.current) return;
    syncLock.current = true;
    setSheetStatus("syncing");
    try {
      const [rawItems, rawCats, rawCashiers, rawSales, rawCustomers, rawReturns] = await Promise.all([
        fetchCSV(SHEET_URLS.items),      fetchCSV(SHEET_URLS.categories),
        fetchCSV(SHEET_URLS.cashiers),   fetchCSV(SHEET_URLS.sales),
        fetchCSV(SHEET_URLS.customers),  fetchCSV(SHEET_URLS.returns),
      ]);

      // Items
      if (rawItems.length) {
        setItems(rawItems);
        await dbSaveAll("items", rawItems, "Barcode");
      }
      // Categories
      const catNames = rawCats.map(c => c.CategoryName).filter(Boolean);
      if (catNames.length) {
        setCategories(catNames);
        await dbSaveAll("categories", rawCats, "CategoryName");
      }
      // Cashiers
      if (rawCashiers.length) {
        setCashiers(rawCashiers);
        await dbSaveAll("cashiers", rawCashiers, "Username");
      }
      // Sales
      if (rawSales.length) {
        setSales(rawSales);
        await dbSaveAll("sales", rawSales, "BillNo");
        const maxBill = rawSales.reduce((m, s) => Math.max(m, parseInt(s.BillNo) || 0), 0);
        if (maxBill > 0) {
          const next = maxBill + 1;
          setBillCounter(next);
          await dbSetMeta("billCounter", next);
        }
      }
      // Customers
      if (rawCustomers.length) {
        // Get current local customers to preserve local-only fields
        let localCustomers = [];
        try { localCustomers = await dbGetAll("customers"); } catch {}
        const localMap = new Map(localCustomers.map(c => [c.CellNo, c]));

        const parsed = rawCustomers.map(c => {
          const localC = localMap.get(c.CellNo);

          // Payments: always trust local (preserves deletions & offline additions)
          const sheetPayments = (() => { try { return JSON.parse(c.Payments || "[]"); } catch { return []; } })();
          const payments = (localC?.payments !== undefined && localC?.payments !== null)
            ? localC.payments
            : sheetPayments;

          // Opening debit: preserve from local if set
          const openingDebit = localC?.openingDebit !== undefined
            ? localC.openingDebit
            : parseFloat(c.OpeningDebit || 0);

          // Deduplicate BillNo field from sheet
          const normBill = (b) => String(b || "").trim().replace(/^0+/, "") || "0";
          const seen = new Set();
          const uniqueBills = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim()).filter(b => {
            const n = normBill(b);
            if (seen.has(n)) return false;
            seen.add(n);
            return true;
          });

          return { ...c, BillNo: uniqueBills.join(","), payments, openingDebit };
        });
        setCustomers(parsed);
        await dbSaveAll("customers", parsed, "CellNo");
      }
      // Returns
      if (rawReturns.length) {
        setReturns(rawReturns);
        await dbSaveAll("returns", rawReturns, "ReturnNo");
        const maxRet = rawReturns.reduce((m, r) => Math.max(m, parseInt((r.ReturnNo || "").replace(/\D/g, "")) || 0), 0);
        if (maxRet > 0) {
          const next = maxRet + 1;
          setReturnCounter(next);
          await dbSetMeta("returnCounter", next);
        }
      }

      const now = Date.now();
      setLastSync(new Date(now));
      await dbSetMeta("lastSync", now);
      setSheetStatus("loaded");
    } catch (e) {
      console.warn("Sheet sync failed:", e.message);
      setSheetStatus(prev => prev === "syncing" ? "error" : prev);
    } finally {
      syncLock.current = false;
    }
  }, []);

  // ── Bootstrap on mount ──
  useEffect(() => {
    (async () => {
      const { hasCache } = await loadFromCache();
      if (hasCache) setSheetStatus("cached");
      if (navigator.onLine) {
        await syncFromSheets();
      } else if (!hasCache) {
        loadDemo();
      }
    })();
  }, []);

  // ── Periodic sync every 5 min ──
  useEffect(() => {
    const timer = setInterval(() => {
      if (navigator.onLine && !syncLock.current) syncFromSheets();
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [syncFromSheets]);

  // ── Flush offline queue when back online ──
  useEffect(() => {
    if (!isOnline) return;
    (async () => {
      const queue = await dbGetQueue();
      for (const item of queue) {
        try {
          await callScript(item);
          await dbClearQueueItem(item.qid);
        } catch (e) {
          console.warn("Queue flush failed:", e.message);
        }
      }
      if (queue.length > 0) syncFromSheets();
    })();
  }, [isOnline]);

  // ── Safe script caller: queue if offline ──
  const safeCallScript = useCallback(async (payload) => {
    try {
      if (navigator.onLine) {
        await callScript(payload);
      } else {
        await dbQueueAction(payload);
        console.log("📦 Queued for later:", payload.action);
      }
    } catch (e) {
      console.warn("callScript failed, queuing:", e.message);
      try { await dbQueueAction(payload); } catch {}
    }
  }, []);

  // ── Login / logout ──
  const handleLogin = useCallback((cashier) => {
    setUser(cashier);
    setView(cashier.Role === "admin" ? "admin" : "pos");
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    setView("login");
  }, []);

  // ── Sale saved ──
  const handleSaleSaved = useCallback(async (saleData, customerInfo) => {
    // Update sales state
    setSales(prev => [...prev, saleData]);
    try { await dbPut("sales", { ...saleData, id: saleData.BillNo }); } catch {}

    // Update bill counter
    const next = (parseInt(saleData.BillNo) || 0) + 1;
    setBillCounter(next);
    try { await dbSetMeta("billCounter", next); } catch {}

    // Update stock in state + cache
    const soldItems = saleData.items || [];
    if (soldItems.length) {
      setItems(prev => prev.map(item => {
        const sold = soldItems.find(s => s.Barcode === item.Barcode);
        if (!sold) return item;
        const newStock = Math.max(0, (Number(item.Stock) || 0) - (parseInt(sold.qty) || 1));
        dbPut("items", { ...item, Stock: String(newStock), id: item.Barcode }).catch(() => {});
        return { ...item, Stock: String(newStock) };
      }));
    }

    // Save customer if credit sale
    if (customerInfo?.Name && customerInfo.Name !== "Unknown" && customerInfo.CellNo) {
      setCustomers(prev => {
        const normB = (b) => String(b || "").trim().replace(/^0+/, "") || "0";
        const existing = prev.find(c => c.CellNo === customerInfo.CellNo);
        if (existing) {
          // Deduplicate: compare normalised bills so "0115" and "115" are the same
          const bills = (existing.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
          const alreadyHas = bills.some(b => normB(b) === normB(saleData.BillNo));
          if (alreadyHas) return prev; // bill already recorded, no change
          const updated = { ...existing, BillNo: [...bills, saleData.BillNo].join(",") };
          dbPut("customers", { ...updated, id: existing.CellNo }).catch(() => {});
          return prev.map(c => c.CellNo === existing.CellNo ? updated : c);
        } else {
          const newCust = { ...customerInfo, BillNo: saleData.BillNo, payments: [] };
          dbPut("customers", { ...newCust, id: customerInfo.CellNo }).catch(() => {});
          return [...prev, newCust];
        }
      });
    }

    // Sync to Google Sheets
    await safeCallScript({ action: "saveSale", ...saleData });
    if (customerInfo?.Name && customerInfo.Name !== "Unknown" && customerInfo.CellNo) {
      await safeCallScript({ action: "saveCustomer", Name: customerInfo.Name, CellNo: customerInfo.CellNo, BillNo: saleData.BillNo });
    }
  }, [safeCallScript]);

  // ── Return saved ──
  const handleReturnSaved = useCallback(async (ret) => {
    setReturns(prev => [...prev, ret]);
    try { await dbPut("returns", { ...ret, id: ret.ReturnNo }); } catch {}

    // Restore stock
    const retItems = (() => { try { return JSON.parse(ret.Items || "[]"); } catch { return []; } })();
    if (retItems.length) {
      setItems(prev => prev.map(item => {
        const ri = retItems.find(r => r.Barcode === item.Barcode);
        if (!ri) return item;
        const newStock = (Number(item.Stock) || 0) + (parseInt(ri.qty) || 1);
        dbPut("items", { ...item, Stock: String(newStock), id: item.Barcode }).catch(() => {});
        return { ...item, Stock: String(newStock) };
      }));
    }

    const next = returnCounter + 1;
    setReturnCounter(next);
    try { await dbSetMeta("returnCounter", next); } catch {}
    await safeCallScript({ action: "saveReturn", ...ret });
  }, [returnCounter, safeCallScript]);

  // ── Mark return as used ──
  const handleMarkReturnUsed = useCallback(async (returnNo) => {
    setReturns(prev => prev.map(r => r.ReturnNo === returnNo ? { ...r, UsedInBill: "1" } : r));
    try {
      const r = await dbGet("returns", returnNo);
      if (r) await dbPut("returns", { ...r, UsedInBill: "1" });
    } catch {}
    await safeCallScript({ action: "markReturnUsed", ReturnNo: returnNo });
  }, [safeCallScript]);

  // ── Manual refresh ──
  const handleRefresh = useCallback(async () => {
    if (navigator.onLine) await syncFromSheets();
    else setSheetStatus("error");
  }, [syncFromSheets]);

  // ── Render ──
  const commonProps = { isOnline, sheetStatus, lastSync, onRefresh: handleRefresh };

  if (view === "login") {
    return (
      <LoginScreen
        cashiers={cashiers}
        onLogin={handleLogin}
        sheetStatus={sheetStatus}
        onRefresh={handleRefresh}
      />
    );
  }

  if (view === "pos") {
    return (
      <POSScreen
        user={user}
        items={items}
        categories={categories}
        billCounter={billCounter}
        sales={sales}
        returns={returns}
        returnCounter={returnCounter}
        customers={customers}
        setCustomers={setCustomers}
        onSaleSaved={handleSaleSaved}
        onReturnSaved={handleReturnSaved}
        onMarkReturnUsed={handleMarkReturnUsed}
        onLogout={handleLogout}
        searchIndex={searchIndex}
        itemMap={itemMap}
        {...commonProps}
      />
    );
  }

  if (view === "admin") {
    return (
      <AdminScreen
        user={user}
        items={items}           setItems={setItems}
        categories={categories} setCategories={setCategories}
        cashiers={cashiers}     setCashiers={setCashiers}
        sales={sales}           setSales={setSales}
        customers={customers}   setCustomers={setCustomers}
        returns={returns}       setReturns={setReturns}
        onLogout={handleLogout}
        safeCallScript={safeCallScript}
        {...commonProps}
      />
    );
  }

  return null;
}
