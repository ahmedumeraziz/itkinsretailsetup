import { useState, useEffect, useRef } from "react";
import { T, inSt } from "../config";
import { fmt } from "../utils/helpers";

function normBill(b) { const n=String(b||"").replace(/[^0-9]/g,""); return n.replace(/^0+/,"")||"0"; }

function computePending(c, sales) {
  if (!c) return 0;
  const billNos = (c.BillNo||"").split(",").filter(Boolean).map(b=>b.trim());
  const totalCredit = billNos.reduce((sum,bn)=>{
    const norm=normBill(bn);
    const sale=sales.find(s=>normBill(s.BillNo)===norm);
    if(!sale||sale.PaymentMethod!=="Credit")return sum;
    return sum+parseFloat(sale.GrandTotal||0);
  },0);
  const openingDebit=parseFloat(c.openingDebit||0);
  const totalPaid=(c.payments||[]).reduce((sum,p)=>sum+parseFloat(p.amount||0),0);
  return Math.max(0,totalCredit+openingDebit-totalPaid);
}

export default function CashierCustomerLedger({ customers, sales, currentBillTotal, onSelectCustomer, selectedName, selectedCell, onClear }) {
  const [query,          setQuery]          = useState("");
  const [results,        setResults]        = useState([]);
  const [pending,        setPending]        = useState(null);
  const [loadingPending, setLoadingPending] = useState(false);
  const pendingTimer = useRef(null);

  useEffect(() => {
    if (!selectedName||selectedName.trim()===""||selectedName==="Unknown") {
      setQuery(""); setPending(null); setLoadingPending(false);
    }
  }, [selectedName]);

  useEffect(() => {
    const q=query.trim().toLowerCase();
    if (!q) { setResults([]); return; }
    setResults(customers.filter(c=>c.Name?.toLowerCase().includes(q)||c.CellNo?.includes(q)).slice(0,6));
  }, [query, customers]);

  useEffect(() => {
    if (!selectedCell) { setPending(null); return; }
    setLoadingPending(true);
    clearTimeout(pendingTimer.current);
    pendingTimer.current=setTimeout(()=>{
      const c=customers.find(cx=>cx.CellNo===selectedCell);
      setPending(c?computePending(c,sales):0);
      setLoadingPending(false);
    },1500);
    return ()=>clearTimeout(pendingTimer.current);
  },[selectedCell,customers,sales]);

  const handleSelect = c => { setQuery(""); setResults([]); setPending(null); setLoadingPending(true); onSelectCustomer(c.Name,c.CellNo); };
  const isSelected   = selectedName&&selectedName.trim()!==""&&selectedName!=="Unknown";
  const totalAfter   = (pending||0)+currentBillTotal;

  const rowSt = (bg,border) => ({ display:"flex",justifyContent:"space-between",alignItems:"center",background:bg,border:`1px solid ${border}`,borderRadius:8,padding:"7px 11px",marginBottom:5 });

  return (
    <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:11, padding:"12px 14px", boxShadow:T.shadow }}>
      <div style={{ color:T.accent, fontSize:10, letterSpacing:2, fontWeight:700, marginBottom:9, textTransform:"uppercase" }}>👤 Customer Ledger</div>

      {!isSelected ? (
        <div style={{ position:"relative" }}>
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search customer by name or cell..." style={{ ...inSt, padding:"8px 11px", fontSize:12, background:T.bgCardAlt }} />
          {results.length>0&&(
            <div style={{ position:"absolute",top:"100%",left:0,right:0,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:9,zIndex:200,boxShadow:T.shadowLg }}>
              {results.map((c,i)=>{
                const p=computePending(c,sales);
                return(
                  <div key={i} onClick={()=>handleSelect(c)} style={{padding:"9px 12px",cursor:"pointer",borderBottom:`1px solid ${T.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center",transition:"background 0.12s"}}
                    onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div>
                      <div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{c.Name}</div>
                      <div style={{color:T.accent,fontSize:10,fontFamily:"monospace"}}>{c.CellNo}</div>
                    </div>
                    {p>0&&<span style={{color:"#dc2626",fontSize:11,fontWeight:700,background:"#fef2f2",padding:"2px 8px",borderRadius:12}}>PKR {fmt(p)}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}>
            <div>
              <div style={{color:T.textPrimary,fontWeight:700,fontSize:13}}>{selectedName}</div>
              <div style={{color:T.accent,fontSize:11,fontFamily:"monospace"}}>{selectedCell}</div>
            </div>
            <button className="btn" onClick={onClear} style={{padding:"4px 9px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:11,borderRadius:6,fontWeight:600}}>✕</button>
          </div>

          {/* Previous Pending */}
          <div style={rowSt(loadingPending?T.bgCardAlt:pending>0?"#fef2f2":T.successLight, loadingPending?T.border:pending>0?T.dangerBorder:T.successBorder)}>
            <span style={{color:T.textSecondary,fontSize:11}}>Previous Pending</span>
            {loadingPending
              ? <span style={{display:"flex",alignItems:"center",gap:5,color:T.textMuted,fontSize:11}}><span style={{width:10,height:10,border:`2px solid ${T.accent}33`,borderTop:`2px solid ${T.accent}`,borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}}/>Syncing...</span>
              : <span style={{color:pending>0?"#dc2626":T.success,fontWeight:700,fontSize:13}}>{pending>0?`PKR ${fmt(pending)}`:"NIL ✓"}</span>
            }
          </div>

          {/* Today's Purchase */}
          <div style={rowSt(T.accentLight,T.accentBorder)}>
            <span style={{color:T.textSecondary,fontSize:11}}>Today's Purchase</span>
            <span style={{color:T.accent,fontWeight:700,fontSize:13}}>PKR {fmt(currentBillTotal)}</span>
          </div>

          {/* Total After Bill */}
          <div style={rowSt(T.successLight,T.successBorder)}>
            <span style={{color:T.textSecondary,fontSize:11}}>Total After Bill</span>
            {loadingPending
              ? <span style={{color:T.textMuted,fontSize:13}}>—</span>
              : <span style={{color:T.success,fontWeight:800,fontSize:14}}>PKR {fmt(totalAfter)}</span>
            }
          </div>
        </div>
      )}
    </div>
  );
}
