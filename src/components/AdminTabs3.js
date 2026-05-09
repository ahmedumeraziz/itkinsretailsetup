import { useState } from "react";
import { inSt, slSt, REQUIRED_HEADERS } from "../config";
import { fmt, getExpiryStatus, fmtExpiry } from "../utils/helpers";
import { dbPut, dbGetAll, dbClear, dbGetMeta } from "../utils/db";
import { deepTestConnections, autoRepairSheets, generateAllSheets } from "../utils/api";
import { getScriptText } from "../utils/appsScript";
import { downloadStockPDF } from "../utils/print";

// ── STOCK TAB ─────────────────────────────────────────────────────────────────
export function StockTab({ items, setItems, safeCallScript }) {
  const [adjusting,    setAdjusting]    = useState(null);
  const [adjVal,       setAdjVal]       = useState("");
  const [filterCat,    setFilterCat]    = useState("All");
  const [filterCo,     setFilterCo]     = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [pdfLoading,   setPdfLoading]   = useState(false);
  const categories = [...new Set(items.map(i => i.Category || "").filter(Boolean))].sort();
  const companies  = [...new Set(items.map(i => i.Company  || "").filter(Boolean))].sort();
  const filtered = items.filter(i => {
    const stk = Number(i.Stock) || 0;
    const es  = getExpiryStatus(i.ExpiryDate);
    if (filterCat    !== "All" && i.Category !== filterCat) return false;
    if (filterCo     !== "All" && i.Company  !== filterCo)  return false;
    if (filterStatus === "out"      && stk > 0) return false;
    if (filterStatus === "low"      && (stk <= 0 || stk > 5)) return false;
    if (filterStatus === "ok"       && stk <= 5) return false;
    if (filterStatus === "expired"  && es.status !== "expired") return false;
    if (filterStatus === "expiring" && !["critical","today","warning"].includes(es.status)) return false;
    return true;
  }).sort((a, b) => (Number(a.Stock) || 0) - (Number(b.Stock) || 0));

  const doAdjust = async bc => {
    const n = parseInt(adjVal); if (isNaN(n) || n < 0) return;
    const old = items.find(i => i.Barcode === bc); const before = Number(old?.Stock) || 0;
    setItems(p => p.map(i => i.Barcode === bc ? { ...i, Stock: String(n) } : i));
    try { await dbPut("items", { ...old, Stock: String(n), id: bc }); } catch (e) {}
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
          { label: "Out of Stock",  color: "#ff6b6b", cnt: items.filter(i => (Number(i.Stock)||0) <= 0).length },
          { label: "Low Stock (≤5)",color: "#ffd700", cnt: items.filter(i => (Number(i.Stock)||0) > 0 && (Number(i.Stock)||0) <= 5).length },
          { label: "In Stock",      color: "#00e5a0", cnt: items.filter(i => (Number(i.Stock)||0) > 5).length },
          { label: "Stock Value",   color: "#a78bfa", cnt: `PKR ${fmt(items.reduce((s,i) => s + parseFloat(i.Price||0)*(Number(i.Stock)||0), 0))}` },
        ].map((s, i) => (
          <div key={i} style={{ padding: "11px 17px", background: "rgba(255,255,255,0.025)", border: `1px solid ${s.color}26`, borderRadius: 10 }}>
            <div style={{ color: s.color, fontSize: 21, fontWeight: 800 }}>{s.cnt}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {(() => {
        const expiredItems  = items.filter(i => getExpiryStatus(i.ExpiryDate).status === "expired");
        const criticalItems = items.filter(i => ["critical","today"].includes(getExpiryStatus(i.ExpiryDate).status));
        const warningItems  = items.filter(i => getExpiryStatus(i.ExpiryDate).status === "warning");
        if (!expiredItems.length && !criticalItems.length && !warningItems.length) return null;
        return (
          <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 7 }}>
            {expiredItems.length > 0 && <div style={{ padding: "10px 16px", background: "rgba(255,40,40,0.1)", border: "1px solid rgba(255,40,40,0.4)", borderRadius: 9, display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 18 }}>⛔</span><div><div style={{ color: "#ff4444", fontWeight: 700, fontSize: 12 }}>{expiredItems.length} EXPIRED item(s)</div><div style={{ color: "rgba(255,100,100,0.8)", fontSize: 11 }}>{expiredItems.map(i => i.ItemName).join(", ")}</div></div></div>}
            {criticalItems.length > 0 && <div style={{ padding: "10px 16px", background: "rgba(255,107,0,0.1)", border: "1px solid rgba(255,107,0,0.4)", borderRadius: 9, display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 18 }}>⚠️</span><div><div style={{ color: "#ff6b00", fontWeight: 700, fontSize: 12 }}>{criticalItems.length} item(s) expiring within 7 days</div><div style={{ color: "rgba(255,150,0,0.8)", fontSize: 11 }}>{criticalItems.map(i => `${i.ItemName} (${getExpiryStatus(i.ExpiryDate).label})`).join(", ")}</div></div></div>}
            {warningItems.length > 0 && <div style={{ padding: "10px 16px", background: "rgba(255,200,0,0.08)", border: "1px solid rgba(255,200,0,0.3)", borderRadius: 9, display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 18 }}>🕐</span><div><div style={{ color: "#ffd700", fontWeight: 700, fontSize: 12 }}>{warningItems.length} item(s) expiring within 30 days</div><div style={{ color: "rgba(255,220,0,0.7)", fontSize: 11 }}>{warningItems.map(i => `${i.ItemName} (${getExpiryStatus(i.ExpiryDate).label})`).join(", ")}</div></div></div>}
          </div>
        );
      })()}
      <div style={{ display: "flex", gap: 9, marginBottom: 13, flexWrap: "wrap", alignItems: "center" }}>
        <select value={filterCat}    onChange={e => setFilterCat(e.target.value)}    style={slSt}><option value="All">All Categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <select value={filterCo}     onChange={e => setFilterCo(e.target.value)}     style={slSt}><option value="All">All Companies</option>{companies.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={slSt}>
          <option value="All">All Status</option><option value="out">❌ Out of Stock</option><option value="low">⚠️ Low Stock</option><option value="ok">✅ In Stock</option><option value="expired">⛔ Expired</option><option value="expiring">🕐 Expiring Soon</option>
        </select>
        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>{filtered.length} items</span>
        <button className="btn" onClick={handleDownloadPDF} disabled={pdfLoading || filtered.length === 0}
          style={{ marginLeft: "auto", padding: "9px 18px", background: pdfLoading ? "rgba(255,200,0,0.1)" : "linear-gradient(135deg,#b45309,#fbbf24)", border: "none", color: pdfLoading ? "#fbbf24" : "#000", fontSize: 12, fontWeight: 700, borderRadius: 7, display: "flex", alignItems: "center", gap: 6 }}>
          {pdfLoading ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #fbbf24", borderTop: "2px solid transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Generating...</> : <>📄 Download PDF ({filtered.length} items)</>}
        </button>
      </div>
      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 110px 110px 85px 95px 105px 130px", padding: "8px 12px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>BARCODE</div><div>ITEM</div><div>COMPANY</div><div>CATEGORY</div><div style={{ textAlign: "right" }}>PRICE</div><div style={{ textAlign: "right" }}>STOCK</div><div style={{ textAlign: "center" }}>EXPIRY</div><div style={{ textAlign: "center" }}>ADJUST</div>
        </div>
        {filtered.map((item, i) => { const stk = Number(item.Stock) || 0; const sc = stk <= 0 ? "#ff6b6b" : stk <= 5 ? "#ffd700" : "#00e5a0"; return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr 110px 110px 85px 95px 105px 130px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", background: stk <= 0 ? "rgba(255,50,50,0.03)" : stk <= 5 ? "rgba(255,200,0,0.03)" : "transparent" }}>
            <div style={{ color: "rgba(255,255,255,0.33)", fontSize: 11 }}>{item.Barcode}</div>
            <div style={{ color: "#fff", fontSize: 12 }}>{item.ItemName}</div>
            <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11 }}>{item.Company || "—"}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{item.Category}</div>
            <div style={{ color: "#00b4ff", textAlign: "right", fontSize: 12, fontWeight: 700 }}>{fmt(item.Price)}</div>
            <div style={{ textAlign: "right" }}><span style={{ color: sc, fontWeight: 700, fontSize: 14 }}>{item.Stock}</span>{stk <= 0 && <span style={{ marginLeft: 4, fontSize: 10, color: "#ff6b6b" }}>OUT</span>}{stk > 0 && stk <= 5 && <span style={{ marginLeft: 4, fontSize: 10, color: "#ffd700" }}>LOW</span>}</div>
            {(() => { const es = getExpiryStatus(item.ExpiryDate); return (
              <div style={{ textAlign: "center" }}>
                <div style={{ color: es.color, fontSize: 10, fontWeight: 700 }}>{fmtExpiry(item.ExpiryDate)}</div>
                {item.ExpiryDate && <div style={{ fontSize: 9, color: es.color, opacity: 0.85 }}>{es.label}</div>}
              </div>
            ); })()}
            <div style={{ display: "flex", justifyContent: "center", gap: 5 }}>
              {adjusting === item.Barcode ? (
                <><input type="number" value={adjVal} onChange={e => setAdjVal(e.target.value)} style={{ ...inSt, width: 68, padding: "5px 7px", textAlign: "center" }} autoFocus onKeyDown={e => e.key === "Enter" && doAdjust(item.Barcode)} />
                  <button className="btn" onClick={() => doAdjust(item.Barcode)} style={{ padding: "5px 8px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontSize: 11, borderRadius: 5 }}>✓</button>
                  <button className="btn" onClick={() => setAdjusting(null)} style={{ padding: "5px 7px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.38)", fontSize: 11, borderRadius: 5 }}>✕</button></>
              ) : (
                <button className="btn" onClick={() => { setAdjusting(item.Barcode); setAdjVal(item.Stock); }} style={{ padding: "5px 11px", background: "rgba(0,180,255,0.09)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 11, borderRadius: 5 }}>Set</button>
              )}
            </div>
          </div>
        ); })}
      </div>
    </div>
  );
}


// ── SETUP TAB ─────────────────────────────────────────────────────────────────
export function SetupTab({ sheetStatus, onRefresh, lastSync, safeCallScript }) {
  const [testResults,   setTestResults]   = useState(null);
  const [testing,       setTesting]       = useState(false);
  const [repairing,     setRepairing]     = useState(false);
  const [generating,    setGenerating]    = useState(false);
  const [actionMsg,     setActionMsg]     = useState("");
  const [actionStatus,  setActionStatus]  = useState("");
  const [dbInfo,        setDbInfo]        = useState(null);
  const [expandedSheet, setExpandedSheet] = useState(null);

  const SHEET_META = {
    items:      { label: "📦 Items",       tabName: "Items",      desc: "Products, barcodes, prices, stock & expiry" },
    categories: { label: "🏷 Categories",  tabName: "Categories", desc: "Product category names" },
    cashiers:   { label: "👤 Cashier",     tabName: "Cashier",    desc: "Staff accounts, PINs, roles" },
    sales:      { label: "💰 Sales",       tabName: "Sales",      desc: "Every bill, items sold, totals, payment method" },
    stocklog:   { label: "📉 StockLog",    tabName: "StockLog",   desc: "Stock adjustments and sale deductions log" },
    customers:  { label: "🧑 Customer",    tabName: "Customer",   desc: "Credit customers, payments, opening debit balance" },
    returns:    { label: "↩ Returns",      tabName: "Returns",    desc: "Return and refund records" },
    script:     { label: "⚡ Apps Script", tabName: null,         desc: "Google Apps Script webhook — processes all write operations" },
  };

  const setMsg = (msg, status = "info") => { setActionMsg(msg); setActionStatus(status); };

  const runTest = async () => {
    setTesting(true); setTestResults(null); setActionMsg(""); setExpandedSheet(null);
    const r = await deepTestConnections();
    setTestResults(r);
    setTesting(false);
    const allOk = Object.values(r).every(v => v.ok);
    if (allOk) setMsg("✅ All connections and headers verified successfully!", "ok");
    else {
      const broken = Object.entries(r).filter(([, v]) => !v.ok).map(([k]) => SHEET_META[k]?.label || k);
      setMsg(`⚠ Issues found in: ${broken.join(", ")}`, "error");
    }
  };

  const doRepair = async () => {
    setRepairing(true);
    setMsg("🔧 Sending repair command to script...", "info");
    await autoRepairSheets();
    setMsg("⏳ Waiting 4 seconds for script to process...", "info");
    await new Promise(r => setTimeout(r, 4000));
    setMsg("🔄 Re-testing all connections...", "info");
    const r = await deepTestConnections();
    setTestResults(r);
    setRepairing(false);
    const allOk = Object.values(r).every(v => v.ok);
    setMsg(allOk ? "✅ All headers repaired and verified!" : "⚠ Some issues remain — try Generate Sheets or re-deploy script v8.", allOk ? "ok" : "error");
  };

  const doGenerate = async () => {
    setGenerating(true);
    setMsg("🏗 Sending generate command — creating missing sheets and all headers...", "info");
    await generateAllSheets();
    await new Promise(r => setTimeout(r, 5000));
    setMsg("🔄 Re-testing after generate...", "info");
    const r = await deepTestConnections();
    setTestResults(r);
    setGenerating(false);
    const allOk = Object.values(r).every(v => v.ok);
    setMsg(allOk ? "✅ All sheets generated and verified!" : "⚠ Script may need re-deploy. Download Script v8 and re-deploy.", allOk ? "ok" : "error");
  };

  const downloadScript = () => {
    const txt  = getScriptText();
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "POS_Script_v8.gs";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const checkDB = async () => {
    try {
      const [items, sales, customers, cats, cashiers, rets, queue] = await Promise.all([
        dbGetAll("items"), dbGetAll("sales"), dbGetAll("customers"),
        dbGetAll("categories"), dbGetAll("cashiers"), dbGetAll("returns"),
        dbGetAll("pendingQueue"),
      ]);
      const ls = await dbGetMeta("lastSync");
      setDbInfo({ items: items.length, sales: sales.length, customers: customers.length, categories: cats.length, cashiers: cashiers.length, returns: rets.length, queue: queue.length, lastSync: ls });
    } catch (e) { setDbInfo({ error: e.message }); }
  };

  const clearDB = async () => {
    if (!window.confirm("Clear all local offline data?\n\n✅ Database data stays safe — this only clears the browser cache.\n\nYou will need internet to reload data.")) return;
    for (const s of ["items","categories","cashiers","sales","customers","returns","stocklog","meta","pendingQueue"])
      await dbClear(s).catch(() => {});
    setDbInfo(null);
    alert("✅ Local cache cleared. Please refresh the page to reload from Database.");
  };

  const allOk = testResults && Object.values(testResults).every(v => v.ok);
  const hasIssues = testResults && !allOk;

  const spinnerStyle = { width: 12, height: 12, border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid #fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" };

  return (
    <div style={{ maxWidth: 780 }}>

      {/* OFFLINE DB */}
      <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>💾 OFFLINE DATABASE (IndexedDB)</div>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 3 }}>Local cache for offline &amp; instant load</div>
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn" onClick={checkDB} style={{ padding: "7px 14px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.25)", color: "#00b4ff", fontSize: 11, borderRadius: 6 }}>Check DB</button>
            <button className="btn" onClick={clearDB} style={{ padding: "7px 14px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.25)", color: "#ff6b6b", fontSize: 11, borderRadius: 6 }}>Clear Cache</button>
          </div>
        </div>
        {dbInfo && (dbInfo.error
          ? <div style={{ color: "#ff6b6b", fontSize: 12 }}>Error: {dbInfo.error}</div>
          : <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 9, marginBottom: 10 }}>
              {[["Items",dbInfo.items,"#00b4ff"],["Sales",dbInfo.sales,"#00e5a0"],["Customers",dbInfo.customers,"#a78bfa"],["Categories",dbInfo.categories,"#ffd700"],["Cashiers",dbInfo.cashiers,"#00b4ff"],["Returns",dbInfo.returns,"#ff9500"],["Pending Queue",dbInfo.queue, dbInfo.queue > 0 ? "#ffd700" : "#00e5a0"],["Last Sync",dbInfo.lastSync ? new Date(dbInfo.lastSync).toLocaleTimeString("en-PK") : "Never","rgba(255,255,255,0.5)"]].map(([l,v,c]) => (
                <div key={l} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 11px" }}>
                  <div style={{ color: "rgba(0,180,255,0.6)", fontSize: 9, letterSpacing: 1, marginBottom: 3 }}>{l.toUpperCase()}</div>
                  <div style={{ color: c || "#fff", fontWeight: 700, fontSize: 14 }}>{v}</div>
                </div>
              ))}
            </div>
        )}
        {!dbInfo && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Click "Check DB" to inspect local cache.</div>}
        <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, lineHeight: 1.7, marginTop: 8 }}>
          Loads instantly on startup · Syncs in background · Offline sales queued &amp; auto-sent · Per-browser cache — multiple PCs sync via Database
        </div>
      </div>

      {/* CONNECTION TEST */}
      <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 12, padding: 20, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>🔌 DATABASE CONNECTION &amp; HEADER TEST</div>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 3 }}>Tests every sheet tab · checks reachability, row count &amp; all required headers</div>
          </div>
          <button className="btn" onClick={runTest} disabled={testing || repairing || generating}
            style={{ padding: "10px 22px", background: testing ? "rgba(0,180,255,0.15)" : "linear-gradient(135deg,#0062ff,#00b4ff)", border: "none", color: "#fff", fontSize: 13, borderRadius: 8, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
            {testing ? <><span style={spinnerStyle} />Testing all sheets...</> : "▶ Run Full Test"}
          </button>
        </div>

        {/* Sheet results */}
        {testResults && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {Object.entries(SHEET_META).map(([key, { label, tabName, desc }]) => {
              const r = testResults[key] || { ok: false, reachable: false, headers: [], missingHeaders: [], extraInfo: "" };
              const isExp = expandedSheet === key;
              const borderColor = r.ok ? "rgba(0,220,0,0.4)" : r.reachable ? "rgba(255,200,0,0.4)" : "rgba(255,80,80,0.4)";
              const bgColor     = r.ok ? "rgba(0,180,0,0.05)" : r.reachable ? "rgba(255,180,0,0.04)" : "rgba(255,50,50,0.05)";
              return (
                <div key={key} style={{ background: bgColor, border: `2px solid ${borderColor}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", cursor: r.headers?.length > 0 ? "pointer" : "default" }}
                    onClick={() => r.headers?.length > 0 && setExpandedSheet(isExp ? null : key)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 22 }}>{r.ok ? "✅" : r.reachable ? "⚠️" : "❌"}</span>
                      <div>
                        <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{label}</div>
                        <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 10 }}>{desc}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: r.ok ? "#00e080" : r.reachable ? "#ffd700" : "#ff7070", fontSize: 11, fontWeight: 600, maxWidth: 240 }}>{r.extraInfo}</div>
                        {tabName && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>Tab: <code style={{ background: "rgba(255,255,255,0.07)", padding: "1px 5px", borderRadius: 3, color: "rgba(255,255,255,0.55)" }}>{tabName}</code></div>}
                      </div>
                      {r.headers?.length > 0 && <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, userSelect: "none" }}>{isExp ? "▲" : "▼"}</span>}
                    </div>
                  </div>

                  {isExp && (
                    <div style={{ padding: "0 16px 14px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      {r.headers?.length > 0 && (
                        <>
                          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, letterSpacing: 1.2, margin: "10px 0 7px" }}>HEADERS ON SHEET</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {r.headers.map(h => {
                              const req = (REQUIRED_HEADERS[key] || []).includes(h);
                              return (
                                <span key={h} style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                                  background: req ? "rgba(0,220,0,0.08)" : "rgba(255,200,0,0.08)",
                                  border: `1px solid ${req ? "rgba(0,220,0,0.3)" : "rgba(255,200,0,0.3)"}`,
                                  color: req ? "#00e5a0" : "#ffd700" }}>
                                  {h} {req ? "✓" : "⊕"}
                                </span>
                              );
                            })}
                          </div>
                        </>
                      )}
                      {r.missingHeaders?.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ color: "rgba(255,80,80,0.7)", fontSize: 10, letterSpacing: 1.2, marginBottom: 7 }}>MISSING — WILL BE ADDED BY AUTO-REPAIR</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {r.missingHeaders.map(h => (
                              <span key={h} style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.35)", color: "#ff8080" }}>
                                {h} ✗
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {r.extraHeaders?.length > 0 && (
                        <div style={{ marginTop: 8, color: "rgba(255,200,0,0.55)", fontSize: 10 }}>
                          ⊕ Extra columns (not required, will not be touched): {r.extraHeaders.join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Status message */}
        {actionMsg && (
          <div style={{ marginBottom: 14, padding: "11px 15px", borderRadius: 9,
            background: actionStatus === "ok" ? "rgba(0,200,0,0.07)" : actionStatus === "error" ? "rgba(255,80,80,0.08)" : "rgba(0,180,255,0.07)",
            border: `1px solid ${actionStatus === "ok" ? "rgba(0,200,0,0.3)" : actionStatus === "error" ? "rgba(255,80,80,0.25)" : "rgba(0,180,255,0.25)"}`,
            color: actionStatus === "ok" ? "#00e5a0" : actionStatus === "error" ? "#ff9090" : "rgba(255,255,255,0.8)", fontSize: 12 }}>
            {actionMsg}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          {testResults && hasIssues && (
            <button className="btn" onClick={doRepair} disabled={repairing || testing || generating}
              style={{ padding: "10px 20px", background: repairing ? "rgba(0,200,0,0.1)" : "linear-gradient(135deg,#00a651,#00e5a0)", border: "none", color: repairing ? "#00e5a0" : "#000", fontSize: 12, fontWeight: 700, borderRadius: 7, display: "flex", alignItems: "center", gap: 6 }}>
              {repairing ? <><span style={{ ...spinnerStyle, borderColor: "rgba(0,200,0,0.4)", borderTopColor: "#00e5a0" }} />Repairing...</> : "🔧 Auto-Repair Headers"}
            </button>
          )}
          <button className="btn" onClick={doGenerate} disabled={generating || testing || repairing}
            style={{ padding: "10px 20px", background: generating ? "rgba(160,100,255,0.1)" : "linear-gradient(135deg,#7c3aed,#a78bfa)", border: "none", color: generating ? "#a78bfa" : "#fff", fontSize: 12, fontWeight: 700, borderRadius: 7, display: "flex", alignItems: "center", gap: 6 }}>
            {generating ? <><span style={{ ...spinnerStyle, borderColor: "rgba(167,139,250,0.4)", borderTopColor: "#a78bfa" }} />Generating...</> : "🏗 Generate / Fix All Sheets"}
          </button>
          {testResults && (
            <button className="btn" onClick={runTest} disabled={testing || repairing || generating}
              style={{ padding: "10px 16px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.3)", color: "#00b4ff", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>
              🔄 Re-Test
            </button>
          )}
          <button className="btn" onClick={downloadScript}
            style={{ padding: "10px 18px", background: "rgba(255,200,0,0.1)", border: "1px solid rgba(255,200,0,0.3)", color: "#ffd700", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>
            📥 Script v8 (.gs)
          </button>
          <button className="btn" onClick={async () => {
            setMsg("🔄 Deduplicating customer sheet...", "info");
            await safeCallScript({ action: "deduplicateCustomers" });
            await new Promise(r => setTimeout(r, 3000));
            setMsg("✅ Customer sheet deduplicated! Sync now to reload.", "ok");
          }}
            style={{ padding: "10px 18px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff9090", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>
            🧹 Fix Duplicate Customers
          </button>
          {!testResults && (
            <button className="btn" onClick={runTest} disabled={testing}
              style={{ padding: "10px 20px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.3)", color: "#00b4ff", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>
              ▶ Run Full Test
            </button>
          )}
        </div>

        {!testResults && !testing && (
          <div style={{ marginTop: 12, color: "rgba(255,255,255,0.28)", fontSize: 12 }}>
            ↑ Run test to verify all 7 sheet tabs + script. Click any result row to expand header details.
          </div>
        )}
      </div>

      {/* SYNC STATUS */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ color: "#ffd700", fontWeight: 700, fontSize: 12, marginBottom: 10 }}>🔄 LIVE SYNC STATUS</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
            Database:&nbsp;
            <span style={{ color: sheetStatus === "loaded" ? "#00e080" : sheetStatus === "error" ? "#ff6b6b" : "#ffd700", fontWeight: 700 }}>
              {sheetStatus === "loaded" ? "✓ LIVE" : sheetStatus === "cached" ? "💾 CACHED" : sheetStatus === "error" ? "✗ ERROR" : "◉ DEMO"}
            </span>
          </span>
          {lastSync && <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>Last: {lastSync.toLocaleString("en-PK")}</span>}
          <button className="btn" onClick={onRefresh} style={{ padding: "7px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, borderRadius: 7, fontWeight: 700 }}>🔄 Sync Now</button>
        </div>
      </div>

      {/* LICENSE */}
      <div style={{ background: "rgba(255,200,0,0.04)", border: "1px solid rgba(255,200,0,0.22)", borderRadius: 12, padding: 20 }}>
        <div style={{ color: "#ffd700", fontWeight: 700, fontSize: 13, marginBottom: 14 }}>📋 SOFTWARE LICENSE &amp; PAYMENT TERMS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          {[["1st Installation Fee","PKR 15,000"],["Annual Fee","PKR 10,000"],["Monthly Fee","PKR 2,000"],["Due Date","5th of Each Month"]].map(([l,v]) => (
            <div key={l} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 14px", border: "1px solid rgba(255,200,0,0.15)" }}>
              <div style={{ color: "rgba(255,200,0,0.7)", fontSize: 10, letterSpacing: 1, marginBottom: 3 }}>{l}</div>
              <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "Orbitron" }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ background: "rgba(0,180,255,0.05)", border: "1px solid rgba(0,180,255,0.18)", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 12, marginBottom: 8 }}>💳 PAYMENT METHOD</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 2.1 }}>
            Bank: <b style={{ color: "#fff" }}>Bank Alfalah</b><br />
            Account#: <b style={{ color: "#ffd700", fontFamily: "monospace", letterSpacing: 2 }}>0203-1005098235</b><br />
            Account Name: <b style={{ color: "#fff" }}>Mian Ahmed Umer</b>
          </div>
        </div>
      </div>

    </div>
  );
}
