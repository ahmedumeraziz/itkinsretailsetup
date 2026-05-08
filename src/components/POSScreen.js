import { useState, useEffect, useRef, useCallback } from "react";
import { inSt, bdgSt } from "../config";
import { fmt, getNow, safeParseItems } from "../utils/helpers";
import { printReceipt } from "../utils/print";
import StatusBar from "./StatusBar";
import Calculator from "./Calculator";
import ReturnModal, { RefundApplyPanel } from "./ReturnModal";
import CashierCustomerLedger from "./CashierCustomerLedger";

function emptyBill(id) {
  return { id, cart: [], payments: [{ type: "cash", amount: "", last4: "" }], saved: false, lastBill: null, billDiscPct: 0, customerName: "", customerCell: "", cashReceived: "" };
}

export default function POSScreen({ user, items, categories, billCounter, onLogout, onSaleSaved, sheetStatus, isOnline, lastSync, onRefresh, searchIndex, itemMap, sales, returns, returnCounter, onReturnSaved, onMarkReturnUsed, customers, setCustomers }) {
  const [bills,        setBills]        = useState([emptyBill(1)]);
  const [activeBillId, setActiveBillId] = useState(1);
  const [nextBillId,   setNextBillId]   = useState(2);
  const [search,       setSearch]       = useState("");
  const [results,      setResults]      = useState([]);
  const [kbIndex,      setKbIndex]      = useState(-1);
  const [tick,         setTick]         = useState(getNow());
  const [localCounter, setLocalCounter] = useState(billCounter);
  const [showCalc,     setShowCalc]     = useState(false);
  const [isFS,         setIsFS]         = useState(false);
  const [showReturn,   setShowReturn]   = useState(false);
  const [focusedQtyBarcode, setFocusedQtyBarcode] = useState(null);

  const searchRef  = useRef();
  const resultsRef = useRef([]); resultsRef.current = results;
  const qtyRefs    = useRef({});
  const scanBuffer = useRef(""); const scanTimer = useRef(null);

  useEffect(() => { setLocalCounter(billCounter); }, [billCounter]);
  useEffect(() => { const t = setInterval(() => setTick(getNow()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { setKbIndex(-1); }, [results]);

  useEffect(() => {
    if (focusedQtyBarcode) {
      const ref = qtyRefs.current[focusedQtyBarcode];
      if (ref) { ref.focus(); ref.select(); }
    }
  }, [focusedQtyBarcode]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 1) { setResults([]); return; }
    const timer = setTimeout(() => {
      if (searchIndex.size > 0) {
        setResults(searchIndex_run(searchIndex, itemMap, q));
      } else {
        setResults(items.filter(i => i.Barcode?.toLowerCase().includes(q.toLowerCase()) || i.ItemName?.toLowerCase().includes(q.toLowerCase())).slice(0, 12));
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [search, searchIndex, itemMap, items]);

  function searchIndex_run(index, iMap, query) {
    const q = query.toLowerCase().trim();
    if (iMap.has(query)) return [iMap.get(query)];
    const tokens = q.split(/\s+/);
    let resultSet = null;
    tokens.forEach(token => {
      const matches = index.get(token) || new Set();
      if (resultSet === null) resultSet = new Set(matches);
      else { for (const b of resultSet) { if (!matches.has(b)) resultSet.delete(b); } }
    });
    if (!resultSet) return [];
    return Array.from(resultSet).map(bc => iMap.get(bc)).filter(Boolean).slice(0, 12);
  }

  const toggleFS = () => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => {}); setIsFS(true); } else { document.exitFullscreen(); setIsFS(false); } };
  const ab  = bills.find(b => b.id === activeBillId) || bills[0];
  const upd = fn => setBills(prev => prev.map(b => b.id === activeBillId ? fn(b) : b));
  const addNewBill = () => { const id = nextBillId; setBills(p => [...p, emptyBill(id)]); setActiveBillId(id); setNextBillId(id + 1); setSearch(""); setResults([]); setTimeout(() => searchRef.current?.focus(), 60); };
  const closeBill  = (id, e) => { e.stopPropagation(); if (bills.length === 1) { setBills([emptyBill(id)]); return; } const rem = bills.filter(b => b.id !== id); setBills(rem); if (activeBillId === id) setActiveBillId(rem[rem.length - 1].id); };

  const focusSearch = useCallback(() => {
    setFocusedQtyBarcode(null);
    setTimeout(() => {
      if (searchRef.current) { searchRef.current.focus(); searchRef.current.select(); }
    }, 60);
  }, []);

  const addItem = useCallback(item => {
    upd(b => {
      const ex = b.cart.find(i => i.Barcode === item.Barcode);
      return { ...b, cart: ex ? b.cart.map(i => i.Barcode === item.Barcode ? { ...i, qty: i.qty + 1 } : i) : [...b.cart, { ...item, qty: 1 }] };
    });
    setSearch(""); setResults([]); setKbIndex(-1);
    setFocusedQtyBarcode(null);
    setTimeout(() => setFocusedQtyBarcode(item.Barcode), 50);
  }, []);

  const lastKeyTime = useRef(0);
  const handleSearchChange = useCallback(e => {
    const now = Date.now();
    const elapsed = now - lastKeyTime.current;
    lastKeyTime.current = now;
    const val = e.target.value;
    setSearch(val);
    if (elapsed < 50 && val.length > scanBuffer.current.length) {
      scanBuffer.current = val;
    } else if (elapsed >= 50) {
      scanBuffer.current = "";
    }
  }, []);

  const handleSearchKeyDown = useCallback(e => {
    const res = resultsRef.current;
    if (e.key === "ArrowDown")  { e.preventDefault(); setKbIndex(i => Math.min(i + 1, res.length - 1)); return; }
    if (e.key === "ArrowUp")    { e.preventDefault(); setKbIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Escape")     { setSearch(""); setResults([]); setKbIndex(-1); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const bufVal = scanBuffer.current.trim();
      if (bufVal) {
        const exact = itemMap.get(bufVal) || items.find(i => i.Barcode === bufVal);
        if (exact) { addItem(exact); scanBuffer.current = ""; return; }
      }
      if (res.length > 0) { const idx = kbIndex >= 0 ? kbIndex : 0; if (res[idx]) addItem(res[idx]); }
      scanBuffer.current = "";
    }
  }, [kbIndex, addItem, itemMap, items]);

  const dropdownRef = useRef();
  useEffect(() => {
    if (!dropdownRef.current || kbIndex < 0) return;
    const el = dropdownRef.current.querySelectorAll(".search-item-row")[kbIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [kbIndex]);

  const setQty    = (bc, q) => upd(b => ({ ...b, cart: q <= 0 ? b.cart.filter(i => i.Barcode !== bc) : b.cart.map(i => i.Barcode === bc ? { ...i, qty: q } : i) }));
  const delItem   = bc => { upd(b => ({ ...b, cart: b.cart.filter(i => i.Barcode !== bc) })); if (focusedQtyBarcode === bc) { setFocusedQtyBarcode(null); focusSearch(); } };
  const voidCart  = () => { upd(b => ({ ...b, cart: [], payments: [{ type: "cash", amount: "", last4: "" }], saved: false, billDiscPct: 0, customerName: "", customerCell: "" })); setFocusedQtyBarcode(null); };
  const setBDP    = v => upd(b => ({ ...b, billDiscPct: parseFloat(v) || 0 }));
  const setCustName = v => upd(b => ({ ...b, customerName: v }));
  const setCustCell = v => upd(b => ({ ...b, customerCell: v }));

  const applyRefund = (refundAmt, returnNo) => {
    upd(b => ({
      ...b,
      payments: [...b.payments.filter(p => p.type !== "refund"), { type: "refund", amount: String(refundAmt), origReturnNo: returnNo }]
    }));
    onMarkReturnUsed(returnNo);
  };

  const cart          = ab.cart;
  const payments      = ab.payments;
  const billDiscPct   = ab.billDiscPct || 0;
  const subTotal      = cart.reduce((s, i) => s + parseFloat(i.Price || 0) * i.qty, 0);
  const itemDiscount  = cart.reduce((s, i) => s + parseFloat(i.Discount || 0) * i.qty, 0);
  const afterItems    = subTotal - itemDiscount;
  const billDiscount  = parseFloat(((afterItems * billDiscPct) / 100).toFixed(2));
  const refundApplied = payments.filter(p => p.type === "refund").reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const grandTotal    = afterItems - billDiscount;
  const netTotal      = Math.max(0, grandTotal - refundApplied);
  const totalReceived = payments.filter(p => p.type !== "refund").reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const change        = totalReceived - netTotal;

  const saveBill = () => {
    if (cart.length === 0) return;
    const { date, time } = getNow();
    const billNo = "B" + String(localCounter).padStart(4, "0");
    const totalDiscount = itemDiscount + billDiscount;
    const customerInfo  = { Name: ab.customerName?.trim() || "Unknown", CellNo: ab.customerCell?.trim() || "" };
    const isKnownCustomer = customerInfo.Name && customerInfo.Name !== "Unknown" && customerInfo.Name.trim() !== "" && customerInfo.CellNo && customerInfo.CellNo.trim() !== "";
    const payMethod = isKnownCustomer ? "Credit" : "Cash";
    // Compute previous pending for credit customer receipt (includes openingDebit)
    const existingCustomer = isKnownCustomer ? customers.find(c => c.CellNo === customerInfo.CellNo) : null;
    const prevPending = existingCustomer ? (() => {
      const normB = (b) => { const n = String(b || "").trim().replace(/[^0-9]/g, ""); return n.replace(/^0+/, "") || "0"; };
      const billNos = (existingCustomer.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
      const totalCredit = billNos.reduce((s, bn) => {
        const norm = normB(bn);
        const sale = sales.find(sale => normB(sale.BillNo) === norm);
        if (!sale || sale.PaymentMethod !== "Credit") return s;
        return s + parseFloat(sale.GrandTotal || 0);
      }, 0);
      const openingDebit = parseFloat(existingCustomer.openingDebit || 0);
      const totalPaid    = (existingCustomer.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      return Math.max(0, totalCredit + openingDebit - totalPaid);
    })() : 0;
    const bill = { billNo, date, time, cashier: user.Name, items: cart, subTotal, totalDiscount, itemDiscount, billDiscount, billDiscountPct: billDiscPct, grandTotal: netTotal, payments, change: Math.max(0, parseFloat(ab.cashReceived || 0) - netTotal), customerName: customerInfo.Name, customerCell: customerInfo.CellNo, refundApplied, prevPending };

    onSaleSaved({
      BillNo: billNo, Date: date, Time: time, Cashier: user.Name,
      GrandTotal: netTotal, Discount: totalDiscount, FBR: 0,
      PaymentMethod: payMethod,
      ItemsDetail: JSON.stringify(cart),
      items: cart,
      CustomerName: isKnownCustomer ? customerInfo.Name : "Unknown",
      CustomerCell: isKnownCustomer ? customerInfo.CellNo : ""
    }, isKnownCustomer ? customerInfo : { Name: "Unknown", CellNo: "" });

    setLocalCounter(c => c + 1);
    upd(b => ({ ...b, saved: true, lastBill: bill }));
    printReceipt(bill);
    setFocusedQtyBarcode(null);
    setTimeout(() => { upd(b => ({ ...b, cart: [], payments: [{ type: "cash", amount: "", last4: "" }], saved: false, billDiscPct: 0, customerName: "", customerCell: "" })); focusSearch(); }, 2500);
  };

  const grouped = {}; cart.forEach(item => { const c = item.Category || "General"; if (!grouped[c]) grouped[c] = []; grouped[c].push(item); });
  const catKeys = Object.keys(grouped).sort();

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0a0e1a", overflow: "hidden" }}>
      {/* TOP BAR */}
      <div style={{ background: "linear-gradient(90deg,#0c1828,#091422)", borderBottom: "1px solid rgba(0,180,255,0.18)", padding: "7px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ fontFamily: "Orbitron", color: "#00b4ff", fontSize: 13, fontWeight: 900 }}>itKINS: MART POS</div>
          <div style={bdgSt("#00b4ff")}>CASHIER: {user?.Name?.toUpperCase()}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{tick.date} {tick.time}</div>
          <div style={bdgSt("#fff")}>BILL# B{String(localCounter).padStart(4, "0")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          <StatusBar isOnline={isOnline} sheetStatus={sheetStatus} lastSync={lastSync} onRefresh={onRefresh} />
          <button className="btn" onClick={() => setShowReturn(true)} title="Process Return/Refund" style={{ padding: "5px 10px", background: "rgba(255,150,0,0.12)", border: "1px solid rgba(255,150,0,0.3)", color: "#ff9500", fontSize: 12, borderRadius: 6 }}>↩ Return</button>
          <button className="btn" onClick={() => setShowCalc(v => !v)} title="Calculator" style={{ padding: "5px 10px", background: showCalc ? "rgba(0,180,255,0.25)" : "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.3)", color: "#00b4ff", fontSize: 14, borderRadius: 6 }}>🧮</button>
          <button className="btn" onClick={toggleFS} style={{ padding: "5px 10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 13, borderRadius: 6 }}>{isFS ? "⤡" : "⤢"}</button>
          <button className="btn" onClick={onLogout} style={{ padding: "5px 12px", background: "rgba(255,80,80,0.12)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff6b6b", fontSize: 11, borderRadius: 6 }}>LOGOUT</button>
        </div>
      </div>

      {/* BILL TABS */}
      <div style={{ display: "flex", alignItems: "center", background: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "4px 12px 0", flexShrink: 0, gap: 4, overflowX: "auto" }}>
        {bills.map(b => {
          const isA = b.id === activeBillId;
          const bT  = b.cart.reduce((s, i) => s + parseFloat(i.Price || 0) * i.qty - parseFloat(i.Discount || 0) * i.qty, 0) + 1;
          return (
            <div key={b.id} onClick={() => { setActiveBillId(b.id); setTimeout(() => searchRef.current?.focus(), 40); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px 7px", cursor: "pointer", borderRadius: "8px 8px 0 0", flexShrink: 0, background: isA ? "rgba(0,180,255,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${isA ? "rgba(0,180,255,0.3)" : "rgba(255,255,255,0.07)"}`, borderBottom: isA ? "1px solid #0a0e1a" : "1px solid rgba(255,255,255,0.07)", marginBottom: isA ? -1 : 0 }}>
              <span style={{ color: isA ? "#00b4ff" : "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: isA ? 700 : 400 }}>
                Bill {b.id}
                {b.customerName && b.customerName.trim() !== "" && b.customerName !== "Unknown" && <span style={{ color: "#00e5a0", fontSize: 10, marginLeft: 4 }}>· {b.customerName}</span>}
                {b.cart.length > 0 && <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, marginLeft: 4 }}>({b.cart.length} · PKR {fmt(bT)})</span>}
              </span>
              <span onClick={e => closeBill(b.id, e)} style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, padding: "0 2px", cursor: "pointer" }} onMouseEnter={e => e.target.style.color = "#ff6b6b"} onMouseLeave={e => e.target.style.color = "rgba(255,255,255,0.3)"}>✕</span>
            </div>
          );
        })}
        <button className="btn" onClick={addNewBill} style={{ padding: "5px 12px", background: "rgba(0,180,255,0.07)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 12, borderRadius: "6px 6px 0 0", flexShrink: 0, marginBottom: -1 }}>+ New Bill</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* LEFT: Cart */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 12, overflow: "hidden", gap: 8 }}>
          {/* Search */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#00b4ff", fontSize: 18, pointerEvents: "none" }}>⌕</span>
            <input
              ref={searchRef}
              value={search}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              autoFocus
              placeholder="Scan barcode or type item name..."
              style={{ ...inSt, paddingLeft: 36, fontSize: 14 }}
              tabIndex={1}
            />
            {results.length > 0 && (
              <div ref={dropdownRef} style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#0c1828", border: "1px solid rgba(0,180,255,0.28)", borderRadius: 8, zIndex: 200, boxShadow: "0 8px 40px rgba(0,0,0,0.65)", maxHeight: 320, overflowY: "auto" }}>
                <div style={{ padding: "4px 13px", background: "rgba(0,180,255,0.04)", borderBottom: "1px solid rgba(0,180,255,0.1)", color: "rgba(0,180,255,0.5)", fontSize: 9, letterSpacing: 1 }}>↑↓ NAVIGATE &nbsp;·&nbsp; ENTER SELECT → QTY &nbsp;·&nbsp; ESC CLOSE &nbsp;·&nbsp; SCANNER SUPPORTED</div>
                {results.map((item, i) => {
                  const stk = Number(item.Stock) || 0; const isKb = i === kbIndex;
                  return (
                    <div key={i} className={`search-item-row${isKb ? " kb-selected" : ""}`} onClick={() => addItem(item)}
                      style={{ padding: "9px 13px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center", background: isKb ? "rgba(0,180,255,0.16)" : "transparent", borderLeft: isKb ? "3px solid #00b4ff" : "3px solid transparent" }}>
                      <div>
                        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{item.ItemName}</div>
                        <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 10 }}>{item.Barcode} · {item.Category}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>PKR {fmt(item.Price)}</div>
                        {parseFloat(item.Discount) > 0 && <div style={{ color: "#ffd700", fontSize: 10 }}>Disc: PKR {fmt(item.Discount)}</div>}
                        <div style={{ fontSize: 10, color: stk <= 0 ? "#ff6b6b" : stk <= 5 ? "#ffd700" : "rgba(255,255,255,0.28)" }}>Stock:{item.Stock}{stk <= 0 ? " ❌" : stk <= 5 ? " ⚠" : ""}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cart table */}
          <div style={{ flex: 1, overflowY: "auto", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 120px 90px 80px 88px 30px", padding: "8px 12px", background: "rgba(0,180,255,0.07)", borderBottom: "1px solid rgba(0,180,255,0.12)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700, position: "sticky", top: 0 }}>
              <div>ITEM</div><div style={{ textAlign: "center" }}>QTY</div><div style={{ textAlign: "right" }}>PRICE</div><div style={{ textAlign: "right" }}>DISC</div><div style={{ textAlign: "right" }}>TOTAL</div><div />
            </div>
            {cart.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 160, color: "rgba(255,255,255,0.14)", gap: 8 }}>
                <div style={{ fontSize: 34 }}>🛒</div><div style={{ fontSize: 12 }}>Scan or search items to add</div>
              </div>
            ) : catKeys.map(cat => (
              <div key={cat}>
                <div style={{ padding: "5px 12px", background: "rgba(0,180,255,0.04)", color: "#00b4ff", fontSize: 10, letterSpacing: 3, fontWeight: 700, borderBottom: "1px solid rgba(0,180,255,0.08)" }}>── {cat.toUpperCase()} ──</div>
                {grouped[cat].map(item => {
                  const disc = parseFloat(item.Discount || 0);
                  const lt = item.qty * parseFloat(item.Price || 0) - disc * item.qty;
                  const isFocusedQty = focusedQtyBarcode === item.Barcode;
                  return (
                    <div key={item.Barcode} style={{ display: "grid", gridTemplateColumns: "2fr 120px 90px 80px 88px 30px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", background: isFocusedQty ? "rgba(0,180,255,0.04)" : "transparent", transition: "background 0.2s" }}>
                      <div>
                        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{item.ItemName}</div>
                        <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10 }}>{item.Barcode}{item.Stock <= 5 && <span style={{ color: "#ffd700", marginLeft: 6 }}>⚠ Low Stock</span>}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                        <button className="btn" onClick={() => setQty(item.Barcode, item.qty - 1)} tabIndex={-1} style={{ width: 22, height: 22, background: "rgba(255,80,80,0.13)", border: "1px solid rgba(255,80,80,0.26)", color: "#ff8888", fontSize: 15, borderRadius: 4, padding: 0 }}>−</button>
                        <input
                          ref={el => { qtyRefs.current[item.Barcode] = el; }}
                          type="number" min="1" value={item.qty}
                          onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) setQty(item.Barcode, v); else if (e.target.value === "") setQty(item.Barcode, 1); }}
                          onFocus={e => { e.target.select(); setFocusedQtyBarcode(item.Barcode); }}
                          onBlur={() => { setTimeout(() => { const active = document.activeElement; const isAnotherQty = Object.values(qtyRefs.current).some(r => r === active); if (!isAnotherQty) setFocusedQtyBarcode(null); }, 100); }}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setFocusedQtyBarcode(null); setTimeout(() => { if (searchRef.current) { searchRef.current.focus(); searchRef.current.select(); } }, 30); }
                            if (e.key === "ArrowUp") { e.preventDefault(); setQty(item.Barcode, item.qty + 1); }
                            if (e.key === "ArrowDown") { e.preventDefault(); if (item.qty > 1) setQty(item.Barcode, item.qty - 1); }
                          }}
                          className={isFocusedQty ? "qty-focus-input" : ""}
                          style={{ width: 52, padding: "4px 6px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(0,180,255,0.25)", borderRadius: 5, color: "#fff", fontSize: 14, fontWeight: 700, textAlign: "center", outline: "none", transition: "all 0.15s", MozAppearance: "textfield" }}
                          tabIndex={0}
                        />
                        <button className="btn" onClick={() => setQty(item.Barcode, item.qty + 1)} tabIndex={-1} style={{ width: 22, height: 22, background: "rgba(0,180,255,0.13)", border: "1px solid rgba(0,180,255,0.26)", color: "#00b4ff", fontSize: 15, borderRadius: 4, padding: 0 }}>+</button>
                      </div>
                      <div style={{ color: "#e0e0e0", textAlign: "right", fontSize: 12 }}>{fmt(item.Price)}</div>
                      <div style={{ color: disc > 0 ? "#ffd700" : "rgba(255,255,255,0.22)", textAlign: "right", fontSize: 12 }}>{disc > 0 ? fmt(disc * item.qty) : "—"}</div>
                      <div style={{ color: "#00e5a0", textAlign: "right", fontSize: 13, fontWeight: 700 }}>{fmt(lt)}</div>
                      <button className="btn" onClick={() => delItem(item.Barcode)} tabIndex={-1} style={{ width: 26, height: 26, background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.17)", color: "#ff6b6b", fontSize: 12, borderRadius: 4, padding: 0 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "11px 15px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, color: "rgba(255,255,255,0.48)", fontSize: 12 }}><span>Sub Total</span><span>PKR {fmt(subTotal)}</span></div>
            {itemDiscount > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, color: "#ffd700", fontSize: 12 }}><span>Item Discounts</span><span>− PKR {fmt(itemDiscount)}</span></div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ color: "rgba(255,200,0,0.8)", fontSize: 12, whiteSpace: "nowrap" }}>Bill Discount %</span>
              <input type="number" min="0" max="100" value={billDiscPct || ""} onChange={e => setBDP(e.target.value)} placeholder="0" tabIndex={2} style={{ ...inSt, width: 70, padding: "4px 8px", fontSize: 13, textAlign: "center", border: "1px solid rgba(255,200,0,0.35)" }} />
              {billDiscount > 0 && <span style={{ color: "#ffd700", fontSize: 12, marginLeft: "auto" }}>− PKR {fmt(billDiscount)}</span>}
            </div>
            {refundApplied > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, color: "#ff9500", fontSize: 12 }}><span>↩ Refund Applied</span><span>− PKR {fmt(refundApplied)}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 7 }}>
              <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>GRAND TOTAL</span>
              <span style={{ color: "#00b4ff", fontSize: 20, fontWeight: 800, fontFamily: "Orbitron" }}>PKR {fmt(netTotal)}</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Customer + Actions */}
        <div style={{ width: 320, background: "rgba(255,255,255,0.012)", borderLeft: "1px solid rgba(255,255,255,0.06)", padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
          <CashierCustomerLedger
            customers={customers} sales={sales} currentBillTotal={netTotal}
            onSelectCustomer={(name, cell) => { setCustName(name); setCustCell(cell); }}
            selectedName={ab.customerName} selectedCell={ab.customerCell}
            onClear={() => { setCustName(""); setCustCell(""); }}
          />

          <div style={{ background: "rgba(255,150,0,0.05)", border: "1px solid rgba(255,150,0,0.2)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#ff9500", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 8 }}>↩ APPLY REFUND TO THIS BILL</div>
            <RefundApplyPanel returns={returns} onApply={applyRefund} appliedPayments={payments} />
          </div>

          {(!ab.customerName || ab.customerName.trim() === "" || ab.customerName === "Unknown") && cart.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <label style={{ display: "block", color: "rgba(0,180,255,0.68)", fontSize: 10, letterSpacing: 1.5, marginBottom: 5, fontWeight: 600 }}>CASH RECEIVED</label>
              <input type="number" value={ab.cashReceived || ""} onChange={e => upd(b => ({ ...b, cashReceived: e.target.value }))}
                placeholder={`Min: PKR ${fmt(netTotal)}`}
                style={{ ...inSt, fontSize: 15, textAlign: "center", border: "1px solid rgba(0,229,160,0.4)" }} />
              {parseFloat(ab.cashReceived) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, padding: "7px 10px",
                  background: parseFloat(ab.cashReceived) >= netTotal ? "rgba(0,229,160,0.08)" : "rgba(255,80,80,0.08)",
                  border: `1px solid ${parseFloat(ab.cashReceived) >= netTotal ? "rgba(0,229,160,0.3)" : "rgba(255,80,80,0.3)"}`, borderRadius: 7 }}>
                  <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>Change</span>
                  <span style={{ color: parseFloat(ab.cashReceived) >= netTotal ? "#00e5a0" : "#ff6b6b", fontWeight: 800, fontSize: 14 }}>
                    PKR {fmt(Math.max(0, parseFloat(ab.cashReceived || 0) - netTotal))}
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn" onClick={voidCart} tabIndex={-1} style={{ flex: 1, padding: 11, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.26)", color: "#ff6b6b", fontSize: 12, borderRadius: 8 }}>🗑 VOID</button>
            <button className="btn" onClick={saveBill}
              disabled={cart.length === 0 || ((!ab.customerName || ab.customerName.trim() === "" || ab.customerName === "Unknown") && parseFloat(ab.cashReceived || 0) < netTotal)}
              tabIndex={7}
              style={{ flex: 2, padding: 11, background: cart.length > 0 ? "linear-gradient(135deg,#00a651,#00e5a0)" : "rgba(255,255,255,0.04)", border: "none", color: cart.length > 0 ? "#000" : "rgba(255,255,255,0.16)", fontSize: 12, fontWeight: 700, borderRadius: 8, letterSpacing: 1 }}>
              {ab.saved ? "✓ SAVED!" : "🖨 SAVE & PRINT"}
            </button>
          </div>
          {ab.lastBill && <button className="btn" onClick={() => printReceipt(ab.lastBill)} tabIndex={-1} style={{ padding: 9, background: "rgba(0,180,255,0.08)", border: "1px solid rgba(0,180,255,0.26)", color: "#00b4ff", fontSize: 12, borderRadius: 8 }}>🖨 Reprint Last Receipt</button>}
        </div>
      </div>

      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      {showReturn && <ReturnModal user={user} sales={sales} items={items} returnCounter={returnCounter} onReturnSaved={ret => { onReturnSaved(ret); setShowReturn(false); }} onClose={() => setShowReturn(false)} />}
    </div>
  );
}
