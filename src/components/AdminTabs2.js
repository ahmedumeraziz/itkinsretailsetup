import { useState } from "react";
import { T, inSt, slSt, lbSt } from "../config";
import { fmt, filterDateMatch, safeParseItems } from "../utils/helpers";
import { printReceipt, printReturnReceipt } from "../utils/print";

const card    = { background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, overflow: "hidden", boxShadow: T.shadow };
const thSt    = { padding: "9px 12px", background: T.bgTopBar, color: "rgba(255,255,255,0.85)", fontSize: 10, letterSpacing: 1.5, fontWeight: 700 };
const normBill = b => { const n = String(b||"").replace(/[^0-9]/g,""); return n.replace(/^0+/,"")||"0"; };

function SummaryCard({ icon, label, value, color, bg, border }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 11, padding: "14px 18px", flex: 1, minWidth: 155 }}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
      <div style={{ color: T.textMuted, fontSize: 10, letterSpacing: 1.5, marginBottom: 3, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color, fontSize: 18, fontWeight: 800, fontFamily: "Orbitron" }}>{value}</div>
    </div>
  );
}

function vuEnabled(item) {
  return !!(item.variable_unit_enabled &&
    parseInt(item.pieces_per_box) > 0 &&
    parseInt(item.boxes_per_cotton) > 0);
}

