import { useState, useEffect, useRef, useCallback } from "react";
import { T, inSt, bdgSt } from "../config";
import { fmt, getNow, safeParseItems } from "../utils/helpers";
import { printReceipt } from "../utils/print";
import StatusBar from "./StatusBar";
import Calculator from "./Calculator";
import ReturnModal, { RefundApplyPanel } from "./ReturnModal";
import CashierCustomerLedger from "./CashierCustomerLedger";

function emptyBill(id) {
  return { id, cart:[], payments:[{type:"cash",amount:"",last4:""}], saved:false, lastBill:null, billDiscPct:0, customerName:"", customerCell:"", cashReceived:"" };
}

export default function POSScreen({ user, items, categories, billCounter, onLogout, onSaleSaved, sheetStatus, isOnline, lastSync, onRefresh, searchIndex, itemMap, sales, returns, returnCounter, onReturnSaved, onMarkReturnUsed, customers, setCustomers }) {
  const [bills,          setBills]          = useState([emptyBill(1)]);
  const [activeBillId,   setActiveBillId]   = useState(1);
  const [nextBillId,     setNextBillId]     = useState(2);
  const [search,         setSearch]         = useState("");
  const [results,        setResults]        = useState([]);
  const [kbIndex,        setKbIndex]        = useState(-1);
  const [tick,           setTick]           = useState(getNow());
  const [localCounter,   setLocalCounter]   = useState(billCounter);
  const [showCalc,       setShowCalc]       = useState(false);
  const [isFS,           setIsFS]           = useState(false);
  const [showReturn,     setShowReturn]     = useState(false);
  const [focusedQtyBarcode, setFocusedQtyBarcode] = useState(null);

  const searchRef  = useRef();
  const resultsRef = useRef([]); resultsRef.current = results;
  const qtyRefs    = useRef({});
  const scanBuffer = useRef(""); const scanTimer = useRef(null);
  const lastKeyTime = useRef(0);

  useEffect(() => { setLocalCounter(billCounter); }, [billCounter]);
  useEffect(() => { const t = setInterval(() => setTick(getNow()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { setKbIndex(-1); }, [results]);
  useEffect(() => { if (focusedQtyBarcode) { const r=qtyRefs.current[focusedQtyBarcode]; if(r){r.focus();r.select();} } }, [focusedQtyBarcode]);

  useEffect(() => {
    const q = search.trim();
    if (q.length<1) { setResults([]); return; }
    const timer = setTimeout(() => {
      if (searchIndex.size>0) {
        const normB = b=>{const n=String(b||"").replace(/[^0-9]/g,"");return n.replace(/^0+/,"")||"0";};
        const qL=q.toLowerCase();
        if(itemMap.has(q)){setResults([itemMap.get(q)]);return;}
        const tokens=qL.split(/\s+/);let resultSet=null;
        tokens.forEach(token=>{const matches=searchIndex.get(token)||new Set();if(resultSet===null)resultSet=new Set(matches);else{for(const b of resultSet){if(!matches.has(b))resultSet.delete(b);}}});
        if(!resultSet){setResults([]);return;}
        setResults(Array.from(resultSet).map(bc=>itemMap.get(bc)).filter(Boolean).slice(0,12));
      } else {
        setResults(items.filter(i=>i.Barcode?.toLowerCase().includes(q.toLowerCase())||i.ItemName?.toLowerCase().includes(q.toLowerCase())).slice(0,12));
      }
    },120);
    return ()=>clearTimeout(timer);
  },[search,searchIndex,itemMap,items]);

  const toggleFS = ()=>{if(!document.fullscreenElement){document.documentElement.requestFullscreen().catch(()=>{});setIsFS(true);}else{document.exitFullscreen();setIsFS(false);}};
  const ab  = bills.find(b=>b.id===activeBillId)||bills[0];
  const upd = fn=>setBills(prev=>prev.map(b=>b.id===activeBillId?fn(b):b));
  const addNewBill=()=>{const id=nextBillId;setBills(p=>[...p,emptyBill(id)]);setActiveBillId(id);setNextBillId(id+1);setSearch("");setResults([]);setTimeout(()=>searchRef.current?.focus(),60);};
  const closeBill=(id,e)=>{e.stopPropagation();if(bills.length===1){setBills([emptyBill(id)]);return;}const rem=bills.filter(b=>b.id!==id);setBills(rem);if(activeBillId===id)setActiveBillId(rem[rem.length-1].id);};

  const focusSearch=useCallback(()=>{setFocusedQtyBarcode(null);setTimeout(()=>{if(searchRef.current){searchRef.current.focus();searchRef.current.select();}},60);},[]);

  const addItem=useCallback(item=>{
    upd(b=>{const ex=b.cart.find(i=>i.Barcode===item.Barcode);return{...b,cart:ex?b.cart.map(i=>i.Barcode===item.Barcode?{...i,qty:i.qty+1}:i):[...b.cart,{...item,qty:1}]};});
    setSearch("");setResults([]);setKbIndex(-1);setFocusedQtyBarcode(null);
    setTimeout(()=>setFocusedQtyBarcode(item.Barcode),50);
  },[]);

  const handleSearchChange=useCallback(e=>{const now=Date.now();lastKeyTime.current=now;setSearch(e.target.value);},[]);
  const handleSearchKeyDown=useCallback(e=>{
    const res=resultsRef.current;
    if(e.key==="ArrowDown"){e.preventDefault();setKbIndex(i=>Math.min(i+1,res.length-1));return;}
    if(e.key==="ArrowUp"){e.preventDefault();setKbIndex(i=>Math.max(i-1,0));return;}
    if(e.key==="Escape"){setSearch("");setResults([]);setKbIndex(-1);return;}
    if(e.key==="Enter"){e.preventDefault();if(res.length>0){const idx=kbIndex>=0?kbIndex:0;if(res[idx])addItem(res[idx]);}scanBuffer.current="";}
  },[kbIndex,addItem]);

  const dropdownRef=useRef();
  useEffect(()=>{if(!dropdownRef.current||kbIndex<0)return;const el=dropdownRef.current.querySelectorAll(".search-item-row")[kbIndex];if(el)el.scrollIntoView({block:"nearest"});},[kbIndex]);

  const setQty=(bc,q)=>upd(b=>({...b,cart:q<=0?b.cart.filter(i=>i.Barcode!==bc):b.cart.map(i=>i.Barcode===bc?{...i,qty:q}:i)}));
  const delItem=bc=>{upd(b=>({...b,cart:b.cart.filter(i=>i.Barcode!==bc)}));if(focusedQtyBarcode===bc){setFocusedQtyBarcode(null);focusSearch();}};
  const voidCart=()=>{upd(b=>({...b,cart:[],payments:[{type:"cash",amount:"",last4:""}],saved:false,billDiscPct:0,customerName:"",customerCell:""}));setFocusedQtyBarcode(null);};
  const setBDP=v=>upd(b=>({...b,billDiscPct:parseFloat(v)||0}));
  const setCustName=v=>upd(b=>({...b,customerName:v}));
  const setCustCell=v=>upd(b=>({...b,customerCell:v}));

  const applyRefund=(refundAmt,returnNo)=>{
    upd(b=>({...b,payments:[...b.payments.filter(p=>p.type!=="refund"),{type:"refund",amount:String(refundAmt),origReturnNo:returnNo}]}));
    onMarkReturnUsed(returnNo);
  };

  const cart         = ab.cart;
  const payments     = ab.payments;
  const billDiscPct  = ab.billDiscPct||0;
  const subTotal     = cart.reduce((s,i)=>s+parseFloat(i.Price||0)*i.qty,0);
  const itemDiscount = cart.reduce((s,i)=>s+parseFloat(i.Discount||0)*i.qty,0);
  const afterItems   = subTotal-itemDiscount;
  const billDiscount = parseFloat(((afterItems*billDiscPct)/100).toFixed(2));
  const refundApplied= payments.filter(p=>p.type==="refund").reduce((s,p)=>s+parseFloat(p.amount||0),0);
  const grandTotal   = afterItems-billDiscount;
  const netTotal     = Math.max(0,grandTotal-refundApplied);
  const totalReceived= payments.filter(p=>p.type!=="refund").reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const change       = totalReceived-netTotal;

  const saveBill=()=>{
    if(cart.length===0)return;
    const {date,time}=getNow();
    const billNo="B"+String(localCounter).padStart(4,"0");
    const totalDiscount=itemDiscount+billDiscount;
    const customerInfo={Name:ab.customerName?.trim()||"Unknown",CellNo:ab.customerCell?.trim()||""};
    const isKnownCustomer=customerInfo.Name&&customerInfo.Name!=="Unknown"&&customerInfo.Name.trim()!==""&&customerInfo.CellNo&&customerInfo.CellNo.trim()!=="";
    const payMethod=isKnownCustomer?"Credit":"Cash";

    const normB=b=>{const n=String(b||"").replace(/[^0-9]/g,"");return n.replace(/^0+/,"")||"0";};
    const existingCustomer=isKnownCustomer?customers.find(c=>c.CellNo===customerInfo.CellNo):null;
    const prevPending=existingCustomer?(()=>{
      const billNos=(existingCustomer.BillNo||"").split(",").filter(Boolean).map(b=>b.trim());
      const totalCredit=billNos.reduce((s,bn)=>{const sale=sales.find(sale=>normB(sale.BillNo)===normB(bn));if(!sale||sale.PaymentMethod!=="Credit")return s;return s+parseFloat(sale.GrandTotal||0);},0);
      const openingDebit=parseFloat(existingCustomer.openingDebit||0);
      const totalPaid=(existingCustomer.payments||[]).reduce((s,p)=>s+parseFloat(p.amount||0),0);
      return Math.max(0,totalCredit+openingDebit-totalPaid);
    })():0;

    const refundPayment=payments.find(p=>p.type==="refund");
    const refundReturnNo=refundPayment?.origReturnNo||"";
    const bill={billNo,date,time,cashier:user.Name,items:cart,subTotal,totalDiscount,itemDiscount,billDiscount,billDiscountPct:billDiscPct,grandTotal:netTotal,payments,change:Math.max(0,parseFloat(ab.cashReceived||0)-netTotal),customerName:customerInfo.Name,customerCell:customerInfo.CellNo,refundApplied,refundReturnNo,prevPending};

    onSaleSaved({BillNo:billNo,Date:date,Time:time,Cashier:user.Name,GrandTotal:netTotal,Discount:totalDiscount,FBR:0,PaymentMethod:payMethod,ItemsDetail:JSON.stringify(cart),items:cart,CustomerName:isKnownCustomer?customerInfo.Name:"Unknown",CustomerCell:isKnownCustomer?customerInfo.CellNo:"",RefundApplied:refundApplied,RefundReturnNo:refundReturnNo},isKnownCustomer?customerInfo:{Name:"Unknown",CellNo:""});

    setLocalCounter(c=>c+1);
    upd(b=>({...b,saved:true,lastBill:bill}));
    printReceipt(bill);
    setFocusedQtyBarcode(null);
    setTimeout(()=>{upd(b=>({...b,cart:[],payments:[{type:"cash",amount:"",last4:""}],saved:false,billDiscPct:0,customerName:"",customerCell:""}));focusSearch();},2500);
  };

  const grouped={}; cart.forEach(item=>{const c=item.Category||"General";if(!grouped[c])grouped[c]=[];grouped[c].push(item);});
  const catKeys=Object.keys(grouped).sort();

  // ── Light Theme Styles ──
  const topBarStyle={background:T.bgTopBar,borderBottom:"none",padding:"8px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,gap:8,boxShadow:"0 2px 8px rgba(0,0,0,0.15)"};
  const tabStyle=(active)=>({display:"flex",alignItems:"center",gap:5,padding:"6px 14px 7px",cursor:"pointer",borderRadius:"8px 8px 0 0",flexShrink:0,background:active?"#fff":"rgba(255,255,255,0.12)",border:active?`1px solid ${T.border}`:"1px solid transparent",borderBottom:active?"1px solid #fff":"1px solid transparent",marginBottom:active?-1:0,color:active?T.accent:"rgba(255,255,255,0.8)",fontSize:12,fontWeight:active?700:400});

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:T.bgPage,overflow:"hidden"}}>
      {/* TOP BAR */}
      <div style={topBarStyle}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{fontFamily:"Orbitron",color:"#fff",fontSize:13,fontWeight:900,letterSpacing:1}}>itKINS POS: MIAN TRADERS</div>
          <div style={{padding:"3px 10px",borderRadius:20,background:"rgba(255,255,255,0.18)",color:"rgba(255,255,255,0.9)",fontSize:11,fontWeight:600}}>{user?.Name?.toUpperCase()}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <div style={{color:"rgba(255,255,255,0.7)",fontSize:11}}>{tick.date} {tick.time}</div>
          <div style={{padding:"3px 10px",borderRadius:20,background:"rgba(255,255,255,0.18)",color:"#fff",fontSize:11,fontWeight:700}}>B{String(localCounter).padStart(4,"0")}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:7,flexShrink:0}}>
          <StatusBar isOnline={isOnline} sheetStatus={sheetStatus} lastSync={lastSync} onRefresh={onRefresh}/>
          <button className="btn" onClick={()=>setShowReturn(true)} style={{padding:"5px 11px",background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.25)",color:"#fff",fontSize:12,borderRadius:6,fontWeight:600}}>↩ Return</button>
          <button className="btn" onClick={()=>setShowCalc(v=>!v)} style={{padding:"5px 11px",background:showCalc?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.25)",color:"#fff",fontSize:14,borderRadius:6}}>🧮</button>
          <button className="btn" onClick={toggleFS} style={{padding:"5px 11px",background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.25)",color:"#fff",fontSize:13,borderRadius:6}}>{isFS?"⤡":"⤢"}</button>
          <button className="btn" onClick={onLogout} style={{padding:"5px 13px",background:"rgba(220,38,38,0.8)",border:"none",color:"#fff",fontSize:11,borderRadius:6,fontWeight:600}}>Logout</button>
        </div>
      </div>

      {/* BILL TABS */}
      <div style={{display:"flex",alignItems:"center",background:T.bgTopBar,padding:"6px 12px 0",gap:4,overflowX:"auto",borderBottom:`1px solid ${T.border}`}}>
        {bills.map(b=>{
          const isA=b.id===activeBillId;
          const bT=b.cart.reduce((s,i)=>s+parseFloat(i.Price||0)*i.qty-parseFloat(i.Discount||0)*i.qty,0);
          return(
            <div key={b.id} onClick={()=>{setActiveBillId(b.id);setTimeout(()=>searchRef.current?.focus(),40);}} style={tabStyle(isA)}>
              <span>Bill {b.id}
                {b.customerName&&b.customerName.trim()!==""&&b.customerName!=="Unknown"&&<span style={{color:T.success,fontSize:10,marginLeft:4}}>· {b.customerName}</span>}
                {b.cart.length>0&&<span style={{color:isA?T.textMuted:"rgba(255,255,255,0.5)",fontSize:10,marginLeft:4}}>({b.cart.length} · PKR {fmt(bT)})</span>}
              </span>
              <span onClick={e=>closeBill(b.id,e)} style={{color:isA?T.textMuted:"rgba(255,255,255,0.5)",fontSize:12,padding:"0 2px"}} onMouseEnter={e=>e.target.style.color=T.danger} onMouseLeave={e=>e.target.style.color=isA?T.textMuted:"rgba(255,255,255,0.5)"}>✕</span>
            </div>
          );
        })}
        <button className="btn" onClick={addNewBill} style={{padding:"5px 12px",background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.25)",color:"rgba(255,255,255,0.9)",fontSize:12,borderRadius:"6px 6px 0 0",flexShrink:0,marginBottom:-1}}>+ New Bill</button>
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        {/* LEFT: Cart */}
        <div style={{flex:1,display:"flex",flexDirection:"column",padding:12,overflow:"hidden",gap:8}}>
          {/* Search */}
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:T.accent,fontSize:18,pointerEvents:"none"}}>⌕</span>
            <input ref={searchRef} value={search} onChange={handleSearchChange} onKeyDown={handleSearchKeyDown} autoFocus
              placeholder="Scan barcode or type item name..."
              style={{...inSt,paddingLeft:36,fontSize:14,background:T.bgCard,boxShadow:T.shadow}} tabIndex={1}/>
            {results.length>0&&(
              <div ref={dropdownRef} style={{position:"absolute",top:"100%",left:0,right:0,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:9,zIndex:200,boxShadow:T.shadowLg,maxHeight:340,overflowY:"auto"}}>
                <div style={{padding:"4px 13px",background:T.accentLight,borderBottom:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:9,letterSpacing:1}}>↑↓ NAVIGATE · ENTER SELECT → QTY · ESC CLOSE</div>
                {results.map((item,i)=>{const stk=Number(item.Stock)||0;const isKb=i===kbIndex;return(
                  <div key={i} className={`search-item-row${isKb?" kb-selected":""}`} onClick={()=>addItem(item)}
                    style={{padding:"9px 13px",cursor:"pointer",borderBottom:`1px solid ${T.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:isKb?T.accentLight:"transparent",borderLeft:isKb?`3px solid ${T.accent}`:"3px solid transparent",transition:"background 0.1s"}}>
                    <div>
                      <div style={{color:T.textPrimary,fontSize:13,fontWeight:600}}>{item.ItemName}</div>
                      <div style={{color:T.textMuted,fontSize:10}}>{item.Barcode} · {item.Category}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:T.accent,fontWeight:700,fontSize:13}}>PKR {fmt(item.Price)}</div>
                      {parseFloat(item.Discount)>0&&<div style={{color:T.posGold,fontSize:10}}>Disc: PKR {fmt(item.Discount)}</div>}
                      <div style={{fontSize:10,color:stk<=0?T.danger:stk<=5?T.warning:T.textMuted}}>Stock: {item.Stock}{stk<=0?" ❌":stk<=5?" ⚠":""}</div>
                    </div>
                  </div>
                );})}
              </div>
            )}
          </div>

          {/* Cart table */}
          <div style={{flex:1,overflowY:"auto",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:10,boxShadow:T.shadow}}>
            <div style={{display:"grid",gridTemplateColumns:"2fr 120px 90px 80px 90px 28px",padding:"8px 12px",background:T.bgTopBar,color:"rgba(255,255,255,0.8)",fontSize:10,letterSpacing:2,fontWeight:700,position:"sticky",top:0}}>
              <div>ITEM</div><div style={{textAlign:"center"}}>QTY</div><div style={{textAlign:"right"}}>PRICE</div><div style={{textAlign:"right"}}>DISC</div><div style={{textAlign:"right"}}>TOTAL</div><div/>
            </div>
            {cart.length===0?(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:180,color:T.textMuted,gap:10}}>
                <div style={{fontSize:36}}>🛒</div><div style={{fontSize:13}}>Scan or search items to add</div>
              </div>
            ):catKeys.map(cat=>(
              <div key={cat}>
                <div style={{padding:"5px 12px",background:T.accentLight,color:T.accent,fontSize:10,letterSpacing:2,fontWeight:700,borderBottom:`1px solid ${T.accentBorder}`}}>── {cat.toUpperCase()} ──</div>
                {grouped[cat].map(item=>{
                  const disc=parseFloat(item.Discount||0);
                  const lt=item.qty*parseFloat(item.Price||0)-disc*item.qty;
                  const isFQ=focusedQtyBarcode===item.Barcode;
                  return(
                    <div key={item.Barcode} style={{display:"grid",gridTemplateColumns:"2fr 120px 90px 80px 90px 28px",padding:"8px 12px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",background:isFQ?T.accentLight:"transparent",transition:"background 0.15s"}}>
                      <div>
                        <div style={{color:T.textPrimary,fontSize:13,fontWeight:600}}>{item.ItemName}</div>
                        <div style={{color:T.textMuted,fontSize:10}}>{item.Barcode}{Number(item.Stock)<=5&&<span style={{color:T.warning,marginLeft:6}}>⚠ Low</span>}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>
                        <button className="btn" onClick={()=>setQty(item.Barcode,item.qty-1)} tabIndex={-1} style={{width:22,height:22,background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:14,borderRadius:5,padding:0}}>−</button>
                        <input type="number" min="1" value={item.qty}
                          onChange={e=>{const v=parseInt(e.target.value);if(!isNaN(v)&&v>0)setQty(item.Barcode,v);}}
                          onFocus={e=>{e.target.select();setFocusedQtyBarcode(item.Barcode);}}
                          onBlur={()=>{setTimeout(()=>{const active=document.activeElement;const isAnotherQty=Object.values(qtyRefs.current).some(r=>r===active);if(!isAnotherQty)setFocusedQtyBarcode(null);},100);}}
                          onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape"){e.preventDefault();setFocusedQtyBarcode(null);setTimeout(()=>{if(searchRef.current){searchRef.current.focus();searchRef.current.select();}},30);}if(e.key==="ArrowUp"){e.preventDefault();setQty(item.Barcode,item.qty+1);}if(e.key==="ArrowDown"){e.preventDefault();if(item.qty>1)setQty(item.Barcode,item.qty-1);}}}
                          ref={el=>{qtyRefs.current[item.Barcode]=el;}}
                          className={isFQ?"qty-focus-input":""}
                          style={{width:50,padding:"4px 6px",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:5,color:T.textPrimary,fontSize:14,fontWeight:700,textAlign:"center",outline:"none"}} tabIndex={0}/>
                        <button className="btn" onClick={()=>setQty(item.Barcode,item.qty+1)} tabIndex={-1} style={{width:22,height:22,background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:14,borderRadius:5,padding:0}}>+</button>
                      </div>
                      <div style={{color:T.textSecondary,textAlign:"right",fontSize:12}}>{fmt(item.Price)}</div>
                      <div style={{color:disc>0?T.posGold:T.textMuted,textAlign:"right",fontSize:12}}>{disc>0?fmt(disc*item.qty):"—"}</div>
                      <div style={{color:T.success,textAlign:"right",fontSize:13,fontWeight:700}}>PKR {fmt(lt)}</div>
                      <button className="btn" onClick={()=>delItem(item.Barcode)} tabIndex={-1} style={{width:24,height:24,background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:12,borderRadius:4,padding:0}}>✕</button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 15px",boxShadow:T.shadow}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,color:T.textSecondary,fontSize:12}}><span>Sub Total</span><span>PKR {fmt(subTotal)}</span></div>
            {itemDiscount>0&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:4,color:T.posGold,fontSize:12}}><span>Item Discounts</span><span>− PKR {fmt(itemDiscount)}</span></div>}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{color:T.posGold,fontSize:12,whiteSpace:"nowrap"}}>Bill Discount %</span>
              <input type="number" min="0" max="100" value={billDiscPct||""} onChange={e=>setBDP(e.target.value)} placeholder="0" tabIndex={2}
                style={{...inSt,width:70,padding:"4px 8px",fontSize:13,textAlign:"center",background:T.bgCardAlt,border:`1px solid ${T.border}`}}/>
              {billDiscount>0&&<span style={{color:T.posGold,fontSize:12,marginLeft:"auto"}}>− PKR {fmt(billDiscount)}</span>}
            </div>
            {refundApplied>0&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:4,color:T.posOrange,fontSize:12,fontWeight:600}}><span>↩ Refund Applied</span><span>− PKR {fmt(refundApplied)}</span></div>}
            <div style={{display:"flex",justifyContent:"space-between",borderTop:`1px solid ${T.border}`,paddingTop:8,marginTop:4}}>
              <span style={{color:T.textPrimary,fontSize:16,fontWeight:700}}>GRAND TOTAL</span>
              <span style={{color:T.accent,fontSize:20,fontWeight:800,fontFamily:"Orbitron"}}>PKR {fmt(netTotal)}</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Customer + Actions */}
        <div style={{width:320,background:T.bgCardAlt,borderLeft:`1px solid ${T.border}`,padding:12,display:"flex",flexDirection:"column",gap:10,overflowY:"auto"}}>
          <CashierCustomerLedger customers={customers} sales={sales} currentBillTotal={netTotal}
            onSelectCustomer={(name,cell)=>{setCustName(name);setCustCell(cell);}}
            selectedName={ab.customerName} selectedCell={ab.customerCell}
            onClear={()=>{setCustName("");setCustCell("");}}/>

          {/* Apply Refund */}
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:11,padding:"11px 13px",boxShadow:T.shadow}}>
            <div style={{color:T.posOrange,fontSize:10,letterSpacing:2,fontWeight:700,marginBottom:8,textTransform:"uppercase"}}>↩ Apply Refund to This Bill</div>
            <RefundApplyPanel returns={returns} onApply={applyRefund} appliedPayments={payments}/>
          </div>

          {/* Cash received (walk-in only) */}
          {(!ab.customerName||ab.customerName.trim()===""||ab.customerName==="Unknown")&&cart.length>0&&(
            <div>
              <label style={{display:"block",color:T.accent,fontSize:10,letterSpacing:1.5,marginBottom:5,fontWeight:700}}>CASH RECEIVED</label>
              <input type="number" value={ab.cashReceived||""} onChange={e=>upd(b=>({...b,cashReceived:e.target.value}))}
                placeholder={`Min: PKR ${fmt(netTotal)}`}
                style={{...inSt,fontSize:15,textAlign:"center",background:T.bgCard,border:`1px solid ${T.successBorder}`}}/>
              {parseFloat(ab.cashReceived)>0&&(
                <div style={{display:"flex",justifyContent:"space-between",marginTop:6,padding:"7px 10px",background:parseFloat(ab.cashReceived)>=netTotal?T.successLight:T.dangerLight,border:`1px solid ${parseFloat(ab.cashReceived)>=netTotal?T.successBorder:T.dangerBorder}`,borderRadius:8}}>
                  <span style={{color:T.textSecondary,fontSize:12}}>Change</span>
                  <span style={{color:parseFloat(ab.cashReceived)>=netTotal?T.success:T.danger,fontWeight:800,fontSize:14}}>PKR {fmt(Math.max(0,parseFloat(ab.cashReceived||0)-netTotal))}</span>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{display:"flex",gap:7}}>
            <button className="btn" onClick={voidCart} tabIndex={-1} style={{flex:1,padding:12,background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:12,borderRadius:8,fontWeight:600}}>🗑 VOID</button>
            <button className="btn" onClick={saveBill}
              disabled={cart.length===0||((!ab.customerName||ab.customerName.trim()===""||ab.customerName==="Unknown")&&parseFloat(ab.cashReceived||0)<netTotal)}
              tabIndex={7}
              style={{flex:2,padding:12,background:cart.length>0?"linear-gradient(135deg,#047857,#059669)":"#e2e8f0",border:"none",color:cart.length>0?"#fff":T.textMuted,fontSize:12,fontWeight:700,borderRadius:8,boxShadow:cart.length>0?"0 3px 10px rgba(5,150,105,0.3)":"none",letterSpacing:0.5}}>
              {ab.saved?"✓ SAVED!":"🖨 SAVE & PRINT"}
            </button>
          </div>
          {ab.lastBill&&<button className="btn" onClick={()=>printReceipt(ab.lastBill)} tabIndex={-1} style={{padding:10,background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,fontSize:12,borderRadius:8,fontWeight:600}}>🖨 Reprint Last Receipt</button>}
        </div>
      </div>

      {showCalc&&<Calculator onClose={()=>setShowCalc(false)}/>}
      {showReturn&&<ReturnModal user={user} sales={sales} items={items} returnCounter={returnCounter} onReturnSaved={ret=>{onReturnSaved(ret);setShowReturn(false);}} onClose={()=>setShowReturn(false)}/>}
    </div>
  );
}
