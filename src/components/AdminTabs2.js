import { useState } from "react";
import { T, inSt, slSt, lbSt } from "../config";
import { fmt, filterDateMatch, safeParseItems } from "../utils/helpers";
import { printReceipt, printReturnReceipt } from "../utils/print";

const card  = { background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, overflow: "hidden", boxShadow: T.shadow };
const thSt  = { padding: "9px 12px", background: T.bgTopBar, color: "rgba(255,255,255,0.85)", fontSize: 10, letterSpacing: 1.5, fontWeight: 700 };
const normBill = b => { const n=String(b||"").replace(/[^0-9]/g,""); return n.replace(/^0+/,"")||"0"; };

function SummaryCard({ icon, label, value, color, bg, border }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 11, padding: "14px 18px", flex: 1, minWidth: 155 }}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
      <div style={{ color: T.textMuted, fontSize: 10, letterSpacing: 1.5, marginBottom: 3, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color, fontSize: 18, fontWeight: 800, fontFamily: "Orbitron" }}>{value}</div>
    </div>
  );
}

// ── SALES TAB ─────────────────────────────────────────────────────────────────
export function SalesTab({ sales, setSales, customers, returns }) {
  const [filterDate,    setFilterDate]    = useState("");
  const [filterCashier, setFilterCashier] = useState("All");
  const [viewBill,      setViewBill]      = useState(null);

  const cashierList = [...new Set(sales.map(s => s.Cashier).filter(Boolean))];
  const filtered    = sales.filter(s =>
    filterDateMatch(s.Date, filterDate) && (filterCashier === "All" || s.Cashier === filterCashier)
  );
  const totalRev  = filtered.reduce((s,r) => s + parseFloat(r.GrandTotal||0), 0);
  const totalDisc = filtered.reduce((s,r) => s + parseFloat(r.Discount||0), 0);

  function getRefundForBill(sale) {
    return { amount: parseFloat(sale.RefundApplied||0), returnNo: sale.RefundReturnNo||"" };
  }

  function getPrevPending(sale) {
    if (sale.PaymentMethod !== "Credit" || !sale.CustomerCell) return 0;
    const c = (customers||[]).find(cx => cx.CellNo === sale.CustomerCell);
    if (!c) return 0;
    const billNos = (c.BillNo||"").split(",").filter(Boolean).map(b=>b.trim());
    const thisNorm = normBill(sale.BillNo);
    const creditBefore = billNos.reduce((sum,bn) => {
      if (normBill(bn) === thisNorm) return sum;
      const s = sales.find(s => normBill(s.BillNo) === normBill(bn));
      if (!s || s.PaymentMethod !== "Credit") return sum;
      return sum + parseFloat(s.GrandTotal||0);
    }, 0);
    const openingDebit = parseFloat(c.openingDebit||0);
    const totalPaid    = (c.payments||[]).reduce((sum,p) => sum+parseFloat(p.amount||0), 0);
    return Math.max(0, creditBefore + openingDebit - totalPaid);
  }

  const reprintBill = sale => {
    const items        = safeParseItems(sale.ItemsDetail);
    const subTotal     = items.reduce((s,i) => s+parseFloat(i.Price||0)*(parseInt(i.qty)||1), 0);
    const itemDiscount = items.reduce((s,i) => s+parseFloat(i.Discount||0)*(parseInt(i.qty)||1), 0);
    const totalDiscount = parseFloat(sale.Discount||0);
    const grandTotal    = parseFloat(sale.GrandTotal||0);
    const isCredit      = sale.PaymentMethod === "Credit";
    const prevPending   = isCredit ? getPrevPending(sale) : 0;
    const refundInfo    = getRefundForBill(sale);
    printReceipt({ billNo:sale.BillNo, date:sale.Date, time:sale.Time, cashier:sale.Cashier, items, subTotal, totalDiscount, itemDiscount, billDiscount: Math.max(0,totalDiscount-itemDiscount), billDiscountPct:0, grandTotal, payments: isCredit?[]:[{type:"cash",amount:grandTotal,last4:""}], change:0, customerName:sale.CustomerName||"", customerCell:sale.CustomerCell||"", refundApplied:refundInfo.amount, refundReturnNo:refundInfo.returnNo, prevPending });
  };

  return (
    <div>
      {/* Bill popup */}
      {viewBill && (
        <div style={{ position:"fixed", inset:0, background:T.bgOverlay, zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={()=>setViewBill(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:16, padding:24, maxWidth:560, width:"100%", maxHeight:"88vh", overflowY:"auto", boxShadow:T.shadowLg }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <div style={{ fontFamily:"Orbitron", color:T.accent, fontSize:17, fontWeight:900 }}>Bill #{viewBill.BillNo}</div>
              <button className="btn" onClick={()=>setViewBill(null)} style={{ padding:"6px 12px", background:T.dangerLight, border:`1px solid ${T.dangerBorder}`, color:T.danger, borderRadius:7, fontSize:13, fontWeight:600 }}>✕ Close</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9, marginBottom:16 }}>
              {[["Date",viewBill.Date],["Time",viewBill.Time],["Cashier",viewBill.Cashier],["Payment",viewBill.PaymentMethod],["Customer",(viewBill.CustomerName&&viewBill.CustomerName!=="Unknown"&&viewBill.CustomerName.trim()!=="")?viewBill.CustomerName:"Walk-in"],["Cell #",viewBill.CustomerCell||"—"]].map(([l,v])=>(
                <div key={l} style={{ background:T.bgCardAlt, border:`1px solid ${T.borderLight}`, borderRadius:8, padding:"9px 12px" }}>
                  <div style={{ color:T.accent, fontSize:10, letterSpacing:1, marginBottom:2, fontWeight:700 }}>{l}</div>
                  <div style={{ color:T.textPrimary, fontSize:13, fontWeight:600 }}>{v}</div>
                </div>
              ))}
            </div>
            {(()=>{
              const items=safeParseItems(viewBill.ItemsDetail);
              if(!items.length) return <div style={{color:T.textMuted,fontSize:12,textAlign:"center",padding:16}}>No item detail available.</div>;
              const grouped={};items.forEach(i=>{const c=i.Category||"Items";if(!grouped[c])grouped[c]=[];grouped[c].push(i);});
              return <div>{Object.keys(grouped).sort().map(cat=>(
                <div key={cat} style={{marginBottom:10}}>
                  <div style={{color:T.accent,fontSize:10,letterSpacing:2,fontWeight:700,marginBottom:5,padding:"4px 8px",background:T.accentLight,borderRadius:5}}>{cat.toUpperCase()}</div>
                  {grouped[cat].map((item,i)=>{const disc=parseFloat(item.Discount||0);const lt=item.qty*parseFloat(item.Price||0)-disc*item.qty;return(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:T.bgCardAlt,border:`1px solid ${T.borderLight}`,borderRadius:7,marginBottom:4}}>
                      <div><div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{item.ItemName||item.Barcode}</div><div style={{color:T.textMuted,fontSize:10}}>{item.qty} x PKR {fmt(item.Price)}{disc>0?` · Disc: PKR ${fmt(disc*item.qty)}`:""}</div></div>
                      <div style={{color:T.success,fontWeight:700,fontSize:13}}>PKR {fmt(lt)}</div>
                    </div>);})}
                </div>
              ))}</div>;
            })()}
            <div style={{ borderTop:`1px solid ${T.border}`, marginTop:14, paddingTop:14 }}>
              {parseFloat(viewBill.Discount)>0&&<div style={{display:"flex",justifyContent:"space-between",color:T.textSecondary,fontSize:12,marginBottom:5}}><span>Total Discount</span><span>− PKR {fmt(viewBill.Discount)}</span></div>}
              {(()=>{const r=getRefundForBill(viewBill);if(r.amount<=0)return null;return(<div style={{display:"flex",justifyContent:"space-between",color:T.posOrange,fontSize:12,marginBottom:5,fontWeight:600}}><span>↩ Refund {r.returnNo?`(${r.returnNo})`:""}</span><span>− PKR {fmt(r.amount)}</span></div>);})()}
              {viewBill.PaymentMethod==="Credit"&&(()=>{const prev=getPrevPending(viewBill);if(prev<=0)return null;return(<div style={{display:"flex",justifyContent:"space-between",color:T.posOrange,fontSize:12,marginBottom:5}}><span>Previous Balance</span><span>PKR {fmt(prev)}</span></div>);})()}
              <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,marginTop:8}}>
                <span style={{color:T.textPrimary,fontSize:15}}>GRAND TOTAL</span>
                <span style={{color:T.accent,fontSize:19,fontFamily:"Orbitron"}}>PKR {fmt(viewBill.GrandTotal)}</span>
              </div>
              {viewBill.PaymentMethod==="Credit"&&(()=>{const prev=getPrevPending(viewBill);if(prev<=0)return null;return(<div style={{display:"flex",justifyContent:"space-between",fontWeight:800,marginTop:9,padding:"8px 12px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,borderRadius:8}}><span style={{color:T.textPrimary,fontSize:13}}>TOTAL DEBIT (incl. previous)</span><span style={{color:T.danger,fontSize:15,fontFamily:"Orbitron"}}>PKR {fmt(parseFloat(viewBill.GrandTotal)+prev)}</span></div>);})()}
            </div>
            <button className="btn" onClick={()=>reprintBill(viewBill)} style={{width:"100%",marginTop:16,padding:"12px",background:"linear-gradient(135deg,#1d4ed8,#2563eb)",color:"#fff",fontSize:13,borderRadius:9,fontWeight:700,boxShadow:"0 3px 10px rgba(37,99,235,0.3)"}}>🖨 Reprint This Bill</button>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div style={{display:"flex",gap:11,marginBottom:16,flexWrap:"wrap"}}>
        <SummaryCard icon="💰" label="Total Revenue"  value={`PKR ${fmt(totalRev)}`}  color={T.accent}   bg={T.accentLight}   border={T.accentBorder}   />
        <SummaryCard icon="🏷️" label="Total Discount" value={`PKR ${fmt(totalDisc)}`} color={T.warning}  bg={T.warningLight}  border={T.warningBorder}  />
        <SummaryCard icon="📒" label="Credit Sales"   value={filtered.filter(s=>s.PaymentMethod==="Credit").length} color={T.posOrange} bg="#fff7ed" border="#fed7aa" />
        <SummaryCard icon="🧮" label="Total Bills"    value={filtered.length}          color={T.success}  bg={T.successLight}  border={T.successBorder}  />
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:12,marginBottom:13,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><label style={{...lbSt,marginBottom:4}}>Filter by Date</label><input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{...inSt,maxWidth:180,background:T.bgCard}} /></div>
        <div><label style={{...lbSt,marginBottom:4}}>Filter by Cashier</label>
          <select value={filterCashier} onChange={e=>setFilterCashier(e.target.value)} style={{...slSt,background:T.bgCard}}>
            <option value="All">All Cashiers</option>{cashierList.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn" onClick={()=>{setFilterDate("");setFilterCashier("All");}} style={{padding:"9px 14px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,borderRadius:7,fontSize:12}}>Clear</button>
      </div>

      {/* Table */}
      <div style={card}>
        <div style={{display:"grid",gridTemplateColumns:"85px 95px 80px 110px 120px 90px 110px 130px",...thSt}}>
          <div>BILL#</div><div>DATE</div><div>TIME</div><div>CASHIER</div><div>CUSTOMER</div><div style={{textAlign:"right"}}>TOTAL</div><div>PAYMENT</div><div>CELL</div>
        </div>
        <div style={{maxHeight:400,overflowY:"auto"}}>
          {[...filtered].reverse().map((sale,i)=>(
            <div key={i} onClick={()=>setViewBill(sale)} style={{display:"grid",gridTemplateColumns:"85px 95px 80px 110px 120px 90px 110px 130px",padding:"9px 12px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",cursor:"pointer",transition:"background 0.12s"}}
              onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div style={{color:T.accent,fontWeight:700,fontSize:12}}>#{sale.BillNo}</div>
              <div style={{color:T.textSecondary,fontSize:11}}>{sale.Date}</div>
              <div style={{color:T.textSecondary,fontSize:11}}>{sale.Time}</div>
              <div style={{color:T.textPrimary,fontSize:12}}>{sale.Cashier}</div>
              <div style={{color:(sale.CustomerName&&sale.CustomerName!=="Unknown"&&sale.CustomerName.trim()!=="")? T.success:T.textMuted,fontSize:11}}>{(sale.CustomerName&&sale.CustomerName!=="Unknown"&&sale.CustomerName.trim()!=="")?sale.CustomerName:"Walk-in"}</div>
              <div style={{color:T.success,textAlign:"right",fontWeight:700,fontSize:12}}>PKR {fmt(sale.GrandTotal)}</div>
              <div style={{color:sale.PaymentMethod==="Credit"?T.posOrange:T.textSecondary,fontSize:11,fontWeight:sale.PaymentMethod==="Credit"?700:400}}>{sale.PaymentMethod}</div>
              <div style={{color:T.textMuted,fontSize:10}}>{sale.CustomerCell||"—"}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{marginTop:7,color:T.textMuted,fontSize:11}}>{filtered.length} transactions · 👆 Click any row to view &amp; reprint</div>
    </div>
  );
}

// ── RETURNS TAB ───────────────────────────────────────────────────────────────
export function ReturnsTab({ returns }) {
  const [filterDate, setFilterDate] = useState("");
  const [viewRet,    setViewRet]    = useState(null);
  const filtered    = returns.filter(r => !filterDate || filterDateMatch(r.Date, filterDate));
  const totalRefund = filtered.reduce((s,r) => s+parseFloat(r.RefundAmount||0), 0);
  return (
    <div>
      <div style={{display:"flex",gap:11,marginBottom:16,flexWrap:"wrap"}}>
        <SummaryCard icon="↩"  label="Total Returns"  value={filtered.length}          color={T.posOrange} bg="#fff7ed" border="#fed7aa" />
        <SummaryCard icon="💸" label="Total Refunded" value={`PKR ${fmt(totalRefund)}`} color={T.danger}    bg={T.dangerLight}  border={T.dangerBorder} />
      </div>
      <div style={{display:"flex",gap:12,marginBottom:13,alignItems:"flex-end"}}>
        <div><label style={{...lbSt,marginBottom:4}}>Filter by Date</label><input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{...inSt,maxWidth:180,background:T.bgCard}} /></div>
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
          <div key={i} onClick={()=>setViewRet(r)} style={{display:"grid",gridTemplateColumns:"90px 90px 95px 80px 110px 100px",padding:"9px 12px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",cursor:"pointer"}}
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
        <SummaryCard icon="💰" label="Net Revenue"    value={`PKR ${fmt(netRevenue)}`}  color={T.accent}   bg={T.accentLight}  border={T.accentBorder} />
        <SummaryCard icon="🏭" label="Total Cost"     value={`PKR ${fmt(totalCost)}`}   color={T.danger}   bg={T.dangerLight}  border={T.dangerBorder} />
        <SummaryCard icon="📈" label="Net Profit"     value={`PKR ${fmt(netProfit)}`}   color={netProfit>=0?T.success:T.danger} bg={netProfit>=0?T.successLight:T.dangerLight} border={netProfit>=0?T.successBorder:T.dangerBorder} />
        <SummaryCard icon="%" label="Profit Margin"  value={`${margin}%`}              color={T.posGold}  bg="#fffbeb"        border="#fde68a" />
        <SummaryCard icon="🏷" label="Total Discount" value={`PKR ${fmt(totalDiscount)}`} color="#7c3aed"  bg="#f5f3ff"        border="#ddd6fe" />
        <SummaryCard icon="↩" label="Refunds"        value={`PKR ${fmt(totalRefund)}`}  color={T.posOrange} bg="#fff7ed"       border="#fed7aa" />
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {[["PROFIT BY CATEGORY",Object.entries(categoryProfit).sort((a,b)=>b[1].profit-a[1].profit),([cat,data])=><div style={{padding:"9px 14px",borderBottom:`1px solid ${T.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{cat}</div><div style={{color:T.textMuted,fontSize:10}}>Rev: PKR {fmt(data.revenue)} · Qty: {data.qty}</div></div><div style={{textAlign:"right"}}><div style={{color:data.profit>=0?T.success:T.danger,fontWeight:700,fontSize:13}}>PKR {fmt(data.profit)}</div><div style={{color:T.textMuted,fontSize:10}}>{data.revenue>0?(data.profit/data.revenue*100).toFixed(1):0}%</div></div></div>],["TOP ITEMS BY PROFIT",topList,([bc,data])=><div style={{padding:"9px 14px",borderBottom:`1px solid ${T.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{data.name||bc}</div><div style={{color:T.textMuted,fontSize:10}}>Sold: {data.qty} units</div></div><div style={{textAlign:"right"}}><div style={{color:T.success,fontWeight:700,fontSize:13}}>PKR {fmt(data.profit)}</div><div style={{color:T.textMuted,fontSize:10}}>Rev: PKR {fmt(data.revenue)}</div></div></div>]].map(([title,list,renderRow])=>(
          <div key={title} style={card}>
            <div style={{padding:"10px 14px",...thSt,fontSize:10,letterSpacing:1.5}}>{title}</div>
            {list.length===0?<div style={{padding:20,color:T.textMuted,textAlign:"center",fontSize:12}}>No data</div>:list.map((entry,i)=><div key={i}>{renderRow(entry)}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}
