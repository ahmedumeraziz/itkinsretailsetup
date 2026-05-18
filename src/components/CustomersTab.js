import { useState, useEffect, useRef } from "react";
import { T, inSt, lbSt } from "../config";
import { fmt } from "../utils/helpers";
import { dbPut, dbGet, dbDelete } from "../utils/db";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function normBill(b) { const n=String(b||"").replace(/[^0-9]/g,""); return n.replace(/^0+/,"")||"0"; }

function getUniqueBillNos(c) {
  const seen=new Set();
  return (c.BillNo||"").split(",").filter(Boolean).map(b=>b.trim()).filter(b=>{
    const n=normBill(b); if(seen.has(n))return false; seen.add(n); return true;
  });
}
function getCustomerSalesAll(c,sales) {
  return getUniqueBillNos(c).map(bn=>{const norm=normBill(bn);return sales.find(s=>normBill(s.BillNo)===norm);}).filter(Boolean);
}
function getPendingBalance(c,sales) {
  const custSales   =getCustomerSalesAll(c,sales);
  const totalCredit =custSales.filter(s=>s.PaymentMethod==="Credit").reduce((sum,s)=>sum+parseFloat(s.GrandTotal||0),0);
  const openingDebit=parseFloat(c.openingDebit||0);
  const totalPaid   =(c.payments||[]).reduce((sum,p)=>sum+parseFloat(p.amount||0),0);
  return Math.max(0,totalCredit+openingDebit-totalPaid);
}
function getTotalBilledAll(c,sales) {
  return getCustomerSalesAll(c,sales).reduce((sum,s)=>sum+parseFloat(s.GrandTotal||0),0);
}
function parseDate(d) {
  if(!d)return 0;
  if(d.includes("/")){ const parts=d.split("/"); if(parts.length===3){ const dd=parts[0].padStart(2,"0"),mm=parts[1].padStart(2,"0"),yy=parts[2]; return parseInt(`${yy}${mm}${dd}`); } }
  return parseInt(d.replace(/-/g,""));
}
function inputToNum(d) { return d?parseInt(d.replace(/-/g,"")):0; }
function generatePID() {
  const now=new Date(),d=now.toISOString().slice(0,10).replace(/-/g,""),t=now.toTimeString().slice(0,8).replace(/:/g,""),rand=Math.floor(Math.random()*9000+1000);
  return `RP-${d}-${t}-${rand}`;
}

