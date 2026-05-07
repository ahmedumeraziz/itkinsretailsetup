import { useState } from "react";
import { inSt, slSt, lbSt } from "../config";
import { fmt, filterDateMatch, safeParseItems } from "../utils/helpers";
import { printReceipt, printReturnReceipt } from "../utils/print";

// ── SALES TAB ─────────────────────────────────────────────────────────────────
export function SalesTab({ sales, setSales, customers }) {
  const [filterDate,    setFilterDate]    = useState("");
  const [filterCashier, setFilterCashier] = useState("All");
  const [viewBill,      setViewBill]      = useState(null);

  const cashierList = [...new Set(sales.map(s => s.Cashier).filter(Boolean))];
  const filtered    = sales.filter(s =>
    filterDateMatch(s.Date, filterDate) &&
    (filterCashier === "All" || s.Cashier === filterCashier)
  );
  const totalRev  = filtered.reduce((s, r) => s + parseFloat(r.GrandTotal || 0), 0);
  const totalDisc = filtered.reduce((s, r) => s + parseFloat(r.Discount  || 0), 0);

  // Compute previous pending for a credit sale at the time of reprint
  function normBill(b) { return String(b || "").trim().replace(/^0+/, "") || "0"; }
  function getPrevPending(sale) {
    if (sale.PaymentMethod !== "Credit" || !sale.CustomerCell) return 0;
    const c = (customers || []).find(cx => cx.CellNo === sale.CustomerCell);
    if (!c) return 0;
    const billNos = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
    // Sum all Credit bills BEFORE this one (chronologically earlier BillNo)
    const thisNorm = normBill(sale.BillNo);
    const creditBefore = billNos.reduce((sum, bn) => {
      if (normBill(bn) === thisNorm) return sum; // skip this bill itself
      const s = sales.find(s => normBill(s.BillNo) === normBill(bn));
      if (!s || s.PaymentMethod !== "Credit") return sum;
      return sum + parseFloat(s.GrandTotal || 0);
    }, 0);
    const totalPaid = (c.payments || []).reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    return Math.max(0, creditBefore - totalPaid);
  }

  const reprintBill = sale => {
    const items       = safeParseItems(sale.ItemsDetail);
    const subTotal    = items.reduce((s, i) => s + parseFloat(i.Price || 0) * (parseInt(i.qty) || 1), 0);
    const itemDiscount = items.reduce((s, i) => s + parseFloat(i.Discount || 0) * (parseInt(i.qty) || 1), 0);
    const totalDiscount = parseFloat(sale.Discount || 0);
    const grandTotal    = parseFloat(sale.GrandTotal || 0);
    const isCredit      = sale.PaymentMethod === "Credit";
    const prevPending   = isCredit ? getPrevPending(sale) : 0;
    printReceipt({
      billNo: sale.BillNo, date: sale.Date, time: sale.Time, cashier: sale.Cashier,
      items, subTotal, totalDiscount, itemDiscount,
      billDiscount: Math.max(0, totalDiscount - itemDiscount), billDiscountPct: 0,
      grandTotal,
      payments: isCredit ? [] : [{ type: "cash", amount: grandTotal, last4: "" }],
      change: 0,
      customerName: sale.CustomerName || "",
      customerCell: sale.CustomerCell || "",
      refundApplied: 0,
      prevPending,
    });
  };

  return (
    <div>
      {/* Bill detail popup */}
      {viewBill && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.87)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setViewBill(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#0d1b2a", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, maxWidth: 560, width: "100%", maxHeight: "86vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "Orbitron", color: "#00b4ff", fontSize: 16 }}>Bill #{viewBill.BillNo}</div>
              <button className="btn" onClick={() => setViewBill(null)}
                style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 13, borderRadius: 6 }}>✕ Close</button>
            </div>

            {/* Meta grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {[
                ["Date",     viewBill.Date],
                ["Time",     viewBill.Time],
                ["Cashier",  viewBill.Cashier],
                ["Payment",  viewBill.PaymentMethod],
                ["Customer", (viewBill.CustomerName && viewBill.CustomerName !== "Unknown" && viewBill.CustomerName.trim() !== "") ? viewBill.CustomerName : "Walk-in"],
                ["Cell #",   viewBill.CustomerCell || "—"],
              ].map(([l, v]) => (
                <div key={l} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 10, letterSpacing: 1, marginBottom: 2 }}>{l}</div>
                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Items grouped by category */}
            {(() => {
              const items = safeParseItems(viewBill.ItemsDetail);
              if (!items.length) return <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, textAlign: "center", padding: 16 }}>No item detail available.</div>;
              const grouped = {};
              items.forEach(i => { const c = i.Category || "Items"; if (!grouped[c]) grouped[c] = []; grouped[c].push(i); });
              return (
                <div>
                  {Object.keys(grouped).sort().map(cat => (
                    <div key={cat} style={{ marginBottom: 10 }}>
                      <div style={{ color: "#00b4ff", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 5, padding: "4px 8px", background: "rgba(0,180,255,0.05)", borderRadius: 5 }}>── {cat.toUpperCase()} ──</div>
                      {grouped[cat].map((item, i) => {
                        const disc = parseFloat(item.Discount || 0);
                        const lt   = item.qty * parseFloat(item.Price || 0) - disc * item.qty;
                        return (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: "rgba(255,255,255,0.025)", borderRadius: 7, marginBottom: 4 }}>
                            <div>
                              <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{item.ItemName || item.Barcode}</div>
                              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{item.qty} x PKR {fmt(item.Price)}{disc > 0 ? ` · Disc: PKR ${fmt(disc * item.qty)}` : ""}</div>
                            </div>
                            <div style={{ color: "#00e5a0", fontWeight: 700, fontSize: 13 }}>PKR {fmt(lt)}</div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Totals — NO FBR line, show prevPending for credit */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 12, paddingTop: 12 }}>
              {parseFloat(viewBill.Discount) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(255,255,255,0.5)", fontSize: 12, marginBottom: 4 }}>
                  <span>Total Discount</span><span>− PKR {fmt(viewBill.Discount)}</span>
                </div>
              )}
              {/* Previous balance for credit bills */}
              {viewBill.PaymentMethod === "Credit" && (() => {
                const prev = getPrevPending(viewBill);
                if (prev <= 0) return null;
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#ff9500", fontSize: 12, marginBottom: 4 }}>
                    <span>Previous Balance</span><span>PKR {fmt(prev)}</span>
                  </div>
                );
              })()}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 6 }}>
                <span style={{ color: "#fff", fontSize: 15 }}>GRAND TOTAL</span>
                <span style={{ color: "#00b4ff", fontSize: 18, fontFamily: "Orbitron" }}>PKR {fmt(viewBill.GrandTotal)}</span>
              </div>
              {viewBill.PaymentMethod === "Credit" && (() => {
                const prev = getPrevPending(viewBill);
                if (prev <= 0) return null;
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, marginTop: 6, padding: "6px 10px", background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.25)", borderRadius: 7 }}>
                    <span style={{ color: "#fff", fontSize: 13 }}>TOTAL DEBIT (incl. previous)</span>
                    <span style={{ color: "#ff6b6b", fontSize: 15, fontFamily: "Orbitron" }}>PKR {fmt(parseFloat(viewBill.GrandTotal) + prev)}</span>
                  </div>
                );
              })()}
            </div>

            <button className="btn" onClick={() => reprintBill(viewBill)}
              style={{ width: "100%", marginTop: 14, padding: "11px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, borderRadius: 8, fontWeight: 700 }}>
              🖨 Reprint This Bill
            </button>
          </div>
        </div>
      )}

      {/* Summary cards — FBR removed, replaced with Credit Sales count */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 11, marginBottom: 16 }}>
        {[
          { label: "Total Revenue",  value: `PKR ${fmt(totalRev)}`,  color: "#00b4ff", icon: "💰" },
          { label: "Total Discount", value: `PKR ${fmt(totalDisc)}`, color: "#ffd700", icon: "🏷️" },
          { label: "Credit Sales",   value: filtered.filter(s => s.PaymentMethod === "Credit").length, color: "#ff9500", icon: "📒" },
          { label: "Total Bills",    value: filtered.length,          color: "#00e5a0", icon: "🧮" },
        ].map((card, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${card.color}26`, borderRadius: 11, padding: "14px 17px" }}>
            <div style={{ fontSize: 19, marginBottom: 5 }}>{card.icon}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, letterSpacing: 2, marginBottom: 3 }}>{card.label}</div>
            <div style={{ color: card.color, fontSize: 18, fontWeight: 800, fontFamily: "Orbitron" }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 13, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Filter by Date</label>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...inSt, maxWidth: 180 }} /></div>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Filter by Cashier</label>
          <select value={filterCashier} onChange={e => setFilterCashier(e.target.value)} style={slSt}>
            <option value="All">All Cashiers</option>
            {cashierList.map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <button className="btn" onClick={() => { setFilterDate(""); setFilterCashier("All"); }}
          style={{ padding: "9px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Clear</button>
      </div>

      {/* Table — FBR column removed */}
      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "80px 95px 80px 110px 120px 90px 110px 130px", padding: "8px 12px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>BILL#</div><div>DATE</div><div>TIME</div><div>CASHIER</div>
          <div>CUSTOMER</div><div style={{ textAlign: "right" }}>TOTAL</div>
          <div>PAYMENT</div><div>CELL</div>
        </div>
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {[...filtered].reverse().map((sale, i) => (
            <div key={i} onClick={() => setViewBill(sale)}
              style={{ display: "grid", gridTemplateColumns: "80px 95px 80px 110px 120px 90px 110px 130px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(0,180,255,0.06)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ color: "#00b4ff", fontWeight: 700, fontSize: 12 }}>#{sale.BillNo}</div>
              <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11 }}>{sale.Date}</div>
              <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11 }}>{sale.Time}</div>
              <div style={{ color: "#fff", fontSize: 12 }}>{sale.Cashier}</div>
              <div style={{ color: sale.CustomerName && sale.CustomerName !== "Unknown" && sale.CustomerName.trim() !== "" ? "#00e5a0" : "rgba(255,255,255,0.3)", fontSize: 11 }}>
                {sale.CustomerName && sale.CustomerName !== "Unknown" && sale.CustomerName.trim() !== "" ? sale.CustomerName : "Walk-in"}
              </div>
              <div style={{ color: "#00e5a0", textAlign: "right", fontWeight: 700, fontSize: 12 }}>{fmt(sale.GrandTotal)}</div>
              <div style={{ color: sale.PaymentMethod === "Credit" ? "#ff9500" : "rgba(255,255,255,0.42)", fontSize: 11, fontWeight: sale.PaymentMethod === "Credit" ? 700 : 400 }}>{sale.PaymentMethod}</div>
              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{sale.CustomerCell || "—"}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 7, color: "rgba(255,255,255,0.22)", fontSize: 11 }}>{filtered.length} transactions · 👆 Click any row to view &amp; reprint</div>
    </div>
  );
}

// ── RETURNS TAB ───────────────────────────────────────────────────────────────
export function ReturnsTab({ returns }) {
  const [filterDate, setFilterDate] = useState("");
  const [viewRet,    setViewRet]    = useState(null);
  const filtered    = returns.filter(r => !filterDate || filterDateMatch(r.Date, filterDate));
  const totalRefund = filtered.reduce((s, r) => s + parseFloat(r.RefundAmount || 0), 0);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 11, marginBottom: 16 }}>
        {[
          { label: "Total Returns",  value: filtered.length,          color: "#ff9500", icon: "↩" },
          { label: "Total Refunded", value: `PKR ${fmt(totalRefund)}`, color: "#ff6b6b", icon: "💸" },
        ].map((card, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${card.color}26`, borderRadius: 11, padding: "14px 17px" }}>
            <div style={{ fontSize: 19, marginBottom: 5 }}>{card.icon}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, letterSpacing: 2, marginBottom: 3 }}>{card.label}</div>
            <div style={{ color: card.color, fontSize: 18, fontWeight: 800, fontFamily: "Orbitron" }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 13, alignItems: "flex-end" }}>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Filter by Date</label>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...inSt, maxWidth: 180 }} /></div>
        <button className="btn" onClick={() => setFilterDate("")}
          style={{ padding: "9px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Clear</button>
      </div>

      {viewRet && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.87)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setViewRet(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#0d1b2a", border: "1px solid rgba(255,150,0,0.3)", borderRadius: 14, padding: 24, maxWidth: 480, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontFamily: "Orbitron", color: "#ff9500", fontSize: 15 }}>Return #{viewRet.ReturnNo}</div>
              <button className="btn" onClick={() => setViewRet(null)}
                style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 13, borderRadius: 6 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {[["Orig Bill", viewRet.OrigBillNo], ["Date", viewRet.Date], ["Cashier", viewRet.Cashier], ["Reason", viewRet.Reason]].map(([l, v]) => (
                <div key={l} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ color: "rgba(255,150,0,0.7)", fontSize: 10 }}>{l}</div>
                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
            {safeParseItems(viewRet.Items).map((item, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", background: "rgba(255,255,255,0.025)", borderRadius: 7, marginBottom: 4 }}>
                <span style={{ color: "#fff", fontSize: 12 }}>{item.ItemName} × {item.qty}</span>
                <span style={{ color: "#ff9500", fontWeight: 700 }}>PKR {fmt(item.qty * parseFloat(item.Price || 0))}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>REFUND AMOUNT</span>
              <span style={{ color: "#ff9500", fontWeight: 800, fontSize: 18, fontFamily: "Orbitron" }}>PKR {fmt(viewRet.RefundAmount)}</span>
            </div>
            <button className="btn" onClick={() => printReturnReceipt(viewRet)}
              style={{ width: "100%", marginTop: 12, padding: 11, background: "linear-gradient(135deg,#ff6b00,#ff9500)", color: "#fff", fontSize: 13, borderRadius: 8, fontWeight: 700 }}>
              🖨 Reprint Return Receipt
            </button>
          </div>
        </div>
      )}

      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 90px 95px 80px 110px 100px", padding: "8px 12px", background: "rgba(255,150,0,0.07)", color: "rgba(255,150,0,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>RETURN#</div><div>ORIG BILL</div><div>DATE</div><div>TIME</div><div>CASHIER</div><div style={{ textAlign: "right" }}>REFUND</div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 100, color: "rgba(255,255,255,0.2)", gap: 8 }}>
            <div style={{ fontSize: 26 }}>↩</div><div style={{ fontSize: 12 }}>No returns yet</div>
          </div>
        ) : [...filtered].reverse().map((r, i) => (
          <div key={i} onClick={() => setViewRet(r)}
            style={{ display: "grid", gridTemplateColumns: "90px 90px 95px 80px 110px 100px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,150,0,0.06)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ color: "#ff9500", fontWeight: 700, fontSize: 12 }}>{r.ReturnNo}</div>
            <div style={{ color: "#00b4ff", fontSize: 12 }}>#{r.OrigBillNo}</div>
            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11 }}>{r.Date}</div>
            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11 }}>{r.Time}</div>
            <div style={{ color: "#fff", fontSize: 12 }}>{r.Cashier}</div>
            <div style={{ color: "#ff6b6b", textAlign: "right", fontWeight: 700, fontSize: 12 }}>PKR {fmt(r.RefundAmount)}</div>
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
  const cashierList = [...new Set(sales.map(s => s.Cashier).filter(Boolean))];
  const categories  = [...new Set(items.map(i => i.Category).filter(Boolean))].sort();
  const itemMap     = new Map(items.map(i => [i.Barcode, i]));
  const filtered    = sales.filter(s =>
    filterDateMatch(s.Date, filterDate) && (filterCashier === "All" || s.Cashier === filterCashier)
  );

  let totalRevenue = 0, totalCost = 0, totalDiscount = 0, totalRefund = 0;
  const categoryProfit = {}; const topItems = {};
  filtered.forEach(sale => {
    const saleItems = safeParseItems(sale.ItemsDetail);
    saleItems.forEach(si => {
      if (filterCat !== "All" && si.Category !== filterCat) return;
      const masterItem = itemMap.get(si.Barcode);
      const sellPrice  = parseFloat(si.Price || 0);
      const costPrice  = parseFloat(masterItem?.CostPrice || si.CostPrice || 0);
      const disc = parseFloat(si.Discount || 0);
      const qty  = parseInt(si.qty) || 1;
      const revenue = (sellPrice - disc) * qty;
      const cost    = costPrice * qty;
      const profit  = revenue - cost;
      totalRevenue += revenue; totalCost += cost;
      const cat = si.Category || "Unknown";
      if (!categoryProfit[cat]) categoryProfit[cat] = { revenue: 0, cost: 0, profit: 0, qty: 0 };
      categoryProfit[cat].revenue += revenue; categoryProfit[cat].cost += cost;
      categoryProfit[cat].profit  += profit;  categoryProfit[cat].qty  += qty;
      const key = si.Barcode;
      if (!topItems[key]) topItems[key] = { name: si.ItemName, revenue: 0, profit: 0, qty: 0 };
      topItems[key].revenue += revenue; topItems[key].profit += profit; topItems[key].qty += qty;
    });
    totalDiscount += parseFloat(sale.Discount || 0);
  });
  const filteredReturns = returns.filter(r => filterDateMatch(r.Date, filterDate));
  filteredReturns.forEach(r => { totalRefund += parseFloat(r.RefundAmount || 0); });
  const netRevenue = totalRevenue - totalRefund;
  const netProfit  = netRevenue - totalCost;
  const margin     = netRevenue > 0 ? (netProfit / netRevenue * 100).toFixed(1) : 0;
  const topItemsList = Object.entries(topItems).sort((a, b) => b[1].profit - a[1].profit).slice(0, 10);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Date</label>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...inSt, maxWidth: 180 }} /></div>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Cashier</label>
          <select value={filterCashier} onChange={e => setFilterCashier(e.target.value)} style={slSt}>
            <option value="All">All</option>{cashierList.map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div><label style={{ ...lbSt, marginBottom: 4 }}>Category</label>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={slSt}>
            <option value="All">All</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <button className="btn" onClick={() => { setFilterDate(""); setFilterCashier("All"); setFilterCat("All"); }}
          style={{ padding: "9px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Clear</button>
      </div>

      {totalCost === 0 && (
        <div style={{ background: "rgba(255,200,0,0.07)", border: "1px solid rgba(255,200,0,0.25)", borderRadius: 10, padding: "14px 18px", marginBottom: 16, color: "#ffd700", fontSize: 12 }}>
          ⚠ Cost prices not set for some items. Go to <b>Items tab → Edit</b> and add <b>Cost Price</b> for accurate profit calculation.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 11, marginBottom: 18 }}>
        {[
          { label: "Net Revenue",    value: `PKR ${fmt(netRevenue)}`,   color: "#00b4ff", icon: "💰" },
          { label: "Total Cost",     value: `PKR ${fmt(totalCost)}`,    color: "#ff6b6b", icon: "🏭" },
          { label: "NET PROFIT",     value: `PKR ${fmt(netProfit)}`,    color: netProfit >= 0 ? "#00e5a0" : "#ff6b6b", icon: "📈" },
          { label: "Profit Margin",  value: `${margin}%`,               color: "#ffd700", icon: "%" },
          { label: "Total Discount", value: `PKR ${fmt(totalDiscount)}`,color: "#a78bfa", icon: "🏷" },
          { label: "Refunds",        value: `PKR ${fmt(totalRefund)}`,  color: "#ff9500", icon: "↩" },
        ].map((card, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${card.color}26`, borderRadius: 11, padding: "14px 17px" }}>
            <div style={{ fontSize: 19, marginBottom: 5 }}>{card.icon}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, letterSpacing: 2, marginBottom: 3 }}>{card.label}</div>
            <div style={{ color: card.color, fontSize: 16, fontWeight: 800, fontFamily: "Orbitron" }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.8)", fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>PROFIT BY CATEGORY</div>
          {Object.entries(categoryProfit).sort((a, b) => b[1].profit - a[1].profit).map(([cat, data], i) => (
            <div key={i} style={{ padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{cat}</div><div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>Revenue: PKR {fmt(data.revenue)} · Qty: {data.qty}</div></div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: data.profit >= 0 ? "#00e5a0" : "#ff6b6b", fontWeight: 700, fontSize: 13 }}>PKR {fmt(data.profit)}</div>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>{data.revenue > 0 ? (data.profit / data.revenue * 100).toFixed(1) : 0}%</div>
              </div>
            </div>
          ))}
          {Object.keys(categoryProfit).length === 0 && <div style={{ padding: 20, color: "rgba(255,255,255,0.2)", textAlign: "center", fontSize: 12 }}>No data</div>}
        </div>
        <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "rgba(0,200,100,0.07)", color: "rgba(0,200,100,0.8)", fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>TOP ITEMS BY PROFIT</div>
          {topItemsList.map(([bc, data], i) => (
            <div key={i} style={{ padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{data.name || bc}</div><div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>Sold: {data.qty} units</div></div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#00e5a0", fontWeight: 700, fontSize: 13 }}>PKR {fmt(data.profit)}</div>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>Rev: PKR {fmt(data.revenue)}</div>
              </div>
            </div>
          ))}
          {topItemsList.length === 0 && <div style={{ padding: 20, color: "rgba(255,255,255,0.2)", textAlign: "center", fontSize: 12 }}>No data</div>}
        </div>
      </div>
    </div>
  );
}
