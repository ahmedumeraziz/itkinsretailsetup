import { useState } from "react";
import { inSt, lbSt, slSt } from "../config";
import { fmt, safeParseItems, getNow } from "../utils/helpers";
import { printReturnReceipt } from "../utils/print";

// ─── REFUND APPLY PANEL ───────────────────────────────────────────────────────
export function RefundApplyPanel({ returns, onApply, appliedPayments }) {
  const [returnNo, setReturnNo] = useState("");
  const [found,    setFound]    = useState(null);
  const [msg,      setMsg]      = useState("");

  const alreadyApplied = found && (
    found.usedInBill === true ||
    found.UsedInBill === "1" ||
    found.UsedInBill === "true" ||
    appliedPayments.some(p => p.type === "refund" && p.origReturnNo === found.ReturnNo)
  );

  const lookup = () => {
    const q = returnNo.trim().toUpperCase();
    const match = returns.find(r =>
      r.ReturnNo?.toUpperCase() === q ||
      r.ReturnNo?.toUpperCase() === "R" + q.replace(/\D/g, "").padStart(4, "0") ||
      r.ReturnNo?.replace(/\D/g, "") === q.replace(/\D/g, "")
    );
    if (match) { setFound(match); setMsg(""); }
    else        { setFound(null); setMsg("Return not found"); }
  };

  const apply = () => {
    if (!found || alreadyApplied) return;
    onApply(parseFloat(found.RefundAmount), found.ReturnNo);
    setReturnNo(""); setFound(null);
    setMsg("✅ Refund applied");
    setTimeout(() => setMsg(""), 3000);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
        <input value={returnNo} onChange={e => { setReturnNo(e.target.value); setFound(null); setMsg(""); }} onKeyDown={e => e.key === "Enter" && lookup()} placeholder="Return # (e.g. R0002)" style={{ ...inSt, flex: 1, padding: "6px 10px", fontSize: 12, border: "1px solid rgba(255,150,0,0.3)" }} />
        <button className="btn" onClick={lookup} style={{ padding: "6px 11px", background: "rgba(255,150,0,0.15)", border: "1px solid rgba(255,150,0,0.3)", color: "#ff9500", fontSize: 12, borderRadius: 6 }}>Find</button>
      </div>
      {msg && <div style={{ fontSize: 11, color: msg.startsWith("✅") ? "#00e5a0" : "#ff6b6b", marginBottom: 6 }}>{msg}</div>}
      {found && !alreadyApplied && (
        <div style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.2)", borderRadius: 7, padding: "8px 10px" }}>
          <div style={{ color: "#fff", fontSize: 11, marginBottom: 8 }}>
            {found.ReturnNo} — {found.Date} — Orig Bill #{found.OrigBillNo}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>Refund Amount</span>
            <span style={{ color: "#ff9500", fontWeight: 700, fontSize: 15 }}>PKR {fmt(found.RefundAmount)}</span>
          </div>
          <button className="btn" onClick={apply} style={{ width: "100%", padding: "7px", background: "linear-gradient(135deg,#ff6b00,#ff9500)", color: "#fff", fontSize: 12, borderRadius: 6, fontWeight: 700 }}>↩ Apply Refund to Bill</button>
        </div>
      )}
      {alreadyApplied && (
        <div style={{ fontSize: 11, color: "#ff6b6b", padding: "7px 10px", background: "rgba(255,80,80,0.07)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 6 }}>
          ⛔ Return {found?.ReturnNo} has already been used in a bill.
        </div>
      )}
    </div>
  );
}

// ─── RETURN MODAL ─────────────────────────────────────────────────────────────
export default function ReturnModal({ user, sales, items, returnCounter, onReturnSaved, onClose }) {
  const [step,         setStep]         = useState(1);
  const [billNo,       setBillNo]       = useState("");
  const [foundSale,    setFoundSale]    = useState(null);
  const [saleItems,    setSaleItems]    = useState([]);
  const [returnQtys,   setReturnQtys]   = useState({});
  const [reason,       setReason]       = useState("Customer Return");
  const [msg,          setMsg]          = useState("");

  const findBill = () => {
    const s = sales.find(s => s.BillNo === billNo.trim().padStart(4, "0") || s.BillNo === billNo.trim());
    if (!s) { setMsg("Bill not found"); return; }
    const si = safeParseItems(s.ItemsDetail);
    setFoundSale(s); setSaleItems(si);
    const qtys = {}; si.forEach(i => { qtys[i.Barcode] = 0; });
    setReturnQtys(qtys); setStep(2); setMsg("");
  };

  const setRQ = (bc, v) => setReturnQtys(p => ({ ...p, [bc]: Math.max(0, Math.min(parseInt(v) || 0, saleItems.find(i => i.Barcode === bc)?.qty || 0)) }));

  const refundAmt = saleItems.reduce((s, i) => {
    const qty = returnQtys[i.Barcode] || 0;
    const disc = parseFloat(i.Discount || 0);
    return s + qty * (parseFloat(i.Price || 0) - disc);
  }, 0);

  const returnedItems = saleItems.filter(i => (returnQtys[i.Barcode] || 0) > 0).map(i => ({ ...i, qty: returnQtys[i.Barcode] }));

  const confirmReturn = () => {
    if (returnedItems.length === 0) { setMsg("Select at least one item to return"); return; }
    const { date, time } = getNow();
    const ReturnNo = "R" + String(returnCounter).padStart(4, "0");
    const ret = { ReturnNo, OrigBillNo: foundSale.BillNo, Date: date, Time: time, Cashier: user.Name, Items: JSON.stringify(returnedItems), RefundAmount: refundAmt, Reason: reason };
    onReturnSaved(ret);
    printReturnReceipt(ret);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d1b2a", border: "1px solid rgba(255,150,0,0.35)", borderRadius: 14, padding: 24, maxWidth: 560, width: "100%", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: "Orbitron", color: "#ff9500", fontSize: 15 }}>↩ RETURN / REFUND</div>
          <button className="btn" onClick={onClose} style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 13, borderRadius: 6 }}>✕</button>
        </div>

        {step === 1 && (
          <div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginBottom: 12 }}>Enter the original bill number to process a return.</div>
            <div style={{ display: "flex", gap: 9 }}>
              <input value={billNo} onChange={e => setBillNo(e.target.value)} onKeyDown={e => e.key === "Enter" && findBill()} placeholder="Bill Number (e.g. 0115)" style={{ ...inSt, flex: 1 }} autoFocus />
              <button className="btn" onClick={findBill} style={{ padding: "9px 18px", background: "linear-gradient(135deg,#ff6b00,#ff9500)", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>Find Bill</button>
            </div>
            {msg && <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 8 }}>{msg}</div>}
          </div>
        )}

        {step === 2 && foundSale && (
          <div>
            <div style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.2)", borderRadius: 9, padding: "10px 14px", marginBottom: 16 }}>
              <div style={{ color: "#ff9500", fontSize: 12, fontWeight: 700 }}>Bill #{foundSale.BillNo} — {foundSale.Date} — {foundSale.Cashier}</div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>Customer: {foundSale.CustomerName || "Unknown"} · Total: PKR {fmt(foundSale.GrandTotal)}</div>
            </div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginBottom: 10 }}>Select items and quantities to return:</div>
            {saleItems.map(item => (
              <div key={item.Barcode} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: "rgba(255,255,255,0.025)", border: `1px solid ${(returnQtys[item.Barcode] || 0) > 0 ? "rgba(255,150,0,0.3)" : "rgba(255,255,255,0.06)"}`, borderRadius: 8, marginBottom: 7 }}>
                <div>
                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{item.ItemName}</div>
                  <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>Sold: {item.qty} · PKR {fmt(item.Price)} each</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>Return:</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button className="btn" onClick={() => setRQ(item.Barcode, (returnQtys[item.Barcode] || 0) - 1)} style={{ width: 24, height: 24, background: "rgba(255,80,80,0.13)", border: "1px solid rgba(255,80,80,0.26)", color: "#ff8888", fontSize: 15, borderRadius: 4, padding: 0 }}>−</button>
                    <span style={{ color: (returnQtys[item.Barcode] || 0) > 0 ? "#ff9500" : "#fff", fontWeight: 700, fontSize: 14, minWidth: 24, textAlign: "center" }}>{returnQtys[item.Barcode] || 0}</span>
                    <button className="btn" onClick={() => setRQ(item.Barcode, (returnQtys[item.Barcode] || 0) + 1)} style={{ width: 24, height: 24, background: "rgba(0,180,255,0.13)", border: "1px solid rgba(0,180,255,0.26)", color: "#00b4ff", fontSize: 15, borderRadius: 4, padding: 0 }}>+</button>
                  </div>
                  <span style={{ color: "#ff9500", fontSize: 11, minWidth: 70, textAlign: "right" }}>PKR {fmt((returnQtys[item.Barcode] || 0) * (parseFloat(item.Price) - parseFloat(item.Discount || 0)))}</span>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              <label style={{ ...lbSt, marginBottom: 5 }}>REASON FOR RETURN</label>
              <select value={reason} onChange={e => setReason(e.target.value)} style={{ ...slSt, width: "100%" }}>
                <option>Customer Return</option><option>Damaged Item</option><option>Wrong Item</option><option>Expired Product</option><option>Other</option>
              </select>
            </div>
            {msg && <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 8 }}>{msg}</div>}
            <div style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.25)", borderRadius: 9, padding: "10px 14px", marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#ff9500", fontWeight: 700, fontSize: 14 }}>REFUND AMOUNT</span>
              <span style={{ color: "#ff9500", fontWeight: 800, fontSize: 20, fontFamily: "Orbitron" }}>PKR {fmt(refundAmt)}</span>
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
              <button className="btn" onClick={() => setStep(1)} style={{ flex: 1, padding: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>← Back</button>
              <button className="btn" onClick={confirmReturn} disabled={returnedItems.length === 0} style={{ flex: 2, padding: 11, background: returnedItems.length > 0 ? "linear-gradient(135deg,#ff6b00,#ff9500)" : "rgba(255,255,255,0.04)", border: "none", color: returnedItems.length > 0 ? "#fff" : "rgba(255,255,255,0.2)", fontSize: 13, fontWeight: 700, borderRadius: 7 }}>✓ Process Return & Print</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
