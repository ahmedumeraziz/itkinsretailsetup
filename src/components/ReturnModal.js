import { useState } from "react";
import { T, inSt, slSt, lbSt } from "../config";
import { fmt, safeParseItems, getNow } from "../utils/helpers";
import { printReturnReceipt } from "../utils/print";

// ─── REFUND APPLY PANEL ───────────────────────────────────────────────────────
export function RefundApplyPanel({ returns, onApply, appliedPayments }) {
  const [returnNo, setReturnNo] = useState("");
  const [found,    setFound]    = useState(null);
  const [msg,      setMsg]      = useState("");

  const alreadyApplied = found && (
    found.UsedInBill === "1" || found.UsedInBill === true ||
    appliedPayments.some(p => p.type === "refund" && p.origReturnNo === found.ReturnNo)
  );

  const lookup = () => {
    const q = returnNo.trim().toUpperCase();
    const match = returns.find(r =>
      r.ReturnNo?.toUpperCase() === q ||
      r.ReturnNo?.replace(/\D/g,"") === q.replace(/\D/g,"")
    );
    if (match) { setFound(match); setMsg(""); }
    else { setFound(null); setMsg("Return not found"); }
  };

  const apply = () => {
    if (!found || alreadyApplied) return;
    onApply(parseFloat(found.RefundAmount), found.ReturnNo);
    setReturnNo(""); setFound(null);
    setMsg("✅ Refund applied to this bill");
    setTimeout(() => setMsg(""), 3000);
  };

  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:7 }}>
        <input value={returnNo} onChange={e=>{setReturnNo(e.target.value);setFound(null);setMsg("");}}
          onKeyDown={e=>e.key==="Enter"&&lookup()} placeholder="Return # (e.g. R0002)"
          style={{ ...inSt, flex:1, padding:"7px 10px", fontSize:12, background:T.bgCard, border:`1px solid ${T.border}` }} />
        <button className="btn" onClick={lookup} style={{ padding:"7px 13px", background:T.warningLight, border:`1px solid ${T.warningBorder}`, color:T.warning, fontSize:12, borderRadius:6, fontWeight:600 }}>Find</button>
      </div>
      {msg && <div style={{ fontSize:11, color:msg.startsWith("✅")?T.success:T.danger, marginBottom:6 }}>{msg}</div>}
      {found && !alreadyApplied && (
        <div style={{ background:T.warningLight, border:`1px solid ${T.warningBorder}`, borderRadius:8, padding:"9px 12px" }}>
          <div style={{ color:T.textPrimary, fontSize:11, marginBottom:8, fontWeight:600 }}>
            {found.ReturnNo} — {found.Date} — Orig Bill #{found.OrigBillNo}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9 }}>
            <span style={{ color:T.textSecondary, fontSize:11 }}>Refund Amount</span>
            <span style={{ color:T.posOrange, fontWeight:700, fontSize:15 }}>PKR {fmt(found.RefundAmount)}</span>
          </div>
          <button className="btn" onClick={apply} style={{ width:"100%", padding:"8px", background:"linear-gradient(135deg,#c2410c,#ea580c)", color:"#fff", fontSize:12, borderRadius:7, fontWeight:700 }}>↩ Apply Refund to This Bill</button>
        </div>
      )}
      {alreadyApplied && (
        <div style={{ fontSize:11, color:T.danger, padding:"8px 10px", background:T.dangerLight, border:`1px solid ${T.dangerBorder}`, borderRadius:7 }}>
          ⛔ Return {found?.ReturnNo} has already been used in a bill.
        </div>
      )}
    </div>
  );
}

