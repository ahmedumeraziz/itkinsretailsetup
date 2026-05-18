import { useState } from "react";
import { T, inSt, slSt, REQUIRED_HEADERS } from "../config";
import { fmt, getExpiryStatus, fmtExpiry } from "../utils/helpers";
import { dbPut, dbGetAll, dbClear, dbGetMeta } from "../utils/db";
import { deepTestConnections, autoRepairSheets, generateAllSheets } from "../utils/api";
import { getScriptText } from "../utils/appsScript";
import { downloadStockPDF } from "../utils/print";

const card = { background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, overflow: "hidden", boxShadow: T.shadow };
const thSt = { padding: "9px 12px", background: T.bgTopBar, color: "rgba(255,255,255,0.85)", fontSize: 10, letterSpacing: 1.5, fontWeight: 700 };

function SummaryCard({ label, value, color, bg, border }) {
  return (
    <div style={{ padding: "12px 18px", background: bg, border: `1px solid ${border}`, borderRadius: 10 }}>
      <div style={{ color, fontSize: 22, fontWeight: 800 }}>{value}</div>
      <div style={{ color: T.textMuted, fontSize: 11, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ── STOCK TAB ─────────────────────────────────────────────────────────────────
export function StockTab({ items, setItems, safeCallScript }) {
  const [adjusting,    setAdjusting]    = useState(null);
  const [adjPieces,    setAdjPieces]    = useState("");
  const [adjCottons,   setAdjCottons]   = useState("0");
  const [adjBoxes,     setAdjBoxes]     = useState("0");
  const [adjLoose,     setAdjLoose]     = useState("0");
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
  }).sort((a,b) => (Number(a.Stock)||0) - (Number(b.Stock)||0));

  // ── VU helpers ─────────────────────────────────────────────────────────────
  const isVU = item => !!(item.variable_unit_enabled &&
    parseInt(item.pieces_per_box) > 0 && parseInt(item.boxes_per_cotton) > 0);

  const resolveStock = (totalPieces, ppb, bpc) => {
    const ppc     = ppb * bpc;
    const cottons = Math.floor(totalPieces / ppc);
    const rem     = totalPieces % ppc;
    const boxes   = Math.floor(rem / ppb);
    const loose   = rem % ppb;
    return { cottons, boxes, loose };
  };

  const unitsToTotal = (c, b, l, ppb, bpc) =>
    (parseInt(c)||0)*ppb*bpc + (parseInt(b)||0)*ppb + (parseInt(l)||0);

  // Typing in a unit field → auto-update total pieces
  const onUnitChange = (field, val, item) => {
    const ppb = parseInt(item.pieces_per_box)||1;
    const bpc = parseInt(item.boxes_per_cotton)||1;
    let c = parseInt(adjCottons)||0;
    let b = parseInt(adjBoxes)  ||0;
    let l = parseInt(adjLoose)  ||0;
    if (field==="c") c = Math.max(0, parseInt(val)||0);
    if (field==="b") b = Math.max(0, parseInt(val)||0);
    if (field==="l") l = Math.max(0, parseInt(val)||0);
    setAdjCottons(String(c));
    setAdjBoxes(String(b));
    setAdjLoose(String(l));
    setAdjPieces(String(unitsToTotal(c, b, l, ppb, bpc)));
  };

  // Typing total pieces → auto-resolve into units
  const onPiecesChange = (val, item) => {
    setAdjPieces(val);
    if (!isVU(item)) return;
    const ppb = parseInt(item.pieces_per_box)||1;
    const bpc = parseInt(item.boxes_per_cotton)||1;
    const { cottons, boxes, loose } = resolveStock(Math.max(0, parseInt(val)||0), ppb, bpc);
    setAdjCottons(String(cottons));
    setAdjBoxes(String(boxes));
    setAdjLoose(String(loose));
  };

  const startAdjust = item => {
    const stk = Number(item.Stock)||0;
    setAdjusting(item.Barcode);
    setAdjPieces(String(stk));
    if (isVU(item)) {
      const ppb = parseInt(item.pieces_per_box)||1;
      const bpc = parseInt(item.boxes_per_cotton)||1;
      const { cottons, boxes, loose } = resolveStock(stk, ppb, bpc);
      setAdjCottons(String(cottons));
      setAdjBoxes(String(boxes));
      setAdjLoose(String(loose));
    }
  };

  const doAdjust = async bc => {
    const n = parseInt(adjPieces);
    if (isNaN(n) || n < 0) return;
    const old    = items.find(i => i.Barcode === bc);
    const before = Number(old?.Stock)||0;
    setItems(p => p.map(i => i.Barcode===bc ? {...i, Stock: String(n)} : i));
    try { await dbPut("items", {...old, Stock: String(n), id: bc}); } catch {}
    safeCallScript({ action:"adjustStock", Barcode:bc, AdjustType:"set", Value:n, Reason:"Admin Manual", Before:before, After:n, ItemName:old?.ItemName||bc });
    setAdjusting(null); setAdjPieces(""); setAdjCottons("0"); setAdjBoxes("0"); setAdjLoose("0");
  };

  const handleDownloadPDF = async () => {
    setPdfLoading(true);
    try { await downloadStockPDF(filtered, filterCat, filterCo, filterStatus); } catch(e) { alert("PDF error: "+e.message); }
    finally { setPdfLoading(false); }
  };

  const numIn = (val, onChange, color, label) => (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <span style={{fontSize:9,color,fontWeight:700,letterSpacing:1}}>{label}</span>
      <input type="number" min="0" value={val} onChange={e=>onChange(e.target.value)}
        onFocus={e=>e.target.select()}
        style={{width:50,padding:"4px",background:T.bgCard,border:`1.5px solid ${color}`,borderRadius:6,
          color:T.textPrimary,fontSize:13,fontWeight:700,textAlign:"center",outline:"none"}}/>
    </div>
  );

  return (
    <div>
      {/* Summary */}
      <div style={{display:"flex",gap:11,marginBottom:16,flexWrap:"wrap"}}>
        <SummaryCard label="Out of Stock"   value={items.filter(i=>(Number(i.Stock)||0)<=0).length}                          color={T.danger}  bg={T.dangerLight}  border={T.dangerBorder}  />
        <SummaryCard label="Low Stock (≤5)" value={items.filter(i=>(Number(i.Stock)||0)>0&&(Number(i.Stock)||0)<=5).length}  color={T.warning} bg={T.warningLight} border={T.warningBorder} />
        <SummaryCard label="In Stock"       value={items.filter(i=>(Number(i.Stock)||0)>5).length}                           color={T.success} bg={T.successLight} border={T.successBorder} />
        <SummaryCard label="Stock Value"    value={`PKR ${fmt(items.reduce((s,i)=>s+parseFloat(i.Price||0)*(Number(i.Stock)||0),0))}`} color={T.accent} bg={T.accentLight} border={T.accentBorder} />
      </div>

      {/* Expiry alerts */}
      {(()=>{
        const exp  = items.filter(i=>getExpiryStatus(i.ExpiryDate).status==="expired");
        const crit = items.filter(i=>["critical","today"].includes(getExpiryStatus(i.ExpiryDate).status));
        if(!exp.length&&!crit.length) return null;
        return (
          <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:14}}>
            {exp.length>0&&<div style={{padding:"10px 16px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,borderRadius:9,display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:18}}>⛔</span><div><div style={{color:T.danger,fontWeight:700,fontSize:12}}>{exp.length} EXPIRED item(s)</div><div style={{color:T.danger,fontSize:11,opacity:0.8}}>{exp.map(i=>i.ItemName).join(", ")}</div></div></div>}
            {crit.length>0&&<div style={{padding:"10px 16px",background:T.warningLight,border:`1px solid ${T.warningBorder}`,borderRadius:9,display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:18}}>⚠️</span><div><div style={{color:T.warning,fontWeight:700,fontSize:12}}>{crit.length} item(s) expiring within 7 days</div><div style={{color:T.warning,fontSize:11,opacity:0.8}}>{crit.map(i=>`${i.ItemName} (${getExpiryStatus(i.ExpiryDate).label})`).join(", ")}</div></div></div>}
          </div>
        );
      })()}

      {/* Filters */}
      <div style={{display:"flex",gap:9,marginBottom:13,flexWrap:"wrap",alignItems:"center"}}>
        <select value={filterCat}    onChange={e=>setFilterCat(e.target.value)}    style={{...slSt,background:T.bgCard}}><option value="All">All Categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select>
        <select value={filterCo}     onChange={e=>setFilterCo(e.target.value)}     style={{...slSt,background:T.bgCard}}><option value="All">All Companies</option>{companies.map(c=><option key={c}>{c}</option>)}</select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...slSt,background:T.bgCard}}>
          <option value="All">All Status</option><option value="out">❌ Out of Stock</option><option value="low">⚠️ Low Stock</option><option value="ok">✅ In Stock</option><option value="expired">⛔ Expired</option><option value="expiring">🕐 Expiring Soon</option>
        </select>
        <span style={{color:T.textMuted,fontSize:12}}>{filtered.length} items</span>
        <button className="btn" onClick={handleDownloadPDF} disabled={pdfLoading||filtered.length===0}
          style={{marginLeft:"auto",padding:"9px 18px",background:"linear-gradient(135deg,#b45309,#d97706)",color:"#fff",fontSize:12,fontWeight:700,borderRadius:7,border:"none",display:"flex",alignItems:"center",gap:6}}>
          {pdfLoading?<><span style={{width:12,height:12,border:"2px solid rgba(255,255,255,0.4)",borderTop:"2px solid #fff",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}}/>Generating...</>:<>📄 Download PDF ({filtered.length})</>}
        </button>
      </div>

      {/* Table */}
      <div style={card}>
        <div style={{display:"grid",gridTemplateColumns:"100px 1fr 95px 95px 75px 210px 100px 160px",...thSt}}>
          <div>BARCODE</div><div>ITEM</div><div>COMPANY</div><div>CATEGORY</div>
          <div style={{textAlign:"right"}}>PRICE</div>
          <div style={{textAlign:"center"}}>STOCK · Cotton · Box · Pcs</div>
          <div style={{textAlign:"center"}}>EXPIRY</div>
          <div style={{textAlign:"center"}}>ADJUST</div>
        </div>
        {filtered.map((item,i)=>{
          const stk    = Number(item.Stock)||0;
          const sc     = stk<=0?T.danger:stk<=5?T.warning:T.success;
          const rowBg  = stk<=0?T.dangerLight:stk<=5?T.warningLight:"transparent";
          const vu     = isVU(item);
          const ppb    = parseInt(item.pieces_per_box)||1;
          const bpc    = parseInt(item.boxes_per_cotton)||1;
          const { cottons=0, boxes=0, loose=0 } = vu ? resolveStock(stk,ppb,bpc) : {};
          const isAdj  = adjusting === item.Barcode;
          return(
            <div key={i} style={{display:"grid",gridTemplateColumns:"100px 1fr 95px 95px 75px 210px 100px 160px",
              padding:"9px 12px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",background:rowBg}}>

              <div style={{color:T.textMuted,fontSize:11}}>{item.Barcode}</div>
              <div>
                <div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{item.ItemName}</div>
                {vu&&<div style={{fontSize:9,color:"#7c3aed",marginTop:2,fontWeight:600}}>📦 {ppb}pcs/box · {bpc}box/cotton</div>}
              </div>
              <div style={{color:T.accent,fontSize:11}}>{item.Company||"—"}</div>
              <div style={{color:T.textSecondary,fontSize:11}}>{item.Category}</div>
              <div style={{color:T.accent,textAlign:"right",fontSize:12,fontWeight:700}}>PKR {fmt(item.Price)}</div>

              {/* Stock column */}
              <div style={{textAlign:"center"}}>
                {vu ? (
                  <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                    <span style={{background:"#f3e8ff",color:"#7c3aed",border:"1px solid #ddd6fe",borderRadius:8,fontSize:11,padding:"2px 7px",fontWeight:700,whiteSpace:"nowrap"}}>{cottons}C</span>
                    <span style={{color:T.textMuted,fontSize:9}}>·</span>
                    <span style={{background:T.accentLight,color:T.accent,border:`1px solid ${T.accentBorder}`,borderRadius:8,fontSize:11,padding:"2px 7px",fontWeight:700,whiteSpace:"nowrap"}}>{boxes}B</span>
                    <span style={{color:T.textMuted,fontSize:9}}>·</span>
                    <span style={{background:"#fff7ed",color:T.posOrange,border:"1px solid #fed7aa",borderRadius:8,fontSize:11,padding:"2px 7px",fontWeight:700,whiteSpace:"nowrap"}}>{loose}P</span>
                    <span style={{color:T.textMuted,fontSize:10}}>= <b style={{color:sc}}>{stk}</b></span>
                  </div>
                ) : (
                  <div>
                    <span style={{color:sc,fontWeight:700,fontSize:14}}>{item.Stock}</span>
                    {stk<=0&&<span style={{marginLeft:4,fontSize:9,color:T.danger,fontWeight:700,background:T.dangerLight,padding:"1px 5px",borderRadius:10}}>OUT</span>}
                    {stk>0&&stk<=5&&<span style={{marginLeft:4,fontSize:9,color:T.warning,fontWeight:700,background:T.warningLight,padding:"1px 5px",borderRadius:10}}>LOW</span>}
                  </div>
                )}
              </div>

              {/* Expiry */}
              {(()=>{const es=getExpiryStatus(item.ExpiryDate);return(
                <div style={{textAlign:"center"}}>
                  <div style={{color:es.color,fontSize:10,fontWeight:700}}>{fmtExpiry(item.ExpiryDate)}</div>
                  {item.ExpiryDate&&<div style={{fontSize:9,color:es.color,opacity:0.85}}>{es.label}</div>}
                </div>);})()}

              {/* Adjust */}
              <div style={{display:"flex",justifyContent:"center"}}>
                {isAdj ? (
                  <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"center"}}>
                    {vu ? (
                      <div style={{display:"flex",gap:4,alignItems:"flex-end",flexWrap:"wrap",justifyContent:"center"}}>
                        {numIn(adjCottons, v=>onUnitChange("c",v,item), "#7c3aed",   "Cotton")}
                        {numIn(adjBoxes,   v=>onUnitChange("b",v,item), T.accent,    "Box")}
                        {numIn(adjLoose,   v=>onUnitChange("l",v,item), T.posOrange, "Pcs")}
                        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                          <span style={{fontSize:9,color:"#d97706",fontWeight:700}}>TOTAL</span>
                          <input type="number" min="0" value={adjPieces}
                            onChange={e=>onPiecesChange(e.target.value,item)}
                            onFocus={e=>e.target.select()}
                            style={{width:50,padding:"4px",background:"#fffbeb",border:"1.5px solid #d97706",
                              borderRadius:6,color:T.textPrimary,fontSize:13,fontWeight:700,textAlign:"center",outline:"none"}}/>
                        </div>
                      </div>
                    ) : (
                      <input type="number" value={adjPieces} onChange={e=>setAdjPieces(e.target.value)}
                        style={{...inSt,width:72,padding:"5px 7px",textAlign:"center",background:T.bgCard}}
                        autoFocus onKeyDown={e=>e.key==="Enter"&&doAdjust(item.Barcode)}/>
                    )}
                    <div style={{display:"flex",gap:4}}>
                      <button className="btn" onClick={()=>doAdjust(item.Barcode)}
                        style={{padding:"4px 10px",background:"linear-gradient(135deg,#047857,#059669)",color:"#fff",fontSize:11,borderRadius:5,border:"none",fontWeight:600}}>✓ Set</button>
                      <button className="btn" onClick={()=>setAdjusting(null)}
                        style={{padding:"4px 8px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,fontSize:11,borderRadius:5}}>✕</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn" onClick={()=>startAdjust(item)}
                    style={{padding:"5px 13px",background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:11,borderRadius:6,fontWeight:600}}>Set</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
    items:      { label:"📦 Items",       tabName:"Items",      desc:"Products, barcodes, prices, stock, expiry & variable unit config" },
    categories: { label:"🏷 Categories",  tabName:"Categories", desc:"Product category names" },
    sales:      { label:"💰 Sales",       tabName:"Sales",      desc:"Bills, items sold, totals, payment method" },
    stocklog:   { label:"📉 StockLog",    tabName:"StockLog",   desc:"Stock adjustments and deductions log" },
    customers:  { label:"🧑 Customer",    tabName:"Customer",   desc:"Credit customers, payments, opening debit" },
    returns:    { label:"↩ Returns",      tabName:"Returns",    desc:"Return and refund records" },
    hr:         { label:"🧑‍💼 HR",          tabName:"HR",         desc:"Investments, expenses, returns & monthly notes" },
    script:     { label:"⚡ Apps Script", tabName:null,         desc:"Google Apps Script webhook" },
  };

  const setMsg = (msg, status="info") => { setActionMsg(msg); setActionStatus(status); };

  const runTest = async () => {
    setTesting(true); setTestResults(null); setActionMsg(""); setExpandedSheet(null);
    const r = await deepTestConnections();
    setTestResults(r); setTesting(false);
    const allOk = Object.values(r).every(v=>v.ok);
    if (allOk) setMsg("✅ All connections and headers verified!", "ok");
    else { const broken=Object.entries(r).filter(([,v])=>!v.ok).map(([k])=>SHEET_META[k]?.label||k); setMsg(`⚠ Issues in: ${broken.join(", ")}`, "error"); }
  };

  const doRepair = async () => {
    setRepairing(true); setMsg("🔧 Sending repair command...", "info");
    await autoRepairSheets();
    setMsg("⏳ Waiting 4s for script...", "info");
    await new Promise(r=>setTimeout(r,4000));
    const r=await deepTestConnections(); setTestResults(r); setRepairing(false);
    const allOk=Object.values(r).every(v=>v.ok);
    setMsg(allOk?"✅ All headers repaired!":"⚠ Some issues remain — try Generate or re-deploy script.", allOk?"ok":"error");
  };

  const doGenerate = async () => {
    setGenerating(true); setMsg("🏗 Creating missing sheets and headers...", "info");
    await generateAllSheets();
    await new Promise(r=>setTimeout(r,5000));
    const r=await deepTestConnections(); setTestResults(r); setGenerating(false);
    const allOk=Object.values(r).every(v=>v.ok);
    setMsg(allOk?"✅ All sheets generated!":"⚠ Re-deploy script v9 and try again.", allOk?"ok":"error");
  };

  const downloadScript = () => {
    const txt=getScriptText(),blob=new Blob([txt],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url; a.download="POS_Script_v9.gs"; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const checkDB = async () => {
    try {
      const [items,sales,customers,cats,rets,queue]=await Promise.all([dbGetAll("items"),dbGetAll("sales"),dbGetAll("customers"),dbGetAll("categories"),dbGetAll("returns"),dbGetAll("pendingQueue")]);
      const ls=await dbGetMeta("lastSync");
      setDbInfo({items:items.length,sales:sales.length,customers:customers.length,categories:cats.length,returns:rets.length,queue:queue.length,lastSync:ls});
    } catch(e){setDbInfo({error:e.message});}
  };

  const clearDB = async () => {
    if(!window.confirm("Clear all local offline data?\n\n✅ Database data stays safe — only browser cache is cleared.\n\nYou need internet to reload data.")) return;
    for(const s of ["items","categories","sales","customers","returns","stocklog","meta","pendingQueue"]) await dbClear(s).catch(()=>{});
    setDbInfo(null); alert("✅ Cache cleared. Refresh page to reload from Database.");
  };

  const hasIssues = testResults && !Object.values(testResults).every(v=>v.ok);
  const spinSt    = (color="#fff") => ({ width:12,height:12,border:`2px solid ${color}33`,borderTop:`2px solid ${color}`,borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite" });

  const sectionStyle = { ...card, padding:18, marginBottom:18 };
  const sectionTitle = (icon,text) => <div style={{fontWeight:700,fontSize:13,color:T.textPrimary,marginBottom:4}}>{icon} {text}</div>;
  const sectionDesc  = text => <div style={{color:T.textMuted,fontSize:11,marginBottom:14}}>{text}</div>;

  return (
    <div style={{ maxWidth:780 }}>

      {/* OFFLINE DB */}
      <div style={sectionStyle}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div>
            {sectionTitle("💾","OFFLINE DATABASE (IndexedDB)")}
            {sectionDesc("Local browser cache for instant load and offline use")}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" onClick={checkDB} style={{padding:"8px 16px",background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:11,borderRadius:7,fontWeight:600}}>Check DB</button>
            <button className="btn" onClick={clearDB} style={{padding:"8px 16px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:11,borderRadius:7,fontWeight:600}}>Clear Cache</button>
          </div>
        </div>
        {dbInfo&&(dbInfo.error?<div style={{color:T.danger,fontSize:12}}>Error: {dbInfo.error}</div>:
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:10}}>
            {[["Items",dbInfo.items,T.accent],["Sales",dbInfo.sales,T.success],["Customers",dbInfo.customers,"#7c3aed"],["Categories",dbInfo.categories,T.posGold],["Returns",dbInfo.returns,T.posOrange],["Pending Queue",dbInfo.queue,dbInfo.queue>0?T.danger:T.success],["Last Sync",dbInfo.lastSync?new Date(dbInfo.lastSync).toLocaleTimeString("en-PK"):"Never",T.textSecondary]].map(([l,v,c])=>(
              <div key={l} style={{background:T.bgCardAlt,border:`1px solid ${T.border}`,borderRadius:8,padding:"9px 12px"}}>
                <div style={{color:T.textMuted,fontSize:9,letterSpacing:1,marginBottom:3,textTransform:"uppercase"}}>{l}</div>
                <div style={{color:c||T.textPrimary,fontWeight:700,fontSize:14}}>{v}</div>
              </div>
            ))}
          </div>
        )}
        {!dbInfo&&<div style={{color:T.textMuted,fontSize:12}}>Click "Check DB" to inspect local cache.</div>}
        <div style={{color:T.textMuted,fontSize:11,lineHeight:1.7,marginTop:8}}>
          Loads instantly · Syncs in background · Offline sales queued &amp; auto-sent · Cache is per-browser/PC
        </div>
      </div>

      {/* CONNECTION TEST */}
      <div style={sectionStyle}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14,gap:10,flexWrap:"wrap"}}>
          <div>
            {sectionTitle("🔌","DATABASE CONNECTION & HEADER TEST")}
            {sectionDesc("Tests all 7 sheet tabs for reachability and required headers")}
          </div>
          <button className="btn" onClick={runTest} disabled={testing||repairing||generating}
            style={{padding:"10px 22px",background:testing?"#e2e8f0":"linear-gradient(135deg,#1d4ed8,#2563eb)",border:"none",color:testing?T.textMuted:"#fff",fontSize:13,borderRadius:9,fontWeight:700,display:"flex",alignItems:"center",gap:7,boxShadow:"0 3px 10px rgba(37,99,235,0.25)"}}>
            {testing?<><span style={spinSt(T.accent)}/>Testing...</>:"▶ Run Full Test"}
          </button>
        </div>

        {testResults&&(
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {Object.entries(SHEET_META).map(([key,{label,tabName,desc}])=>{
              const r=testResults[key]||{ok:false,reachable:false,headers:[],missingHeaders:[],extraInfo:""};
              const isExp=expandedSheet===key;
              const borderColor=r.ok?T.successBorder:r.reachable?T.warningBorder:T.dangerBorder;
              const bgColor=r.ok?T.successLight:r.reachable?T.warningLight:T.dangerLight;
              return(
                <div key={key} style={{background:bgColor,border:`2px solid ${borderColor}`,borderRadius:10,overflow:"hidden"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 16px",cursor:r.headers?.length>0?"pointer":"default"}}
                    onClick={()=>r.headers?.length>0&&setExpandedSheet(isExp?null:key)}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <span style={{fontSize:22}}>{r.ok?"✅":r.reachable?"⚠️":"❌"}</span>
                      <div>
                        <div style={{color:T.textPrimary,fontSize:13,fontWeight:700}}>{label}</div>
                        <div style={{color:T.textMuted,fontSize:10}}>{desc}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:14,flexShrink:0}}>
                      <div style={{textAlign:"right"}}>
                        <div style={{color:r.ok?T.success:r.reachable?T.warning:T.danger,fontSize:11,fontWeight:600,maxWidth:240}}>{r.extraInfo}</div>
                        {tabName&&<div style={{fontSize:10,color:T.textMuted,marginTop:2}}>Tab: <code style={{background:T.bgCardAlt,padding:"1px 6px",borderRadius:3,color:T.textSecondary,fontSize:10}}>{tabName}</code></div>}
                      </div>
                      {r.headers?.length>0&&<span style={{color:T.textMuted,fontSize:13}}>{isExp?"▲":"▼"}</span>}
                    </div>
                  </div>
                  {isExp&&(
                    <div style={{padding:"0 16px 14px",borderTop:`1px solid ${T.border}`}}>
                      {r.headers?.length>0&&(
                        <>
                          <div style={{color:T.textMuted,fontSize:10,letterSpacing:1.2,margin:"10px 0 7px",textTransform:"uppercase"}}>Headers on Sheet</div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                            {r.headers.map(h=>{const req=(REQUIRED_HEADERS[key]||[]).includes(h);return(
                              <span key={h} style={{padding:"3px 10px",borderRadius:12,fontSize:11,fontWeight:600,background:req?T.successLight:"#fffbeb",border:`1px solid ${req?T.successBorder:"#fde68a"}`,color:req?T.success:T.posGold}}>
                                {h} {req?"✓":"⊕"}
                              </span>);})}
                          </div>
                        </>
                      )}
                      {r.missingHeaders?.length>0&&(
                        <div style={{marginTop:10}}>
                          <div style={{color:T.danger,fontSize:10,letterSpacing:1.2,marginBottom:7,textTransform:"uppercase"}}>Missing — Will be added by Auto-Repair</div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                            {r.missingHeaders.map(h=><span key={h} style={{padding:"3px 10px",borderRadius:12,fontSize:11,fontWeight:600,background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger}}>{h} ✗</span>)}
                          </div>
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
        {actionMsg&&(
          <div style={{marginBottom:14,padding:"11px 15px",borderRadius:9,background:actionStatus==="ok"?T.successLight:actionStatus==="error"?T.dangerLight:T.accentLight,border:`1px solid ${actionStatus==="ok"?T.successBorder:actionStatus==="error"?T.dangerBorder:T.accentBorder}`,color:actionStatus==="ok"?T.success:actionStatus==="error"?T.danger:T.accent,fontSize:12,fontWeight:500}}>
            {actionMsg}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>
          {testResults&&hasIssues&&(
            <button className="btn" onClick={doRepair} disabled={repairing||testing||generating}
              style={{padding:"10px 20px",background:repairing?"#e2e8f0":"linear-gradient(135deg,#047857,#059669)",border:"none",color:repairing?T.textMuted:"#fff",fontSize:12,fontWeight:700,borderRadius:8,display:"flex",alignItems:"center",gap:6}}>
              {repairing?<><span style={spinSt(T.success)}/>Repairing...</>:"🔧 Auto-Repair Headers"}
            </button>
          )}
          <button className="btn" onClick={doGenerate} disabled={generating||testing||repairing}
            style={{padding:"10px 20px",background:generating?"#e2e8f0":"linear-gradient(135deg,#6d28d9,#7c3aed)",border:"none",color:generating?T.textMuted:"#fff",fontSize:12,fontWeight:700,borderRadius:8,display:"flex",alignItems:"center",gap:6}}>
            {generating?<><span style={spinSt("#a78bfa")}/>Generating...</>:"🏗 Generate / Fix All Sheets"}
          </button>
          {testResults&&<button className="btn" onClick={runTest} disabled={testing||repairing||generating} style={{padding:"10px 16px",background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:12,fontWeight:700,borderRadius:8}}>🔄 Re-Test</button>}
          <button className="btn" onClick={downloadScript} style={{padding:"10px 18px",background:"linear-gradient(135deg,#b45309,#d97706)",color:"#fff",fontSize:12,fontWeight:700,borderRadius:8,border:"none"}}>📥 Script v9 (.gs)</button>
          <button className="btn" onClick={async()=>{setMsg("🔄 Deduplicating customer sheet...", "info");await safeCallScript({action:"deduplicateCustomers"});await new Promise(r=>setTimeout(r,3000));setMsg("✅ Done! Click Sync Now to reload.", "ok");}}
            style={{padding:"10px 18px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:12,fontWeight:700,borderRadius:8}}>
            🧹 Fix Duplicate Customers
          </button>
          {!testResults&&<button className="btn" onClick={runTest} disabled={testing} style={{padding:"10px 20px",background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:12,fontWeight:700,borderRadius:8}}>▶ Run Full Test</button>}
        </div>
        {!testResults&&!testing&&<div style={{marginTop:12,color:T.textMuted,fontSize:12}}>↑ Run test to verify all 7 sheet tabs + script. Click result rows to expand headers.</div>}
      </div>

      {/* SYNC STATUS */}
      <div style={{...card,padding:16,marginBottom:18}}>
        <div style={{fontWeight:700,fontSize:12,color:T.textPrimary,marginBottom:10}}>🔄 LIVE SYNC STATUS</div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:9,height:9,borderRadius:"50%",background:sheetStatus==="loaded"?T.success:sheetStatus==="error"?T.danger:T.warning,display:"inline-block",boxShadow:sheetStatus==="loaded"?`0 0 5px ${T.success}`:"none"}}/>
            <span style={{color:T.textSecondary,fontSize:12}}>Database: <span style={{color:sheetStatus==="loaded"?T.success:sheetStatus==="error"?T.danger:T.warning,fontWeight:700}}>{sheetStatus==="loaded"?"✓ LIVE":sheetStatus==="cached"?"💾 CACHED":sheetStatus==="error"?"✗ ERROR":"◉ DEMO"}</span></span>
          </div>
          {lastSync&&<span style={{color:T.textMuted,fontSize:12}}>Last: {lastSync.toLocaleString("en-PK")}</span>}
          <button className="btn" onClick={onRefresh} style={{padding:"7px 18px",background:"linear-gradient(135deg,#1d4ed8,#2563eb)",color:"#fff",fontSize:12,borderRadius:7,fontWeight:600,border:"none",boxShadow:"0 2px 8px rgba(37,99,235,0.25)"}}>🔄 Sync Now</button>
        </div>
      </div>

      {/* LICENSE */}
      <div style={{...card,padding:20}}>
        <div style={{fontWeight:700,fontSize:13,color:T.textPrimary,marginBottom:14}}>📋 SOFTWARE LICENSE & PAYMENT TERMS</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          {[["1st Installation Fee","PKR 15,000"],["Annual Fee","PKR 10,000"],["Monthly Fee","PKR 2,000"],["Due Date","5th of Each Month"]].map(([l,v])=>(
            <div key={l} style={{background:T.bgCardAlt,border:`1px solid ${T.border}`,borderRadius:9,padding:"10px 14px"}}>
              <div style={{color:T.textMuted,fontSize:10,letterSpacing:1,marginBottom:3,textTransform:"uppercase"}}>{l}</div>
              <div style={{color:T.textPrimary,fontSize:16,fontWeight:800,fontFamily:"Orbitron"}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{background:T.accentLight,border:`1px solid ${T.accentBorder}`,borderRadius:10,padding:"13px 16px"}}>
          <div style={{color:T.accent,fontWeight:700,fontSize:12,marginBottom:8}}>💳 PAYMENT METHOD</div>
          <div style={{color:T.textSecondary,fontSize:13,lineHeight:2.1}}>
            Bank: <b style={{color:T.textPrimary}}>Bank Alfalah</b><br/>
            Account#: <b style={{color:T.accent,fontFamily:"monospace",letterSpacing:2}}>0203-1005098235</b><br/>
            Account Name: <b style={{color:T.textPrimary}}>Mian Ahmed Umer</b>
          </div>
        </div>
      </div>
    </div>
  );
}