// ─── PRINT PAYMENT RECEIPT ────────────────────────────────────────────────────
function printPaymentReceipt({customer,amountReceived,date,note,pid,pendingBefore,remainingAfter}) {
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;width:302px;padding:10px 6px;color:#000}
  .sn{font-size:15px;font-weight:bold;text-align:center}.dv{border-top:1px dashed #000;margin:5px 0}
  .bi{display:flex;justify-content:space-between;font-size:10px;margin:1px 0}.row{display:flex;justify-content:space-between;margin:5px 0;font-size:12px}
  .big{font-size:14px;font-weight:bold}.ft{text-align:center;font-size:10px;margin-top:8px}@media print{body{margin:0}}</style>
  </head><body>
  <div class="sn">MIAN TRADERS</div><div class="dv"></div>
  <div class="bi"><span>PAYMENT RECEIPT</span><span>${date}</span></div>
  <div class="bi"><span>Receipt ID:</span><span><b>${pid}</b></span></div>
  <div class="dv"></div>
  <div class="bi"><span>Customer:</span><span><b>${customer.Name}</b></span></div>
  <div class="bi"><span>Cell#:</span><span>${customer.CellNo||"—"}</span></div>
  ${note?`<div class="bi"><span>Note:</span><span>${note}</span></div>`:""}
  <div class="dv"></div>
  <div class="row"><span>Outstanding Balance</span><span>PKR ${fmt(pendingBefore)}</span></div>
  <div class="row big"><span>Amount Received</span><span>PKR ${fmt(amountReceived)}</span></div>
  <div class="dv"></div>
  <div class="row" style="font-weight:bold;font-size:14px">
    <span>Remaining Balance</span>
    <span style="color:${remainingAfter>0?"#c00":"#006600"}">${remainingAfter>0?"PKR "+fmt(remainingAfter):"CLEAR ✓"}</span>
  </div>
  <div class="dv"></div>
  <div class="ft">Thank you!<br><b>Mian Traders</b></div>
  <div style="text-align:center;font-size:9px;margin-top:3px;color:#555">itkins.com | 0304-7414437</div>
  <br/><br/></body></html>`;
  const w=window.open("","_blank","width=340,height=600");
  if(!w){alert("Allow popups!");return;}
  w.document.write(html);w.document.close();setTimeout(()=>{w.focus();w.print();},400);
}

// ── SHARED STYLES ──────────────────────────────────────────────────────────
const card    = { background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:11, overflow:"hidden", boxShadow:T.shadow };
const thSt    = { padding:"9px 12px", background:T.bgTopBar, color:"rgba(255,255,255,0.85)", fontSize:10, letterSpacing:1.5, fontWeight:700 };
const modalBg = { position:"fixed", inset:0, background:T.bgOverlay, zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" };
const modalBox = { background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:16, padding:24, width:420, maxWidth:"95vw", boxShadow:T.shadowLg };
const btnPrimary = { padding:"11px", background:"linear-gradient(135deg,#1d4ed8,#2563eb)", color:"#fff", fontSize:13, fontWeight:700, borderRadius:9, border:"none", width:"100%", boxShadow:"0 3px 10px rgba(37,99,235,0.3)" };
const btnDanger  = { padding:"4px 10px", background:T.dangerLight, border:`1px solid ${T.dangerBorder}`, color:T.danger, fontSize:11, borderRadius:6, fontWeight:600 };
const btnGhost   = { padding:"4px 10px", background:T.bgCardAlt, border:`1px solid ${T.border}`, color:T.textSecondary, fontSize:11, borderRadius:6 };

// ── CUSTOMERS TAB ─────────────────────────────────────────────────────────────
export function CustomersTab({ customers, setCustomers, safeCallScript, sales, currentUser }) {
  const [filterName,      setFilterName]      = useState("");
  const [filterCell,      setFilterCell]      = useState("");
  const [filterBill,      setFilterBill]      = useState("");
  const [dateFrom,        setDateFrom]        = useState("");
  const [dateTo,          setDateTo]          = useState("");
  const [showPayModal,    setShowPayModal]     = useState(false);
  const [ledgerCustomer,  setLedgerCustomer]  = useState(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);

  const filtered = customers.filter(c=>{
    if(filterName&&!c.Name?.toLowerCase().includes(filterName.toLowerCase()))return false;
    if(filterCell&&!c.CellNo?.includes(filterCell))return false;
    if(filterBill){const norm=normBill(filterBill);const bills=getUniqueBillNos(c).map(b=>normBill(b));if(!bills.includes(norm))return false;}
    if(dateFrom||dateTo){
      const from=inputToNum(dateFrom),to=inputToNum(dateTo)||99999999;
      const custSales=getCustomerSalesAll(c,sales);
      if(custSales.length===0)return false;
      if(!custSales.some(s=>{const d=parseDate(s.Date);return d>=(from||0)&&d<=to;}))return false;
    }
    return true;
  });

  const totalPending  = filtered.reduce((s,c)=>s+getPendingBalance(c,sales),0);
  const totalReceived = filtered.reduce((s,c)=>(c.payments||[]).reduce((ps,p)=>ps+parseFloat(p.amount||0),0)+s,0);

  const handleDeleteCustomer = async (c,e) => {
    e.stopPropagation();
    if(!window.confirm(`Delete "${c.Name}"?`))return;
    setCustomers(p=>p.filter(x=>x.CellNo!==c.CellNo));
    try{await dbDelete("customers",c.CellNo);}catch{}
    await safeCallScript({action:"deleteCustomer",CellNo:c.CellNo});
  };

  const exportCSV=()=>{
    const header="Name,CellNo,Bills,TotalBilled,TotalPaid,Pending\n";
    const rows=filtered.map(c=>{
      const tb=getTotalBilledAll(c,sales),tp=(c.payments||[]).reduce((s,p)=>s+parseFloat(p.amount||0),0),pd=getPendingBalance(c,sales);
      return `"${(c.Name||"").replace(/"/g,'""')}","${(c.CellNo||"").replace(/"/g,'""')}","${getUniqueBillNos(c).join(",")}","${tb}","${tp}","${pd}"`;
    }).join("\n");
    const blob=new Blob([header+rows],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`Customers_${new Date().toLocaleDateString("en-GB").replace(/\//g,"-")}.csv`;
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  };

  const inputSm = {...inSt, background:T.bgCard, maxWidth:155};

  return (
    <div>
      {/* Summary */}
      <div style={{display:"flex",gap:11,marginBottom:16,flexWrap:"wrap"}}>
        {[{label:"Total Customers",val:customers.length,color:T.accent,bg:T.accentLight,border:T.accentBorder},{label:"Total Pending (Cr)",val:`PKR ${fmt(totalPending)}`,color:T.danger,bg:T.dangerLight,border:T.dangerBorder},{label:"Total Received",val:`PKR ${fmt(totalReceived)}`,color:T.success,bg:T.successLight,border:T.successBorder}].map((s,i)=>(
          <div key={i} style={{padding:"12px 18px",background:s.bg,border:`1px solid ${s.border}`,borderRadius:10}}>
            <div style={{color:s.color,fontSize:22,fontWeight:800}}>{s.val}</div>
            <div style={{color:T.textMuted,fontSize:11,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:8,marginBottom:13,flexWrap:"wrap",alignItems:"center"}}>
        <input value={filterName} onChange={e=>setFilterName(e.target.value)} placeholder="Filter by Name..."  style={{...inputSm,maxWidth:160}} />
        <input value={filterCell} onChange={e=>setFilterCell(e.target.value)} placeholder="Filter by Cell#..." style={{...inputSm,maxWidth:145}} />
        <input value={filterBill} onChange={e=>setFilterBill(e.target.value)} placeholder="Filter by Bill#..." style={{...inputSm,maxWidth:130}} />
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <label style={{color:T.accent,fontSize:10,whiteSpace:"nowrap",fontWeight:700}}>FROM</label>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{...inputSm,maxWidth:148,padding:"7px 9px",fontSize:11}} />
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <label style={{color:T.accent,fontSize:10,whiteSpace:"nowrap",fontWeight:700}}>TO</label>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{...inputSm,maxWidth:148,padding:"7px 9px",fontSize:11}} />
        </div>
        <button className="btn" onClick={()=>{setFilterName("");setFilterCell("");setFilterBill("");setDateFrom("");setDateTo("");}} style={{...btnGhost,padding:"8px 13px",fontSize:12}}>Clear</button>
        <button className="btn" onClick={()=>setShowAddCustomer(true)} style={{padding:"8px 16px",background:"linear-gradient(135deg,#047857,#059669)",color:"#fff",fontSize:12,fontWeight:700,borderRadius:7,border:"none"}}>+ Add Customer</button>
        {currentUser?.Role==="admin"&&<button className="btn" onClick={()=>setShowPayModal(true)} style={{padding:"8px 16px",background:"linear-gradient(135deg,#1d4ed8,#2563eb)",color:"#fff",fontSize:12,fontWeight:700,borderRadius:7,border:"none"}}>💰 Receive Payment</button>}
        <button className="btn" onClick={exportCSV} style={{marginLeft:"auto",padding:"8px 16px",background:"linear-gradient(135deg,#b45309,#d97706)",color:"#fff",fontSize:12,fontWeight:700,borderRadius:7,border:"none"}}>📥 Export CSV</button>
      </div>

      {/* Table */}
      <div style={card}>
        <div style={{display:"grid",gridTemplateColumns:currentUser?.Role==="admin"?"1fr 160px 1fr 110px 110px 80px":"1fr 160px 1fr 110px 110px",...thSt}}>
          <div>NAME</div><div>CELL NUMBER</div><div>BILL NO(S)</div>
          <div style={{textAlign:"right"}}>TOTAL BILLED</div>
          <div style={{textAlign:"right"}}>PENDING</div>
          {currentUser?.Role==="admin"&&<div style={{textAlign:"center"}}>ACTION</div>}
        </div>
        <div style={{maxHeight:500,overflowY:"auto"}}>
          {filtered.length===0
            ?<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:140,color:T.textMuted,gap:8}}><div style={{fontSize:30}}>👥</div><div style={{fontSize:13}}>No customers found</div></div>
            :filtered.map((c,i)=>{
              const totalBilled=getTotalBilledAll(c,sales),pending=getPendingBalance(c,sales),uniqueBills=getUniqueBillNos(c);
              return(
                <div key={i} onClick={()=>setLedgerCustomer(c)}
                  style={{display:"grid",gridTemplateColumns:currentUser?.Role==="admin"?"1fr 160px 1fr 110px 110px 80px":"1fr 160px 1fr 110px 110px",padding:"11px 14px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",cursor:"pointer",transition:"background 0.12s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#1d4ed8,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:14,flexShrink:0,boxShadow:"0 2px 8px rgba(37,99,235,0.25)"}}>{c.Name?.[0]?.toUpperCase()||"?"}</div>
                    <div>
                      <div style={{color:T.textPrimary,fontSize:13,fontWeight:600}}>{c.Name||"—"}</div>
                      {c.openingDebit>0&&<div style={{fontSize:9,color:T.posOrange,fontWeight:600}}>Opening: PKR {fmt(c.openingDebit)}</div>}
                    </div>
                  </div>
                  <div style={{color:T.accent,fontSize:12,fontFamily:"monospace"}}>{c.CellNo||"—"}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {uniqueBills.slice(0,6).map(b=><span key={b} style={{padding:"2px 7px",borderRadius:12,background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:10,fontWeight:700}}>#{b}</span>)}
                    {uniqueBills.length>6&&<span style={{color:T.textMuted,fontSize:10}}>+{uniqueBills.length-6}</span>}
                  </div>
                  <div style={{textAlign:"right",color:T.success,fontSize:12,fontWeight:700}}>PKR {fmt(totalBilled)}</div>
                  <div style={{textAlign:"right",color:pending>0?T.danger:T.success,fontSize:12,fontWeight:700}}>{pending>0?`PKR ${fmt(pending)}`:"✓ Paid"}</div>
                  {currentUser?.Role==="admin"&&(
                    <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:5}}>
                      <button className="btn" onClick={e=>{e.stopPropagation();setEditingCustomer(c);}} style={{padding:"4px 10px",background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:11,borderRadius:5,fontWeight:600}}>Edit</button>
                      <button className="btn" onClick={e=>handleDeleteCustomer(c,e)} style={btnDanger}>Del</button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {showAddCustomer&&<AddCustomerModal customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} onClose={()=>setShowAddCustomer(false)}/>}
      {showPayModal&&<ReceivePaymentModal customers={customers} setCustomers={setCustomers} sales={sales} safeCallScript={safeCallScript} onClose={()=>setShowPayModal(false)}/>}
      {ledgerCustomer&&<CustomerLedgerModal customer={customers.find(c=>c.CellNo===ledgerCustomer.CellNo)||ledgerCustomer} customers={customers} setCustomers={setCustomers} sales={sales} safeCallScript={safeCallScript} onClose={()=>setLedgerCustomer(null)}/>}
      {editingCustomer&&<EditCustomerModal customer={editingCustomer} customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} onClose={()=>setEditingCustomer(null)}/>}
    </div>
  );
}

// ─── ADD CUSTOMER ─────────────────────────────────────────────────────────────
function AddCustomerModal({customers,setCustomers,safeCallScript,onClose}) {
  const [name,setName]=useState(""),[cell,setCell]=useState(""),[openingDebit,setOpeningDebit]=useState(""),[msg,setMsg]=useState("");
  const handleSave=async()=>{
    if(!name.trim()||!cell.trim()){setMsg("Name and Cell# required.");return;}
    if(customers.find(c=>c.CellNo===cell.trim())){setMsg("Customer with this cell# exists.");return;}
    const debit=parseFloat(openingDebit)||0,newCust={Name:name.trim(),CellNo:cell.trim(),BillNo:"",payments:[],openingDebit:debit};
    setCustomers(p=>[...p,newCust]);
    try{await dbPut("customers",{...newCust,id:cell.trim()});}catch{}
    await safeCallScript({action:"saveCustomer",Name:name.trim(),CellNo:cell.trim(),BillNo:"",OpeningDebit:debit});
    onClose();
  };
  return(
    <div style={modalBg}><div style={modalBox}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <div style={{color:T.accent,fontSize:14,fontWeight:700}}>➕ Add New Customer</div>
        <button className="btn" onClick={onClose} style={btnDanger}>✕</button>
      </div>
      <div style={{marginBottom:12}}><label style={lbSt}>FULL NAME</label><input value={name} onChange={e=>setName(e.target.value)} style={{...inSt,background:T.bgCardAlt}} placeholder="Customer name..." autoFocus/></div>
      <div style={{marginBottom:12}}><label style={lbSt}>CELL NUMBER</label><input value={cell} onChange={e=>setCell(e.target.value)} style={{...inSt,background:T.bgCardAlt}} placeholder="e.g. 0300-1234567"/></div>
      <div style={{marginBottom:16}}>
        <label style={lbSt}>STARTING DEBIT AMOUNT (PKR) — optional</label>
        <input type="number" value={openingDebit} onChange={e=>setOpeningDebit(e.target.value)} style={{...inSt,background:T.bgCardAlt,border:`1px solid ${T.warningBorder}`}} placeholder="0 — enter if customer already owes" onKeyDown={e=>e.key==="Enter"&&handleSave()}/>
        {parseFloat(openingDebit)>0&&<div style={{marginTop:5,fontSize:11,color:T.posOrange,fontWeight:600}}>⚠ Starts with PKR {fmt(parseFloat(openingDebit))} debit</div>}
      </div>
      {msg&&<div style={{marginBottom:12,color:T.danger,fontSize:12,padding:"8px 12px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,borderRadius:7}}>{msg}</div>}
      <button className="btn" onClick={handleSave} style={btnPrimary}>💾 Save Customer</button>
    </div></div>
  );
}

// ─── EDIT CUSTOMER ────────────────────────────────────────────────────────────
function EditCustomerModal({customer,customers,setCustomers,safeCallScript,onClose}) {
  const [name,setName]=useState(customer.Name||""),[cell,setCell]=useState(customer.CellNo||""),[openingDebit,setOpeningDebit]=useState(customer.openingDebit||""),[msg,setMsg]=useState("");
  const handleSave=async()=>{
    if(!name.trim()||!cell.trim()){setMsg("Name and Cell# required.");return;}
    const debit=parseFloat(openingDebit)||0,updated={...customer,Name:name.trim(),CellNo:cell.trim(),openingDebit:debit};
    setCustomers(p=>p.map(c=>c.CellNo===customer.CellNo?updated:c));
    try{await dbPut("customers",{...updated,id:cell.trim()});}catch{}
    await safeCallScript({action:"saveCustomer",Name:name.trim(),CellNo:cell.trim(),BillNo:customer.BillNo||"",OpeningDebit:debit});
    onClose();
  };
  return(
    <div style={modalBg}><div style={modalBox}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <div style={{color:T.accent,fontSize:14,fontWeight:700}}>✏️ Edit Customer</div>
        <button className="btn" onClick={onClose} style={btnDanger}>✕</button>
      </div>
      <div style={{marginBottom:12}}><label style={lbSt}>FULL NAME</label><input value={name} onChange={e=>setName(e.target.value)} style={{...inSt,background:T.bgCardAlt}}/></div>
      <div style={{marginBottom:12}}><label style={lbSt}>CELL NUMBER</label><input value={cell} onChange={e=>setCell(e.target.value)} style={{...inSt,background:T.bgCardAlt}}/></div>
      <div style={{marginBottom:16}}><label style={lbSt}>STARTING DEBIT (PKR)</label><input type="number" value={openingDebit} onChange={e=>setOpeningDebit(e.target.value)} style={{...inSt,background:T.bgCardAlt,border:`1px solid ${T.warningBorder}`}} placeholder="0"/></div>
      {msg&&<div style={{marginBottom:12,color:T.danger,fontSize:12}}>{msg}</div>}
      <button className="btn" onClick={handleSave} style={btnPrimary}>💾 Save</button>
    </div></div>
  );
}

// ─── RECEIVE PAYMENT MODAL ────────────────────────────────────────────────────
function ReceivePaymentModal({customers,setCustomers,sales,safeCallScript,onClose}) {
  const [query,setQuery]=useState(""),[results,setResults]=useState(""),
    [selected,setSelected]=useState(null),[amount,setAmount]=useState(""),
    [note,setNote]=useState("Cash Received"),[date,setDate]=useState(new Date().toISOString().slice(0,10)),
    [msg,setMsg]=useState("");
  const saving=useRef(false);
  useEffect(()=>{const q=query.trim().toLowerCase();if(!q||selected){setResults([]);return;}setResults(customers.filter(c=>c.Name?.toLowerCase().includes(q)||c.CellNo?.includes(q)).slice(0,8));},[query,customers,selected]);
  const pending=selected?getPendingBalance(selected,sales):0;
  const received=parseFloat(amount)||0,remaining=Math.max(0,pending-received);
  const handleSave=async()=>{
    if(saving.current)return;
    if(!selected){setMsg("Please select a customer.");return;}
    if(received<=0){setMsg("Please enter a valid amount.");return;}
    saving.current=true;
    const pid=generatePID(),payment={pid,date,amount:received,note:note.trim()||"Cash Received"};
    const updatedPayments=[...(selected.payments||[]),payment];
    setCustomers(prev=>prev.map(c=>c.CellNo===selected.CellNo?{...c,payments:updatedPayments}:c));
    try{const dbC=await dbGet("customers",selected.CellNo);if(dbC)await dbPut("customers",{...dbC,payments:updatedPayments});}catch{}
    await safeCallScript({action:"syncPayments",CellNo:selected.CellNo.trim(),payments:JSON.stringify(updatedPayments)});
    printPaymentReceipt({customer:selected,amountReceived:received,date,note:payment.note,pid,pendingBefore:pending,remainingAfter:remaining});
    saving.current=false;onClose();
  };
  return(
    <div style={modalBg}><div style={{...modalBox,width:460}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <div style={{color:T.accent,fontSize:14,fontWeight:700}}>💰 Receive Payment</div>
        <button className="btn" onClick={onClose} style={btnDanger}>✕</button>
      </div>
      <label style={{...lbSt,marginBottom:5}}>SEARCH CUSTOMER</label>
      <div style={{position:"relative",marginBottom:14}}>
        <input value={query} onChange={e=>{setQuery(e.target.value);if(selected)setSelected(null);}} placeholder="Type name or cell number..." style={{...inSt,width:"100%",background:T.bgCardAlt}}/>
        {Array.isArray(results)&&results.length>0&&(
          <div style={{position:"absolute",top:"100%",left:0,right:0,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:9,zIndex:10,boxShadow:T.shadowLg}}>
            {results.map((c,i)=>(
              <div key={i} onClick={()=>{setSelected(c);setQuery(c.Name);setResults([]);}} style={{padding:"9px 12px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",transition:"background 0.12s"}}
                onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div><div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{c.Name}</div><div style={{color:T.accent,fontSize:11,fontFamily:"monospace"}}>{c.CellNo}</div></div>
                {getPendingBalance(c,sales)>0&&<span style={{color:T.danger,fontSize:11,fontWeight:700,background:T.dangerLight,padding:"2px 8px",borderRadius:12}}>PKR {fmt(getPendingBalance(c,sales))}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      {selected&&(
        <div style={{background:T.accentLight,border:`1px solid ${T.accentBorder}`,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
          <div style={{color:T.textPrimary,fontWeight:700,fontSize:14,marginBottom:2}}>{selected.Name}</div>
          <div style={{color:T.accent,fontSize:11,fontFamily:"monospace",marginBottom:10}}>{selected.CellNo}</div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:received>0?6:0}}>
            <span style={{color:T.textSecondary,fontSize:12}}>Outstanding Balance</span>
            <span style={{color:pending>0?T.danger:T.success,fontWeight:700,fontSize:14}}>PKR {fmt(pending)}</span>
          </div>
          {received>0&&<>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{color:T.textSecondary,fontSize:12}}>Amount Receiving</span><span style={{color:T.accent,fontWeight:700,fontSize:14}}>PKR {fmt(received)}</span></div>
            <div style={{borderTop:`1px dashed ${T.border}`,paddingTop:8,display:"flex",justifyContent:"space-between"}}><span style={{color:T.textPrimary,fontSize:13,fontWeight:700}}>Remaining After</span><span style={{color:remaining>0?T.danger:T.success,fontWeight:800,fontSize:15}}>{remaining>0?`PKR ${fmt(remaining)}`:"✓ CLEAR"}</span></div>
          </>}
        </div>
      )}
      <div style={{display:"flex",gap:10,marginBottom:12}}>
        <div style={{flex:1}}><label style={{...lbSt,marginBottom:5}}>AMOUNT (PKR)</label><input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Enter amount" style={{...inSt,width:"100%",fontSize:15,background:T.bgCardAlt}}/></div>
        <div style={{flex:1}}><label style={{...lbSt,marginBottom:5}}>DATE</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{...inSt,width:"100%",background:T.bgCardAlt}}/></div>
      </div>
      <div style={{marginBottom:16}}><label style={{...lbSt,marginBottom:5}}>NOTE</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Cash received, Bank transfer..." style={{...inSt,width:"100%",background:T.bgCardAlt}}/></div>
      {msg&&<div style={{marginBottom:12,padding:"8px 12px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,borderRadius:7,color:T.danger,fontSize:12}}>{msg}</div>}
      <button className="btn" onClick={handleSave} style={btnPrimary}>🖨 Save &amp; Print Receipt</button>
    </div></div>
  );
}

// ─── CUSTOMER LEDGER MODAL ────────────────────────────────────────────────────
function CustomerLedgerModal({customer,customers,setCustomers,sales,safeCallScript,onClose}) {
  const liveCustomer=customers.find(c=>c.CellNo===customer.CellNo)||customer;
  const custSales=getCustomerSalesAll(liveCustomer,sales);
  const openingDebit=parseFloat(liveCustomer.openingDebit||0);
  const openingRow=openingDebit>0?[{date:"",type:"opening",billNo:null,desc:"Opening Balance (Starting Debit)",debit:openingDebit,credit:0,pid:null}]:[];
  const debitRows=custSales.filter(s=>s.PaymentMethod==="Credit").map(s=>({date:s.Date,type:"debit",billNo:s.BillNo,desc:`Bill #${s.BillNo} (Debit)`,debit:parseFloat(s.GrandTotal||0),credit:0,pid:null}));
  const creditRows=(liveCustomer.payments||[]).map((p,i)=>({date:p.date,type:"credit",billNo:null,desc:`Payment Received${p.note?" — "+p.note:""}`,debit:0,credit:parseFloat(p.amount||0),pid:p.pid||`LEGACY-${i}`,pidLabel:p.pid||"",payIndex:i}));
  const allRows=[...openingRow,...debitRows,...creditRows].sort((a,b)=>{
    const parse=d=>{if(!d)return -1;if(d.includes("/")){ const [dd,mm,yy]=d.split("/");return new Date(`${yy}-${mm}-${dd}`).getTime();}return new Date(d).getTime();};
    const diff=parse(a.date)-parse(b.date);if(diff!==0)return diff;
    const order={opening:0,debit:1,credit:2};return(order[a.type]??1)-(order[b.type]??1);
  });
  let running=0;
  const rows=allRows.map(r=>{running=running+r.debit-r.credit;return{...r,balance:running};});
  const totalDebit=debitRows.reduce((s,r)=>s+r.debit,0)+openingDebit;
  const totalPaid =creditRows.reduce((s,r)=>s+r.credit,0);
  const pending   =Math.max(0,totalDebit-totalPaid);

  const deletePayment=async(pid,payIndex)=>{
    if(!window.confirm("Delete this payment record?"))return;
    let updatedPayments;
    if(pid&&!pid.startsWith("LEGACY-")){updatedPayments=(liveCustomer.payments||[]).filter(p=>p.pid!==pid);}
    else{const target=(liveCustomer.payments||[])[payIndex];if(!target){alert("Payment not found. Please close and reopen.");return;}updatedPayments=(liveCustomer.payments||[]).filter((_,pi)=>pi!==payIndex);}
    setCustomers(prev=>prev.map(c=>c.CellNo===liveCustomer.CellNo?{...c,payments:updatedPayments}:c));
    try{const dbC=await dbGet("customers",liveCustomer.CellNo);if(dbC)await dbPut("customers",{...dbC,payments:updatedPayments});}catch{}
    await safeCallScript({action:"syncPayments",CellNo:liveCustomer.CellNo.trim(),payments:JSON.stringify(updatedPayments)});
  };

  const downloadPDF=()=>{
    let tableRows="";
    rows.forEach(r=>{const pidCell=r.type==="credit"&&r.pidLabel?`<br/><span style="font-size:9px;color:#888">${r.pidLabel}</span>`:"";tableRows+=`<tr><td>${r.date||"—"}</td><td>${r.desc}${r.billNo?` (#${r.billNo})`:""} ${pidCell}</td><td style="color:${r.debit>0?"#c00":"#aaa"};text-align:right">${r.debit>0?`PKR ${r.debit.toLocaleString()}`:"—"}</td><td style="color:${r.credit>0?"#007700":"#aaa"};text-align:right">${r.credit>0?`PKR ${r.credit.toLocaleString()}`:"—"}</td><td style="font-weight:bold;text-align:right;color:${r.balance>0?"#c00":"#007700"}">${r.balance>0?`PKR ${r.balance.toLocaleString()}`:"NIL"}</td></tr>`;});
    const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;color:#000;background:#fff;padding:30px}h1{font-size:20px;text-align:center;margin-bottom:4px}.sub{text-align:center;color:#555;font-size:12px;margin-bottom:20px}.info-box{display:flex;gap:20px;margin-bottom:20px;padding:12px 16px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;flex-wrap:wrap}.info-item{display:flex;flex-direction:column;gap:2px}.info-label{color:#777;font-size:10px;text-transform:uppercase;letter-spacing:1px}.info-val{font-weight:bold;font-size:14px}table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left;font-size:11px;letter-spacing:1px}td{padding:7px 10px;border-bottom:1px solid #eee;font-size:12px}tr:nth-child(even){background:#f7f7f7}.footer{text-align:center;color:#aaa;font-size:10px}@media print{body{padding:10px}}</style></head><body>
    <h1>MART — BAKERY & STORES</h1><div class="sub">Customer Account Statement</div>
    <div class="info-box"><div class="info-item"><span class="info-label">Customer</span><span class="info-val">${liveCustomer.Name}</span></div><div class="info-item"><span class="info-label">Cell#</span><span class="info-val">${liveCustomer.CellNo||"—"}</span></div><div class="info-item"><span class="info-label">Total Debit</span><span class="info-val" style="color:#c00">PKR ${totalDebit.toLocaleString()}</span></div><div class="info-item"><span class="info-label">Total Paid</span><span class="info-val" style="color:#007700">PKR ${totalPaid.toLocaleString()}</span></div><div class="info-item"><span class="info-label">Balance Due</span><span class="info-val" style="color:${pending>0?"#c00":"#007700"}">${pending>0?`PKR ${pending.toLocaleString()}`:"CLEAR ✓"}</span></div></div>
    <table><thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Debit (Dr)</th><th style="text-align:right">Credit (Cr)</th><th style="text-align:right">Balance</th></tr></thead><tbody>${tableRows}</tbody></table>
    <div class="footer">Generated by itKINS POS · itkins.com · 0304-7414437</div><br/></body></html>`;
    const w=window.open("","_blank","width=900,height=700");if(!w){alert("Allow popups!");return;}w.document.write(html);w.document.close();setTimeout(()=>{w.focus();w.print();},450);
  };

  return(
    <div style={modalBg}>
      <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:16,padding:24,width:780,maxWidth:"96vw",maxHeight:"92vh",display:"flex",flexDirection:"column",boxShadow:T.shadowLg}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <div style={{color:T.accent,fontSize:17,fontWeight:800}}>{liveCustomer.Name}</div>
            <div style={{color:T.textMuted,fontSize:12,fontFamily:"monospace"}}>{liveCustomer.CellNo||"—"}</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" onClick={downloadPDF} style={{padding:"8px 16px",background:"linear-gradient(135deg,#b45309,#d97706)",color:"#fff",fontSize:12,fontWeight:700,borderRadius:8,border:"none"}}>📄 Print Statement</button>
            <button className="btn" onClick={onClose} style={{...btnDanger,padding:"7px 13px",fontSize:13}}>✕</button>
          </div>
        </div>
        <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
          {[{label:"Total Debit",val:`PKR ${fmt(totalDebit)}`,color:T.danger,bg:T.dangerLight,border:T.dangerBorder},{label:"Total Paid",val:`PKR ${fmt(totalPaid)}`,color:T.success,bg:T.successLight,border:T.successBorder},{label:"Balance Due",val:pending>0?`PKR ${fmt(pending)}`:"✓ CLEAR",color:pending>0?T.danger:T.success,bg:pending>0?T.dangerLight:T.successLight,border:pending>0?T.dangerBorder:T.successBorder}].map((s,i)=>(
            <div key={i} style={{flex:1,minWidth:140,padding:"10px 15px",background:s.bg,border:`1px solid ${s.border}`,borderRadius:10}}>
              <div style={{color:T.textMuted,fontSize:10,textTransform:"uppercase",letterSpacing:1}}>{s.label}</div>
              <div style={{color:s.color,fontWeight:800,fontSize:16}}>{s.val}</div>
            </div>
          ))}
        </div>
        <div style={{flex:1,border:`1px solid ${T.border}`,borderRadius:10,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          <div style={{display:"grid",gridTemplateColumns:"100px 1fr 115px 115px 105px 28px",padding:"8px 14px",background:T.bgTopBar,color:"rgba(255,255,255,0.85)",fontSize:10,letterSpacing:1.5,fontWeight:700}}>
            <div>DATE</div><div>DESCRIPTION</div>
            <div style={{textAlign:"right"}}>DEBIT (Dr)</div><div style={{textAlign:"right"}}>CREDIT (Cr)</div>
            <div style={{textAlign:"right"}}>BALANCE</div><div/>
          </div>
          <div style={{overflowY:"auto",flex:1,maxHeight:380}}>
            {rows.length===0?<div style={{textAlign:"center",padding:30,color:T.textMuted,fontSize:13}}>No transactions found</div>
            :rows.map((r,i)=>(
              <div key={r.pid||`row-${i}`} style={{display:"grid",gridTemplateColumns:"100px 1fr 115px 115px 105px 28px",padding:"9px 14px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",background:i%2===0?"transparent":T.bgCardAlt,transition:"background 0.12s"}}
                onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":T.bgCardAlt}>
                <div style={{color:T.textMuted,fontSize:11}}>{r.date||"—"}</div>
                <div>
                  <div style={{color:T.textPrimary,fontSize:12,fontWeight:r.type==="debit"?600:400}}>
                    {r.desc}{r.billNo&&<span style={{color:T.accent,marginLeft:5,fontSize:10}}>#{r.billNo}</span>}
                  </div>
                  {r.type==="credit"&&r.pidLabel&&<div style={{color:T.textMuted,fontSize:9,fontFamily:"monospace",marginTop:1}}>{r.pidLabel}</div>}
                </div>
                <div style={{textAlign:"right",color:r.debit>0?T.danger:T.textMuted,fontSize:12,fontWeight:r.debit>0?700:400}}>{r.debit>0?`PKR ${fmt(r.debit)}`:"—"}</div>
                <div style={{textAlign:"right",color:r.credit>0?T.success:T.textMuted,fontSize:12,fontWeight:r.credit>0?700:400}}>{r.credit>0?`PKR ${fmt(r.credit)}`:"—"}</div>
                <div style={{textAlign:"right",color:r.balance>0?T.danger:T.success,fontSize:13,fontWeight:800}}>{r.balance>0?`PKR ${fmt(r.balance)}`:"NIL"}</div>
                <div>
                  {r.type==="credit"&&<button className="btn" title={`Delete ${r.pidLabel||"payment"}`} onClick={()=>deletePayment(r.pid,r.payIndex)} style={{width:22,height:22,background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:11,borderRadius:4,padding:0}}>✕</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