function generateSalesPDF(filtered, fromDate, toDate, cashierFilter) {
  const now       = new Date().toLocaleString("en-PK");
  const dateRange = fromDate && toDate ? `${fromDate} → ${toDate}` : fromDate ? `From ${fromDate}` : toDate ? `To ${toDate}` : "All Dates";
  const totalRev  = filtered.reduce((s, r) => s + parseFloat(r.GrandTotal||0), 0);
  const totalDisc = filtered.reduce((s, r) => s + parseFloat(r.Discount||0), 0);
  const creditCnt = filtered.filter(s => s.PaymentMethod === "Credit").length;
  const rows = [...filtered].reverse().map((sale, i) => {
    const isCredit = sale.PaymentMethod === "Credit";
    const custName = (sale.CustomerName && sale.CustomerName !== "Unknown" && sale.CustomerName.trim() !== "") ? sale.CustomerName : "Walk-in";
    const rowBg    = i % 2 === 0 ? "#ffffff" : "#f7f9fc";
    return `<tr style="background:${rowBg}">
      <td style="font-weight:700;color:#1d4ed8">#${sale.BillNo}</td>
      <td>${sale.Date}</td><td>${sale.Time}</td><td>${sale.Cashier}</td>
      <td style="color:${isCredit?"#ea580c":"#475569"};font-weight:${isCredit?700:400}">${custName}</td>
      <td>${sale.CustomerCell||"—"}</td>
      <td style="text-align:right;font-weight:700;color:#059669">PKR ${fmt(sale.GrandTotal)}</td>
      <td style="text-align:center"><span style="background:${isCredit?"#fff7ed":"#ecfdf5"};color:${isCredit?"#ea580c":"#059669"};border:1px solid ${isCredit?"#fed7aa":"#a7f3d0"};border-radius:8px;padding:2px 8px;font-size:10px;font-weight:700">${sale.PaymentMethod}</span></td>
    </tr>`;
  }).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Report</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;padding:24px}
  h1{font-size:22px;color:#0a2540;margin-bottom:3px}.sub{color:#666;font-size:11px;margin-bottom:18px}
  .cards{display:flex;gap:14px;margin-bottom:20px}.card{flex:1;border-radius:8px;padding:13px 16px;text-align:center}
  .card .val{font-size:20px;font-weight:800;margin-bottom:3px}.card .lbl{font-size:10px;color:#666;text-transform:uppercase}
  table{width:100%;border-collapse:collapse}thead th{background:#0a2540;color:#fff;padding:9px 10px;text-align:left;font-size:10px;letter-spacing:0.8px;text-transform:uppercase}
  tbody td{padding:7px 10px;border-bottom:1px solid #eaecef;font-size:11px}
  .footer{margin-top:24px;text-align:center;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:10px}
  @media print{body{padding:10px}}</style></head><body>
  <h1>💰 Sales Report — MIAN TRADERS</h1>
  <div class="sub">Generated: ${now} · Date: ${dateRange} · Cashier: ${cashierFilter} · Bills: ${filtered.length}</div>
  <div class="cards">
    <div class="card" style="background:#eff6ff;border:1px solid #bfdbfe"><div class="val" style="color:#1d4ed8">PKR ${fmt(totalRev)}</div><div class="lbl">Total Revenue</div></div>
    <div class="card" style="background:#fffbeb;border:1px solid #fde68a"><div class="val" style="color:#d97706">PKR ${fmt(totalDisc)}</div><div class="lbl">Total Discounts</div></div>
    <div class="card" style="background:#fff7ed;border:1px solid #fed7aa"><div class="val" style="color:#ea580c">${creditCnt}</div><div class="lbl">Credit Sales</div></div>
    <div class="card" style="background:#ecfdf5;border:1px solid #a7f3d0"><div class="val" style="color:#059669">${filtered.length}</div><div class="lbl">Total Bills</div></div>
  </div>
  <table><thead><tr><th>Bill#</th><th>Date</th><th>Time</th><th>Cashier</th><th>Customer</th><th>Cell</th><th style="text-align:right">Total</th><th style="text-align:center">Payment</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="footer">itKINS POS System · itkins.com | 0304-7414437</div>
  <script>window.onload=()=>window.print();</script></body></html>`;
  const w = window.open("", "_blank", "width=960,height=720");
  if (!w) { alert("Allow popups to export PDF!"); return; }
  w.document.write(html); w.document.close();
}

// ── SALES TAB ─────────────────────────────────────────────────────────────────
export function SalesTab({ sales, setSales, customers, returns, safeCallScript }) {
  const [filterFrom,    setFilterFrom]    = useState("");
  const [filterTo,      setFilterTo]      = useState("");
  const [filterCashier, setFilterCashier] = useState("All");
  const [viewBill,      setViewBill]      = useState(null);
  const [editItems,     setEditItems]     = useState(null); // null=view, array=editing
  const [saving,        setSaving]        = useState(false);

  const cashierList = [...new Set(sales.map(s => s.Cashier).filter(Boolean))];
  const filtered = sales.filter(s => {
    const d = s.Date || "";
    if (filterFrom && d < filterFrom) return false;
    if (filterTo   && d > filterTo)   return false;
    if (filterCashier !== "All" && s.Cashier !== filterCashier) return false;
    return true;
  });
  const totalRev  = filtered.reduce((s, r) => s + parseFloat(r.GrandTotal||0), 0);
  const totalDisc = filtered.reduce((s, r) => s + parseFloat(r.Discount||0), 0);

  const getRefundForBill = sale => ({ amount: parseFloat(sale.RefundApplied||0), returnNo: sale.RefundReturnNo||"" });

  const getPrevPending = sale => {
    if (sale.PaymentMethod !== "Credit" || !sale.CustomerCell) return 0;
    const c = (customers||[]).find(cx => cx.CellNo === sale.CustomerCell);
    if (!c) return 0;
    const billNos  = (c.BillNo||"").split(",").filter(Boolean).map(b => b.trim());
    const thisNorm = normBill(sale.BillNo);
    const creditBefore = billNos.reduce((sum, bn) => {
      if (normBill(bn) === thisNorm) return sum;
      const s = sales.find(s2 => normBill(s2.BillNo) === normBill(bn));
      if (!s || s.PaymentMethod !== "Credit") return sum;
      return sum + parseFloat(s.GrandTotal||0);
    }, 0);
    const totalPaid = (c.payments||[]).reduce((sum, p) => sum + parseFloat(p.amount||0), 0);
    return Math.max(0, creditBefore + parseFloat(c.openingDebit||0) - totalPaid);
  };

  const openBill  = sale => { setViewBill(sale); setEditItems(null); };
  const startEdit = ()   => { setEditItems(safeParseItems(viewBill.ItemsDetail).map(it => ({ ...it }))); };

  // Update a field on one editItems row; recalc VU qty automatically
  const updateField = (idx, field, rawVal) => {
    setEditItems(prev => {
      const next = prev.map((it, i) => i !== idx ? it : (() => {
        const val  = Math.max(0, parseInt(rawVal)||0);
        const item = { ...it, [field]: val };
        if (vuEnabled(item)) {
          const ppb = parseInt(item.pieces_per_box)||1;
          const bpc = parseInt(item.boxes_per_cotton)||1;
          const c = field === "qty_cottons" ? val : parseInt(item.qty_cottons)||0;
          const b = field === "qty_boxes"   ? val : parseInt(item.qty_boxes)  ||0;
          const p = field === "qty_pieces"  ? val : parseInt(item.qty_pieces) ||0;
          const total = c*ppb*bpc + b*ppb + p;
          return { ...item, qty_cottons: c, qty_boxes: b, qty_pieces: p, qty: total, qty_total_pcs: total };
        }
        if (field === "qty") return { ...item, qty: val };
        return item;
      })());
      return next;
    });
  };

  // Live grand total preview while editing
  const previewTotal = editItems ? (() => {
    const sub  = editItems.reduce((s, i) => s + parseFloat(i.piece_sale_price||i.Price||0)*(parseInt(i.qty)||0), 0);
    const iDisc= editItems.reduce((s, i) => s + parseFloat(i.Discount||0)*(parseInt(i.qty)||0), 0);
    const bDisc= Math.max(0, parseFloat(viewBill.Discount||0) - iDisc);
    const ref  = parseFloat(viewBill.RefundApplied||0);
    return Math.max(0, sub - iDisc - bDisc - ref);
  })() : 0;

  const saveItemEdit = async () => {
    if (!viewBill || !editItems) return;
    setSaving(true);
    const sub   = editItems.reduce((s, i) => s + parseFloat(i.piece_sale_price||i.Price||0)*(parseInt(i.qty)||0), 0);
    const iDisc = editItems.reduce((s, i) => s + parseFloat(i.Discount||0)*(parseInt(i.qty)||0), 0);
    const bDisc = Math.max(0, parseFloat(viewBill.Discount||0) - iDisc);
    const ref   = parseFloat(viewBill.RefundApplied||0);
    const newGT = Math.max(0, sub - iDisc - bDisc - ref);
    const newID = JSON.stringify(editItems);
    const updated = { ...viewBill, ItemsDetail: newID, GrandTotal: newGT };
    setSales(prev => prev.map(s => normBill(s.BillNo) === normBill(viewBill.BillNo) ? updated : s));
    if (safeCallScript) await safeCallScript({ action: "editSale", ...updated });
    setViewBill(updated); setEditItems(null); setSaving(false);
  };

  const reprintBill = sale => {
    const items         = safeParseItems(sale.ItemsDetail);
    const subTotal      = items.reduce((s, i) => s + parseFloat(i.Price||0)*(parseInt(i.qty)||1), 0);
    const itemDiscount  = items.reduce((s, i) => s + parseFloat(i.Discount||0)*(parseInt(i.qty)||1), 0);
    const totalDiscount = parseFloat(sale.Discount||0);
    const grandTotal    = parseFloat(sale.GrandTotal||0);
    const isCredit      = sale.PaymentMethod === "Credit";
    const refundInfo    = getRefundForBill(sale);
    printReceipt({ billNo:sale.BillNo, date:sale.Date, time:sale.Time, cashier:sale.Cashier, items, subTotal, totalDiscount, itemDiscount, billDiscount:Math.max(0,totalDiscount-itemDiscount), billDiscountPct:0, grandTotal, payments:isCredit?[]:[{type:"cash",amount:grandTotal,last4:""}], change:0, customerName:sale.CustomerName||"", customerCell:sale.CustomerCell||"", refundApplied:refundInfo.amount, refundReturnNo:refundInfo.returnNo, prevPending:isCredit?getPrevPending(sale):0 }, true);
  };

  // Always-fixed info cell
  const infoCell = (label, value, color = T.textPrimary) => (
    <div style={{ background:T.bgCardAlt, border:`1px solid ${T.borderLight}`, borderRadius:8, padding:"9px 12px", flex:1 }}>
      <div style={{ color:T.accent, fontSize:10, letterSpacing:1, marginBottom:3, fontWeight:700, textTransform:"uppercase" }}>{label}</div>
      <div style={{ color, fontSize:13, fontWeight:600 }}>{value||"—"}</div>
    </div>
  );

  // Small qty input for editing
  const qtyInput = (idx, field, value, color) => (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
      <span style={{ fontSize:9, color, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>{field === "qty" ? "Qty" : field === "qty_cottons" ? "Cotton" : field === "qty_boxes" ? "Box" : "Piece"}</span>
      <input type="number" min="0" value={value}
        onChange={e => updateField(idx, field, e.target.value)}
        onFocus={e => e.target.select()}
        style={{ width:52, padding:"4px 4px", background:T.bgCard, border:`1.5px solid ${color}`, borderRadius:6, color:T.textPrimary, fontSize:13, fontWeight:700, textAlign:"center", outline:"none" }} />
    </div>
  );

  return (
    <div>
      {/* ── Bill popup ── */}
      {viewBill && (
        <div style={{position:"fixed",inset:0,background:T.bgOverlay,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>{ if(!editItems){ setViewBill(null); }}}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:16,padding:24,maxWidth:640,width:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:T.shadowLg}}>

            {/* Header row */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <div style={{fontFamily:"Orbitron",color:T.accent,fontSize:18,fontWeight:900}}>Bill #{viewBill.BillNo}</div>
              <div style={{display:"flex",gap:8}}>
                {!editItems && (
                  <button className="btn" onClick={startEdit} style={{padding:"7px 16px",background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,borderRadius:7,fontSize:12,fontWeight:700}}>✏️ Edit Items</button>
                )}
                {editItems && (<>
                  <button className="btn" onClick={saveItemEdit} disabled={saving} style={{padding:"7px 16px",background:"linear-gradient(135deg,#047857,#059669)",border:"none",color:"#fff",borderRadius:7,fontSize:12,fontWeight:700}}>{saving?"⟳ Saving…":"💾 Save"}</button>
                  <button className="btn" onClick={()=>setEditItems(null)} style={{padding:"7px 14px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,borderRadius:7,fontSize:12}}>Cancel</button>
                </>)}
                <button className="btn" onClick={()=>{setViewBill(null);setEditItems(null);}} style={{padding:"7px 12px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,borderRadius:7,fontSize:13,fontWeight:700}}>✕ Close</button>
              </div>
            </div>

            {/* Info rows — always fixed */}
            <div style={{display:"flex",gap:9,marginBottom:9,flexWrap:"wrap"}}>
              {infoCell("Date",    viewBill.Date)}
              {infoCell("Time",    viewBill.Time)}
              {infoCell("Cashier", viewBill.Cashier)}
              {infoCell("Payment", viewBill.PaymentMethod, viewBill.PaymentMethod==="Credit"?T.posOrange:T.success)}
            </div>
            <div style={{display:"flex",gap:9,marginBottom:16,flexWrap:"wrap"}}>
              {infoCell("Customer", (viewBill.CustomerName&&viewBill.CustomerName!=="Unknown"&&viewBill.CustomerName.trim()!=="")?viewBill.CustomerName:"Walk-in")}
              {infoCell("Cell #",   viewBill.CustomerCell||"—")}
            </div>

            {/* Edit mode notice */}
            {editItems && (
              <div style={{padding:"8px 13px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,marginBottom:12,fontSize:11,color:"#92400e",fontWeight:600}}>
                ✏️ Edit mode — adjust quantities below. Grand Total will recalculate automatically.
              </div>
            )}

            {/* Items */}
            {(()=>{
              const displayItems = editItems || safeParseItems(viewBill.ItemsDetail);
              if (!displayItems.length) return <div style={{color:T.textMuted,fontSize:12,textAlign:"center",padding:16}}>No item detail available.</div>;
              const grouped = {};
              displayItems.forEach((it, idx) => {
                const c = it.Category||"Items";
                if (!grouped[c]) grouped[c] = [];
                grouped[c].push({ ...it, _idx: idx });
              });
              return <div>{Object.keys(grouped).sort().map(cat=>(
                <div key={cat} style={{marginBottom:12}}>
                  <div style={{color:T.accent,fontSize:10,letterSpacing:2,fontWeight:700,marginBottom:6,padding:"4px 10px",background:T.accentLight,borderRadius:6,border:`1px solid ${T.accentBorder}`}}>{cat.toUpperCase()}</div>
                  {grouped[cat].map((item)=>{
                    const idx    = item._idx;
                    const isVU   = vuEnabled(item);
                    const price  = parseFloat(item.piece_sale_price||item.Price||0);
                    const disc   = parseFloat(item.Discount||0);
                    const qty    = parseInt(item.qty||item.qty_total_pcs||0);
                    const lt     = qty*price - disc*qty;
                    const cottons= parseInt(item.qty_cottons||0);
                    const boxes  = parseInt(item.qty_boxes||0);
                    const pieces = parseInt(item.qty_pieces||0);
                    return(
                      <div key={idx} style={{padding:"10px 12px",background:T.bgCardAlt,border:`1px solid ${editItems?"#bfdbfe":T.borderLight}`,borderRadius:8,marginBottom:5,transition:"border-color 0.15s"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                          <div style={{flex:1}}>
                            <div style={{color:T.textPrimary,fontSize:13,fontWeight:700}}>
                              {item.ItemName||item.Barcode}
                              {isVU&&<span style={{background:"#f3e8ff",color:"#7c3aed",border:"1px solid #ddd6fe",borderRadius:8,fontSize:9,padding:"1px 6px",fontWeight:700,marginLeft:7}}>📦 VU</span>}
                            </div>

                            {/* Qty controls — edit mode */}
                            {editItems ? (
                              <div style={{display:"flex",gap:8,marginTop:8,alignItems:"center",flexWrap:"wrap"}}>
                                {isVU ? (<>
                                  {qtyInput(idx,"qty_cottons",cottons,"#7c3aed")}
                                  <span style={{color:T.textMuted,fontSize:14,marginTop:12}}>+</span>
                                  {qtyInput(idx,"qty_boxes",boxes,T.accent)}
                                  <span style={{color:T.textMuted,fontSize:14,marginTop:12}}>+</span>
                                  {qtyInput(idx,"qty_pieces",pieces,T.posOrange)}
                                  <div style={{marginTop:12,fontSize:11,color:T.textMuted}}>= {qty} pcs</div>
                                </>) : (
                                  qtyInput(idx,"qty",qty,T.accent)
                                )}
                              </div>
                            ) : (<>
                              {/* View mode — badges for VU */}
                              {isVU&&qty>0&&(
                                <div style={{display:"flex",gap:5,marginTop:4,flexWrap:"wrap"}}>
                                  {cottons>0&&<span style={{background:"#f3e8ff",color:"#7c3aed",border:"1px solid #ddd6fe",borderRadius:8,fontSize:11,padding:"2px 8px",fontWeight:700}}>{cottons} Cotton</span>}
                                  {boxes>0&&<span style={{background:T.accentLight,color:T.accent,border:`1px solid ${T.accentBorder}`,borderRadius:8,fontSize:11,padding:"2px 8px",fontWeight:700}}>{boxes} Box</span>}
                                  {pieces>0&&<span style={{background:"#fff7ed",color:T.posOrange,border:"1px solid #fed7aa",borderRadius:8,fontSize:11,padding:"2px 8px",fontWeight:700}}>{pieces} Pcs</span>}
                                </div>
                              )}
                            </>)}

                            <div style={{color:T.textMuted,fontSize:11,marginTop:4}}>
                              {isVU?`${qty} pcs × PKR ${fmt(price)}/pc`:`${qty} × PKR ${fmt(price)}`}
                              {disc>0?` · Disc: PKR ${fmt(disc*qty)}`:""}
                            </div>
                          </div>
                          <div style={{color:T.success,fontWeight:800,fontSize:14,whiteSpace:"nowrap"}}>PKR {fmt(lt)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}</div>;
            })()}

            {/* Totals footer */}
            <div style={{borderTop:`1px solid ${T.border}`,marginTop:14,paddingTop:14}}>
              {parseFloat(viewBill.Discount)>0&&<div style={{display:"flex",justifyContent:"space-between",color:T.posGold,fontSize:12,marginBottom:5}}><span>Total Discount</span><span>− PKR {fmt(viewBill.Discount)}</span></div>}
              {(()=>{const r=getRefundForBill(viewBill);if(r.amount<=0)return null;return(<div style={{display:"flex",justifyContent:"space-between",color:T.posOrange,fontSize:12,marginBottom:5,fontWeight:600}}><span>↩ Refund {r.returnNo?`(${r.returnNo})`:""}</span><span>− PKR {fmt(r.amount)}</span></div>);})()}
              {viewBill.PaymentMethod==="Credit"&&(()=>{const prev=getPrevPending(viewBill);if(prev<=0)return null;return(<div style={{display:"flex",justifyContent:"space-between",color:T.posOrange,fontSize:12,marginBottom:5}}><span>Previous Balance</span><span>PKR {fmt(prev)}</span></div>);})()}

              {/* Live recalculated total preview in edit mode */}
              {editItems && (
                <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,marginBottom:8,padding:"8px 12px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8}}>
                  <span style={{color:"#92400e",fontSize:13}}>New Total (preview)</span>
                  <span style={{color:"#92400e",fontSize:16,fontFamily:"Orbitron"}}>PKR {fmt(previewTotal)}</span>
                </div>
              )}

              <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,marginTop:4,padding:"10px 14px",background:T.accentLight,border:`1px solid ${T.accentBorder}`,borderRadius:9}}>
                <span style={{color:T.textPrimary,fontSize:15}}>GRAND TOTAL</span>
                <span style={{color:T.accent,fontSize:20,fontFamily:"Orbitron"}}>PKR {fmt(viewBill.GrandTotal)}</span>
              </div>
              {viewBill.PaymentMethod==="Credit"&&(()=>{const prev=getPrevPending(viewBill);if(prev<=0)return null;return(<div style={{display:"flex",justifyContent:"space-between",fontWeight:800,marginTop:9,padding:"10px 14px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,borderRadius:9}}><span style={{color:T.textPrimary,fontSize:13}}>TOTAL DEBIT (incl. previous)</span><span style={{color:T.danger,fontSize:16,fontFamily:"Orbitron"}}>PKR {fmt(parseFloat(viewBill.GrandTotal)+getPrevPending(viewBill))}</span></div>);})()}
            </div>
            <button className="btn" onClick={()=>reprintBill(viewBill)} style={{width:"100%",marginTop:16,padding:"12px",background:"linear-gradient(135deg,#1d4ed8,#2563eb)",color:"#fff",fontSize:13,borderRadius:9,fontWeight:700,boxShadow:"0 3px 10px rgba(37,99,235,0.3)"}}>🖨 Reprint This Bill</button>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div style={{display:"flex",gap:11,marginBottom:16,flexWrap:"wrap"}}>
        <SummaryCard icon="💰" label="Total Revenue"  value={`PKR ${fmt(totalRev)}`}  color={T.accent}    bg={T.accentLight}  border={T.accentBorder}  />
        <SummaryCard icon="🏷️" label="Total Discount" value={`PKR ${fmt(totalDisc)}`} color={T.warning}   bg={T.warningLight} border={T.warningBorder} />
        <SummaryCard icon="📒" label="Credit Sales"   value={filtered.filter(s=>s.PaymentMethod==="Credit").length} color={T.posOrange} bg="#fff7ed" border="#fed7aa" />
        <SummaryCard icon="🧮" label="Total Bills"    value={filtered.length}          color={T.success}   bg={T.successLight} border={T.successBorder} />
      </div>

      {/* Filters + PDF */}
      <div style={{display:"flex",gap:12,marginBottom:13,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><label style={{...lbSt,marginBottom:4}}>From Date</label><input type="date" value={filterFrom} onChange={e=>setFilterFrom(e.target.value)} style={{...inSt,maxWidth:170,background:T.bgCard}}/></div>
        <div><label style={{...lbSt,marginBottom:4}}>To Date</label><input type="date" value={filterTo} onChange={e=>setFilterTo(e.target.value)} style={{...inSt,maxWidth:170,background:T.bgCard}}/></div>
        <div><label style={{...lbSt,marginBottom:4}}>Cashier</label>
          <select value={filterCashier} onChange={e=>setFilterCashier(e.target.value)} style={{...slSt,background:T.bgCard}}>
            <option value="All">All Cashiers</option>{cashierList.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn" onClick={()=>{setFilterFrom("");setFilterTo("");setFilterCashier("All");}} style={{padding:"9px 14px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,borderRadius:7,fontSize:12}}>Clear</button>
        <button className="btn" onClick={()=>generateSalesPDF(filtered,filterFrom,filterTo,filterCashier)} disabled={filtered.length===0}
          style={{marginLeft:"auto",padding:"9px 20px",background:"linear-gradient(135deg,#b45309,#d97706)",color:"#fff",fontSize:12,fontWeight:700,borderRadius:7,border:"none",opacity:filtered.length===0?0.5:1}}>
          📄 Export PDF ({filtered.length})
        </button>
      </div>

      {/* Table */}
      <div style={card}>
        <div style={{display:"grid",gridTemplateColumns:"85px 95px 70px 110px 130px 100px 100px 120px",...thSt}}>
          <div>BILL#</div><div>DATE</div><div>TIME</div><div>CASHIER</div><div>CUSTOMER</div><div style={{textAlign:"right"}}>TOTAL</div><div>PAYMENT</div><div>CELL</div>
        </div>
        <div style={{maxHeight:420,overflowY:"auto"}}>
          {filtered.length===0
            ?<div style={{textAlign:"center",padding:40,color:T.textMuted,fontSize:13}}>💰 No sales in this range</div>
            :[...filtered].reverse().map((sale,i)=>{
              const isCredit=sale.PaymentMethod==="Credit";
              const custName=(sale.CustomerName&&sale.CustomerName!=="Unknown"&&sale.CustomerName.trim()!=="")?sale.CustomerName:"Walk-in";
              return(
                <div key={i} onClick={()=>openBill(sale)}
                  style={{display:"grid",gridTemplateColumns:"85px 95px 70px 110px 130px 100px 100px 120px",padding:"9px 12px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",cursor:"pointer",transition:"background 0.12s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{color:T.accent,fontWeight:700,fontSize:12}}>#{sale.BillNo}</div>
                  <div style={{color:T.textSecondary,fontSize:11}}>{sale.Date}</div>
                  <div style={{color:T.textSecondary,fontSize:11}}>{sale.Time}</div>
                  <div style={{color:T.textPrimary,fontSize:12}}>{sale.Cashier}</div>
                  <div style={{color:isCredit?T.posOrange:T.textMuted,fontSize:11,fontWeight:isCredit?700:400}}>{custName}</div>
                  <div style={{color:T.success,textAlign:"right",fontWeight:700,fontSize:12}}>PKR {fmt(sale.GrandTotal)}</div>
                  <div><span style={{background:isCredit?"#fff7ed":T.successLight,color:isCredit?T.posOrange:T.success,border:`1px solid ${isCredit?"#fed7aa":T.successBorder}`,borderRadius:8,padding:"2px 7px",fontSize:10,fontWeight:700}}>{sale.PaymentMethod}</span></div>
                  <div style={{color:T.textMuted,fontSize:10}}>{sale.CustomerCell||"—"}</div>
                </div>
              );
          })}
        </div>
      </div>
      <div style={{marginTop:7,color:T.textMuted,fontSize:11}}>{filtered.length} transactions · 👆 Click any row to view, edit items &amp; reprint</div>
    </div>
  );
}

// ── RETURNS TAB ───────────────────────────────────────────────────────────────
export function ReturnsTab({ returns }) {
  const [filterDate, setFilterDate] = useState("");
  const [viewRet,    setViewRet]    = useState(null);
  const filtered    = returns.filter(r => !filterDate || filterDateMatch(r.Date, filterDate));
  const totalRefund = filtered.reduce((s, r) => s + parseFloat(r.RefundAmount||0), 0);
  return (
    <div>
      <div style={{display:"flex",gap:11,marginBottom:16,flexWrap:"wrap"}}>
        <SummaryCard icon="↩"  label="Total Returns"  value={filtered.length}           color={T.posOrange} bg="#fff7ed"        border="#fed7aa"        />
        <SummaryCard icon="💸" label="Total Refunded" value={`PKR ${fmt(totalRefund)}`}  color={T.danger}    bg={T.dangerLight}  border={T.dangerBorder} />
      </div>
      <div style={{display:"flex",gap:12,marginBottom:13,alignItems:"flex-end"}}>
        <div><label style={{...lbSt,marginBottom:4}}>Filter by Date</label><input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{...inSt,maxWidth:180,background:T.bgCard}}/></div>
        <button className="btn" onClick={()=>setFilterDate("")} style={{padding:"9px 14px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,borderRadius:7,fontSize:12}}>Clear</button>
      </div>
      {viewRet&&(
        <div style={{position:"fixed",inset:0,background:T.bgOverlay,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setViewRet(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:16,padding:24,maxWidth:480,width:"100%",boxShadow:T.shadowLg}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <div style={{fontFamily:"Orbitron",color:T.posOrange,fontSize:15,fontWeight:700}}>Return #{viewRet.ReturnNo}</div>
              <button className="btn" onClick={()=>setViewRet(null)} style={{padding:"5px 11px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:13,borderRadius:6,fontWeight:600}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {[["Orig Bill",viewRet.OrigBillNo],["Date",viewRet.Date],["Cashier",viewRet.Cashier],["Reason",viewRet.Reason]].map(([l,v])=>(
                <div key={l} style={{background:T.bgCardAlt,border:`1px solid ${T.borderLight}`,borderRadius:8,padding:"8px 12px"}}>
                  <div style={{color:T.posOrange,fontSize:10,fontWeight:700}}>{l}</div>
                  <div style={{color:T.textPrimary,fontSize:13,fontWeight:600}}>{v}</div>
                </div>
              ))}
            </div>
            {safeParseItems(viewRet.Items).map((item,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",background:T.bgCardAlt,border:`1px solid ${T.borderLight}`,borderRadius:7,marginBottom:4}}>
                <span style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{item.ItemName} × {item.qty}</span>
                <span style={{color:T.posOrange,fontWeight:700}}>PKR {fmt(item.qty*parseFloat(item.Price||0))}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",marginTop:14,padding:"12px 14px",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:9,fontWeight:700}}>
              <span style={{color:T.textPrimary,fontSize:15}}>REFUND AMOUNT</span>
              <span style={{color:T.posOrange,fontSize:18,fontFamily:"Orbitron"}}>PKR {fmt(viewRet.RefundAmount)}</span>
            </div>
            <button className="btn" onClick={()=>printReturnReceipt(viewRet)} style={{width:"100%",marginTop:13,padding:12,background:"linear-gradient(135deg,#c2410c,#ea580c)",color:"#fff",fontSize:13,borderRadius:9,fontWeight:700}}>🖨 Reprint Return Receipt</button>
          </div>
        </div>
      )}
      <div style={card}>
        <div style={{display:"grid",gridTemplateColumns:"90px 90px 95px 80px 110px 100px",...thSt}}>
          <div>RETURN#</div><div>ORIG BILL</div><div>DATE</div><div>TIME</div><div>CASHIER</div><div style={{textAlign:"right"}}>REFUND</div>
        </div>
        {filtered.length===0?<div style={{textAlign:"center",padding:40,color:T.textMuted,fontSize:13}}>↩ No returns yet</div>
        :[...filtered].reverse().map((r,i)=>(
          <div key={i} onClick={()=>setViewRet(r)}
            style={{display:"grid",gridTemplateColumns:"90px 90px 95px 80px 110px 100px",padding:"9px 12px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",cursor:"pointer"}}
            onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{color:T.posOrange,fontWeight:700,fontSize:12}}>{r.ReturnNo}</div>
            <div style={{color:T.accent,fontSize:12}}>#{r.OrigBillNo}</div>
            <div style={{color:T.textSecondary,fontSize:11}}>{r.Date}</div>
            <div style={{color:T.textSecondary,fontSize:11}}>{r.Time}</div>
            <div style={{color:T.textPrimary,fontSize:12}}>{r.Cashier}</div>
            <div style={{color:T.danger,textAlign:"right",fontWeight:700,fontSize:12}}>PKR {fmt(r.RefundAmount)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PROFIT TAB ────────────────────────────────────────────────────────────────
export function ProfitTab({ sales, items, returns }) {
  const [filterDate,    setFilterDate]    = useState("");
  const [filterCashier, setFilterCashier] = useState("All");
  const [filterCat,     setFilterCat]     = useState("All");
  const cashierList = [...new Set(sales.map(s=>s.Cashier).filter(Boolean))];
  const categories  = [...new Set(items.map(i=>i.Category).filter(Boolean))].sort();
  const itemMap     = new Map(items.map(i=>[i.Barcode,i]));
  const filtered    = sales.filter(s=>filterDateMatch(s.Date,filterDate)&&(filterCashier==="All"||s.Cashier===filterCashier));
  let totalRevenue=0,totalCost=0,totalDiscount=0,totalRefund=0;
  const categoryProfit={},topItems={};
  filtered.forEach(sale=>{
    const si=safeParseItems(sale.ItemsDetail);
    si.forEach(si=>{
      if(filterCat!=="All"&&si.Category!==filterCat)return;
      const master=itemMap.get(si.Barcode);
      const sell=parseFloat(si.Price||0),cost=parseFloat(master?.CostPrice||si.CostPrice||0),disc=parseFloat(si.Discount||0),qty=parseInt(si.qty)||1;
      const revenue=(sell-disc)*qty,cst=cost*qty,profit=revenue-cst;
      totalRevenue+=revenue;totalCost+=cst;
      const cat=si.Category||"Unknown";
      if(!categoryProfit[cat])categoryProfit[cat]={revenue:0,cost:0,profit:0,qty:0};
      categoryProfit[cat].revenue+=revenue;categoryProfit[cat].cost+=cst;categoryProfit[cat].profit+=profit;categoryProfit[cat].qty+=qty;
      if(!topItems[si.Barcode])topItems[si.Barcode]={name:si.ItemName,revenue:0,profit:0,qty:0};
      topItems[si.Barcode].revenue+=revenue;topItems[si.Barcode].profit+=profit;topItems[si.Barcode].qty+=qty;
    });
    totalDiscount+=parseFloat(sale.Discount||0);
  });
  returns.filter(r=>filterDateMatch(r.Date,filterDate)).forEach(r=>{totalRefund+=parseFloat(r.RefundAmount||0);});
  const netRevenue=totalRevenue-totalRefund,netProfit=netRevenue-totalCost,margin=netRevenue>0?(netProfit/netRevenue*100).toFixed(1):0;
  const topList=Object.entries(topItems).sort((a,b)=>b[1].profit-a[1].profit).slice(0,10);
  return (
    <div>
      <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><label style={{...lbSt,marginBottom:4}}>Date</label><input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{...inSt,maxWidth:180,background:T.bgCard}}/></div>
        <div><label style={{...lbSt,marginBottom:4}}>Cashier</label><select value={filterCashier} onChange={e=>setFilterCashier(e.target.value)} style={{...slSt,background:T.bgCard}}><option value="All">All</option>{cashierList.map(c=><option key={c}>{c}</option>)}</select></div>
        <div><label style={{...lbSt,marginBottom:4}}>Category</label><select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{...slSt,background:T.bgCard}}><option value="All">All</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
        <button className="btn" onClick={()=>{setFilterDate("");setFilterCashier("All");setFilterCat("All");}} style={{padding:"9px 14px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,borderRadius:7,fontSize:12}}>Clear</button>
      </div>
      {totalCost===0&&<div style={{background:T.warningLight,border:`1px solid ${T.warningBorder}`,borderRadius:10,padding:"13px 18px",marginBottom:16,color:T.warning,fontSize:12}}>⚠ Set Cost Price on items for accurate profit.</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:11,marginBottom:18}}>
        <SummaryCard icon="💰" label="Net Revenue"    value={`PKR ${fmt(netRevenue)}`}    color={T.accent}    bg={T.accentLight}  border={T.accentBorder}  />
        <SummaryCard icon="🏭" label="Total Cost"     value={`PKR ${fmt(totalCost)}`}     color={T.danger}    bg={T.dangerLight}  border={T.dangerBorder}  />
        <SummaryCard icon="📈" label="Net Profit"     value={`PKR ${fmt(netProfit)}`}     color={netProfit>=0?T.success:T.danger} bg={netProfit>=0?T.successLight:T.dangerLight} border={netProfit>=0?T.successBorder:T.dangerBorder} />
        <SummaryCard icon="%" label="Profit Margin"  value={`${margin}%`}                color={T.posGold}   bg="#fffbeb"        border="#fde68a"         />
        <SummaryCard icon="🏷" label="Total Discount" value={`PKR ${fmt(totalDiscount)}`} color="#7c3aed"     bg="#f5f3ff"        border="#ddd6fe"         />
        <SummaryCard icon="↩" label="Refunds"        value={`PKR ${fmt(totalRefund)}`}   color={T.posOrange} bg="#fff7ed"        border="#fed7aa"         />
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {[["PROFIT BY CATEGORY",Object.entries(categoryProfit).sort((a,b)=>b[1].profit-a[1].profit),([cat,data])=>
          <div style={{padding:"9px 14px",borderBottom:`1px solid ${T.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{cat}</div><div style={{color:T.textMuted,fontSize:10}}>Rev: PKR {fmt(data.revenue)} · Qty: {data.qty}</div></div>
            <div style={{textAlign:"right"}}><div style={{color:data.profit>=0?T.success:T.danger,fontWeight:700,fontSize:13}}>PKR {fmt(data.profit)}</div><div style={{color:T.textMuted,fontSize:10}}>{data.revenue>0?(data.profit/data.revenue*100).toFixed(1):0}%</div></div>
          </div>],
         ["TOP ITEMS BY PROFIT",topList,([bc,data])=>
          <div style={{padding:"9px 14px",borderBottom:`1px solid ${T.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{data.name||bc}</div><div style={{color:T.textMuted,fontSize:10}}>Sold: {data.qty} units</div></div>
            <div style={{textAlign:"right"}}><div style={{color:T.success,fontWeight:700,fontSize:13}}>PKR {fmt(data.profit)}</div><div style={{color:T.textMuted,fontSize:10}}>Rev: PKR {fmt(data.revenue)}</div></div>
          </div>]
        ].map(([title,list,renderRow])=>(
          <div key={title} style={card}>
            <div style={{padding:"10px 14px",...thSt,fontSize:10,letterSpacing:1.5}}>{title}</div>
            {list.length===0?<div style={{padding:20,color:T.textMuted,textAlign:"center",fontSize:12}}>No data</div>:list.map((entry,i)=><div key={i}>{renderRow(entry)}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}
