import { useState } from "react";
import { inSt, slSt, lbSt } from "../config";
import { fmt, getExpiryStatus, fmtExpiry } from "../utils/helpers";
import { dbPut, dbGetAll, dbGet, dbClear, dbGetMeta } from "../utils/db";
import { deepTestConnections, autoRepairSheets } from "../utils/api";
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
  const [testResults, setTestResults] = useState(null); const [testing, setTesting] = useState(false); const [repairing, setRepairing] = useState(false); const [repairMsg, setRepairMsg] = useState("");
  const [dbInfo, setDbInfo] = useState(null);
  const runTest   = async () => { setTesting(true); setTestResults(null); setRepairMsg(""); const r = await deepTestConnections(); setTestResults(r); setTesting(false); };
  const doRepair  = async () => { setRepairing(true); setRepairMsg("Sending repair request..."); await autoRepairSheets(); setRepairMsg("✅ Sent! Waiting 3s..."); await new Promise(r => setTimeout(r, 3000)); const r = await deepTestConnections(); setTestResults(r); setRepairing(false); const allOk = Object.values(r).every(v => v.ok); setRepairMsg(allOk ? "✅ All fixed!" : "⚠ Some issues remain."); };
  const downloadScript = () => { const txt = getScriptText(); const blob = new Blob([txt], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "POS_Script_v7.gs"; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); };
  const checkDB = async () => {
    try {
      const items     = await dbGetAll("items");
      const sales     = await dbGetAll("sales");
      const customers = await dbGetAll("customers");
      const queue     = await dbGetAll("pendingQueue");
      const lastSync  = await dbGetMeta("lastSync");
      setDbInfo({ items: items.length, sales: sales.length, customers: customers.length, queue: queue.length, lastSync });
    } catch (e) { setDbInfo({ error: e.message }); }
  };
  const clearDB = async () => {
    if (!window.confirm("Clear all local offline data? (Database data stays safe)")) return;
    const stores = ["items","categories","cashiers","sales","customers","returns","stocklog","meta"];
    for (const s of stores) await dbClear(s);
    setDbInfo(null);
    alert("Local cache cleared. Refresh to reload from Database.");
  };
  const allOk = testResults && Object.values(testResults).every(v => v.ok);
  const SHEET_LABELS = { items:{label:"📦 Items",tabName:"Items"}, categories:{label:"🏷 Categories",tabName:"Categories"}, cashiers:{label:"👤 Cashier",tabName:"Cashier"}, sales:{label:"💰 Sales",tabName:"Sales"}, stocklog:{label:"📉 StockLog",tabName:"StockLog"}, customers:{label:"🧑 Customer",tabName:"Customer"}, returns:{label:"↩ Returns",tabName:"Returns"}, script:{label:"⚡ Apps Script",tabName:null} };
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div><div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>💾 OFFLINE DATABASE (IndexedDB)</div><div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 3 }}>Local cache for offline & fast load</div></div>
          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn" onClick={checkDB} style={{ padding: "7px 14px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.25)", color: "#00b4ff", fontSize: 11, borderRadius: 6 }}>Check DB</button>
            <button className="btn" onClick={clearDB} style={{ padding: "7px 14px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.25)", color: "#ff6b6b", fontSize: 11, borderRadius: 6 }}>Clear Cache</button>
          </div>
        </div>
        {dbInfo && (dbInfo.error ? <div style={{ color: "#ff6b6b", fontSize: 12 }}>Error: {dbInfo.error}</div> :
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 9 }}>
            {[["Items",dbInfo.items],["Sales",dbInfo.sales],["Customers",dbInfo.customers],["Pending Queue",dbInfo.queue],["Last Sync",dbInfo.lastSync ? new Date(dbInfo.lastSync).toLocaleTimeString("en-PK") : "Never"]].map(([l,v]) => (
              <div key={l} style={{ background: "rgba(255,255,255,0.025)", borderRadius: 8, padding: "9px 12px" }}><div style={{ color: "rgba(0,180,255,0.7)", fontSize: 10 }}>{l}</div><div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{v}</div></div>
            ))}
          </div>
        )}
        {!dbInfo && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Click "Check DB" to see local cache status.</div>}
        <div style={{ marginTop: 10, color: "rgba(255,255,255,0.3)", fontSize: 11, lineHeight: 1.7 }}>Data loads from local cache instantly on startup. Database syncs in background. Offline sales are queued and sent automatically when internet returns.<br />⚠ IndexedDB is per-browser/PC. Multiple PCs sync via Database.</div>
      </div>
      <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 12, padding: 20, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div><div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>🔌 CONNECTION & HEADERS TEST</div></div>
          <button className="btn" onClick={runTest} disabled={testing || repairing} style={{ padding: "8px 18px", background: testing ? "rgba(0,180,255,0.1)" : "linear-gradient(135deg,#0062ff,#00b4ff)", border: "none", color: "#fff", fontSize: 12, borderRadius: 7, fontWeight: 700 }}>{testing ? "⏳ Testing..." : "▶ Run Test"}</button>
        </div>
        {testResults && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {Object.entries(SHEET_LABELS).map(([key, { label, tabName }]) => {
                const r = testResults[key] || { ok: false, reachable: false, missingHeaders: [], extraInfo: "" };
                return (
                  <div key={key} style={{ padding: "12px 16px", background: "rgba(255,255,255,0.025)", border: `1px solid ${r.ok ? "rgba(0,200,0,0.3)" : r.reachable ? "rgba(255,200,0,0.3)" : "rgba(255,80,80,0.3)"}`, borderRadius: 9 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ fontSize: 22 }}>{r.ok ? "✅" : r.reachable ? "⚠️" : "❌"}</div>
                        <div><div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{label}</div><div style={{ color: r.ok ? "#00e080" : r.reachable ? "#ffd700" : "#ff6b6b", fontSize: 11 }}>{r.ok ? r.extraInfo : r.extraInfo || "Not reachable"}</div></div>
                      </div>
                      {tabName && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)" }}>Tab: <code style={{ color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: 4 }}>{tabName}</code></div>}
                    </div>
                  </div>
                );
              })}
            </div>
            {!allOk && (
              <div style={{ display: "flex", gap: 9 }}>
                <button className="btn" onClick={doRepair} disabled={repairing} style={{ padding: "9px 18px", background: "linear-gradient(135deg,#00a651,#00e5a0)", border: "none", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>{repairing ? "⏳ Repairing..." : "🔧 Auto-Repair"}</button>
                <button className="btn" onClick={downloadScript} style={{ padding: "9px 18px", background: "rgba(255,200,0,0.1)", border: "1px solid rgba(255,200,0,0.3)", color: "#ffd700", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>📥 Download Script v7</button>
              </div>
            )}
            {repairMsg && <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "rgba(0,180,255,0.07)", border: "1px solid rgba(0,180,255,0.2)", color: "rgba(255,255,255,0.8)", fontSize: 12 }}>{repairMsg}</div>}
          </>
        )}
        {!testResults && !testing && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Click ▶ Run Test to check all connections.</div>}
      </div>
      <div style={{ background: "rgba(255,200,0,0.04)", border: "1px solid rgba(255,200,0,0.2)", borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ color: "#ffd700", fontWeight: 700, fontSize: 12, marginBottom: 10 }}>📥 APPS SCRIPT - Download & Deploy</div>
        <button className="btn" onClick={downloadScript} style={{ padding: "10px 22px", background: "linear-gradient(135deg,#ffd700,#ff8c00)", color: "#000", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>📥 Download Script v7 (.gs)</button>
      </div>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ color: "#ffd700", fontWeight: 700, fontSize: 12, marginBottom: 10 }}>🔄 SYNC STATUS</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>Sheet: <span style={{ color: sheetStatus === "loaded" ? "#00e080" : sheetStatus === "error" ? "#ff6b6b" : "#ffd700", fontWeight: 700 }}>{sheetStatus === "loaded" ? "✓ LIVE" : sheetStatus === "cached" ? "💾 CACHED" : sheetStatus === "error" ? "✗ ERROR" : "◉ DEMO"}</span></div>
          {lastSync && <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Last: {lastSync.toLocaleString("en-PK")}</div>}
          <button className="btn" onClick={onRefresh} style={{ padding: "7px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, borderRadius: 7, fontWeight: 700 }}>🔄 Sync Now</button>
        </div>
      </div>
      <div style={{ background: "rgba(255,200,0,0.04)", border: "1px solid rgba(255,200,0,0.22)", borderRadius: 12, padding: 20 }}>
        <div style={{ color: "#ffd700", fontWeight: 700, fontSize: 13, marginBottom: 14 }}>📋 SOFTWARE LICENSE & PAYMENT TERMS</div>
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