// ─── RETURN MODAL ─────────────────────────────────────────────────────────────
export default function ReturnModal({ user, sales, items, returnCounter, onReturnSaved, onClose }) {
  const [step,       setStep]       = useState(1);
  const [billNo,     setBillNo]     = useState("");
  const [foundSale,  setFoundSale]  = useState(null);
  const [saleItems,  setSaleItems]  = useState([]);
  const [returnQtys, setReturnQtys] = useState({});
  const [reason,     setReason]     = useState("Customer Return");
  const [msg,        setMsg]        = useState("");

  const findBill = () => {
    const normBill = b => { const n=String(b||"").replace(/[^0-9]/g,""); return n.replace(/^0+/,"")||"0"; };
    const q = normBill(billNo.trim());
    const s = sales.find(s => normBill(s.BillNo) === q);
    if (!s) { setMsg("Bill not found"); return; }
    const si = safeParseItems(s.ItemsDetail);
    setFoundSale(s); setSaleItems(si);
    const qtys = {}; si.forEach(i => { qtys[i.Barcode] = 0; });
    setReturnQtys(qtys); setStep(2); setMsg("");
  };

  const setRQ = (bc, v) => setReturnQtys(p => ({
    ...p, [bc]: Math.max(0, Math.min(parseInt(v)||0, saleItems.find(i=>i.Barcode===bc)?.qty||0))
  }));

  // BUG FIX: use piece_sale_price for VU items so refund matches what was charged
  const refundAmt = saleItems.reduce((s,i) => {
    const qty   = returnQtys[i.Barcode]||0;
    const price = parseFloat(i.piece_sale_price || i.Price || 0);
    return s + qty * (price - parseFloat(i.Discount||0));
  }, 0);

  const returnedItems = saleItems.filter(i=>(returnQtys[i.Barcode]||0)>0).map(i=>({...i,qty:returnQtys[i.Barcode]}));

  const confirmReturn = () => {
    if (returnedItems.length === 0) { setMsg("Select at least one item to return"); return; }
    const { date, time } = getNow();
    const ReturnNo = "R" + String(returnCounter).padStart(4, "0");
    const ret = { ReturnNo, OrigBillNo:foundSale.BillNo, Date:date, Time:time, Cashier:user.Name, Items:JSON.stringify(returnedItems), RefundAmount:refundAmt, Reason:reason };
    onReturnSaved(ret);
    printReturnReceipt(ret);
  };

  const overlayStyle = { position:"fixed", inset:0, background:T.bgOverlay, zIndex:600, display:"flex", alignItems:"center", justifyContent:"center", padding:20 };
  const modalStyle   = { background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:16, padding:26, maxWidth:560, width:"100%", maxHeight:"88vh", overflowY:"auto", boxShadow:T.shadowLg };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontFamily:"Orbitron", color:T.posOrange, fontSize:15, fontWeight:700 }}>↩ PROCESS RETURN / REFUND</div>
          <button className="btn" onClick={onClose} style={{ padding:"5px 12px", background:T.dangerLight, border:`1px solid ${T.dangerBorder}`, color:T.danger, fontSize:13, borderRadius:7, fontWeight:600 }}>✕</button>
        </div>

        {step === 1 && (
          <div>
            <p style={{ color:T.textSecondary, fontSize:12, marginBottom:14 }}>Enter the original bill number to process a return.</p>
            <div style={{ display:"flex", gap:9 }}>
              <input value={billNo} onChange={e=>setBillNo(e.target.value)} onKeyDown={e=>e.key==="Enter"&&findBill()}
                placeholder="Bill Number (e.g. B0115)" style={{ ...inSt, flex:1, background:T.bgCardAlt }} autoFocus />
              <button className="btn" onClick={findBill} style={{ padding:"9px 20px", background:"linear-gradient(135deg,#c2410c,#ea580c)", color:"#fff", fontSize:12, fontWeight:700, borderRadius:8 }}>Find Bill</button>
            </div>
            {msg && <div style={{ color:T.danger, fontSize:12, marginTop:9, padding:"8px 12px", background:T.dangerLight, border:`1px solid ${T.dangerBorder}`, borderRadius:7 }}>{msg}</div>}
          </div>
        )}

        {step === 2 && foundSale && (
          <div>
            {/* Bill info */}
            <div style={{ background:T.warningLight, border:`1px solid ${T.warningBorder}`, borderRadius:10, padding:"11px 15px", marginBottom:16 }}>
              <div style={{ color:T.warning, fontSize:12, fontWeight:700 }}>Bill #{foundSale.BillNo} — {foundSale.Date} — {foundSale.Cashier}</div>
              <div style={{ color:T.textSecondary, fontSize:11 }}>Customer: {foundSale.CustomerName||"Walk-in"} · Total: PKR {fmt(foundSale.GrandTotal)}</div>
            </div>

            <p style={{ color:T.textSecondary, fontSize:11, marginBottom:10 }}>Select items and quantities to return:</p>

            {saleItems.map(item => (
              <div key={item.Barcode} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 13px", background:T.bgCardAlt, border:`1px solid ${(returnQtys[item.Barcode]||0)>0?T.warningBorder:T.borderLight}`, borderRadius:9, marginBottom:7, transition:"border-color 0.15s" }}>
                <div>
                  <div style={{ color:T.textPrimary, fontSize:13, fontWeight:600 }}>{item.ItemName}</div>
                  <div style={{ color:T.textMuted, fontSize:10 }}>Sold: {item.qty} · PKR {fmt(item.Price)} each</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                  <span style={{ color:T.textMuted, fontSize:11 }}>Return:</span>
                  <button className="btn" onClick={()=>setRQ(item.Barcode,(returnQtys[item.Barcode]||0)-1)} style={{ width:26,height:26,background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:15,borderRadius:5,padding:0 }}>−</button>
                  <span style={{ color:(returnQtys[item.Barcode]||0)>0?T.posOrange:T.textPrimary, fontWeight:700, fontSize:14, minWidth:26, textAlign:"center" }}>{returnQtys[item.Barcode]||0}</span>
                  <button className="btn" onClick={()=>setRQ(item.Barcode,(returnQtys[item.Barcode]||0)+1)} style={{ width:26,height:26,background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:15,borderRadius:5,padding:0 }}>+</button>
                  <span style={{ color:T.posOrange, fontSize:11, minWidth:80, textAlign:"right", fontWeight:600 }}>
                    PKR {fmt((returnQtys[item.Barcode]||0)*(parseFloat(item.Price)-parseFloat(item.Discount||0)))}
                  </span>
                </div>
              </div>
            ))}

            <div style={{ marginTop:13 }}>
              <label style={lbSt}>REASON FOR RETURN</label>
              <select value={reason} onChange={e=>setReason(e.target.value)} style={{ ...slSt, width:"100%", background:T.bgCard }}>
                <option>Customer Return</option><option>Damaged Item</option><option>Wrong Item</option><option>Expired Product</option><option>Other</option>
              </select>
            </div>

            {msg && <div style={{ color:T.danger, fontSize:12, marginTop:9, padding:"8px 12px", background:T.dangerLight, border:`1px solid ${T.dangerBorder}`, borderRadius:7 }}>{msg}</div>}

            {/* Refund total */}
            <div style={{ background:T.warningLight, border:`1px solid ${T.warningBorder}`, borderRadius:10, padding:"12px 15px", marginTop:15, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:T.posOrange, fontWeight:700, fontSize:14 }}>REFUND AMOUNT</span>
              <span style={{ color:T.posOrange, fontWeight:800, fontSize:20, fontFamily:"Orbitron" }}>PKR {fmt(refundAmt)}</span>
            </div>

            <div style={{ display:"flex", gap:9, marginTop:15 }}>
              <button className="btn" onClick={()=>setStep(1)} style={{ flex:1, padding:12, background:T.bgCardAlt, border:`1px solid ${T.border}`, color:T.textSecondary, borderRadius:8, fontSize:12 }}>← Back</button>
              <button className="btn" onClick={confirmReturn} disabled={returnedItems.length===0}
                style={{ flex:2, padding:12, background:returnedItems.length>0?"linear-gradient(135deg,#c2410c,#ea580c)":"#e2e8f0", border:"none", color:returnedItems.length>0?"#fff":T.textMuted, fontSize:13, fontWeight:700, borderRadius:8 }}>
                ✓ Process Return &amp; Print
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
