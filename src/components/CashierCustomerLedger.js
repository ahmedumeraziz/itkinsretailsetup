import { useState, useEffect, useRef } from "react";
import { inSt } from "../config";
import { fmt } from "../utils/helpers";

// Normalise bill numbers for comparison ("0115" === "115")
function normBill(b) { return String(b || "").trim().replace(/^0+/, "") || "0"; }

function computePending(c, sales) {
  if (!c) return 0;
  const billNos = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
  const totalCredit = billNos.reduce((sum, bn) => {
    const norm = normBill(bn);
    const sale = sales.find(s => normBill(s.BillNo) === norm);
    if (!sale || sale.PaymentMethod !== "Credit") return sum;
    return sum + parseFloat(sale.GrandTotal || 0);
  }, 0);
  const totalPaid = (c.payments || []).reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  return Math.max(0, totalCredit - totalPaid);
}

export default function CashierCustomerLedger({
  customers, sales, currentBillTotal,
  onSelectCustomer, selectedName, selectedCell, onClear,
}) {
  const [query,      setQuery]      = useState("");
  const [results,    setResults]    = useState([]);
  const [pending,    setPending]    = useState(null);   // null = loading
  const [loadingPending, setLoadingPending] = useState(false);
  const pendingTimer = useRef(null);

  // ── Clear selection when parent clears
  useEffect(() => {
    if (!selectedName || selectedName.trim() === "" || selectedName === "Unknown") {
      setQuery(""); setPending(null); setLoadingPending(false);
    }
  }, [selectedName]);

  // ── Search dropdown
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) { setResults([]); return; }
    setResults(customers.filter(c =>
      c.Name?.toLowerCase().includes(q) || c.CellNo?.includes(q)
    ).slice(0, 6));
  }, [query, customers]);

  // ── Re-compute pending whenever customers or sales update (with 1.5s debounce
  //    so the data from App.js has time to propagate after a sale is saved)
  useEffect(() => {
    if (!selectedCell) { setPending(null); return; }
    setLoadingPending(true);
    clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => {
      const c = customers.find(cx => cx.CellNo === selectedCell);
      const p = c ? computePending(c, sales) : 0;
      setPending(p);
      setLoadingPending(false);
    }, 1500);
    return () => clearTimeout(pendingTimer.current);
  }, [selectedCell, customers, sales]);

  const handleSelect = (c) => {
    setQuery(""); setResults([]);
    setPending(null); setLoadingPending(true);
    onSelectCustomer(c.Name, c.CellNo);
  };

  const handleClear = () => {
    setPending(null); setLoadingPending(false);
    clearTimeout(pendingTimer.current);
    onClear();
  };

  const isSelected = selectedName && selectedName.trim() !== "" && selectedName !== "Unknown";

  // Total after bill = previous pending + today's purchase
  const totalAfter = (pending || 0) + currentBillTotal;

  return (
    <div style={{ background: "rgba(0,180,255,0.05)", border: "1px solid rgba(0,180,255,0.18)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ color: "rgba(0,180,255,0.8)", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 8 }}>👤 CUSTOMER LEDGER</div>

      {!isSelected ? (
        <div style={{ position: "relative" }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or cell number..."
            style={{ ...inSt, padding: "7px 11px", fontSize: 12, border: "1px solid rgba(0,180,255,0.2)", width: "100%" }}
          />
          {results.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#0c1828", border: "1px solid rgba(0,180,255,0.28)", borderRadius: 8, zIndex: 200, boxShadow: "0 8px 30px rgba(0,0,0,0.6)" }}>
              {results.map((c, i) => {
                const p = computePending(c, sales);
                return (
                  <div key={i} onClick={() => handleSelect(c)}
                    style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(0,180,255,0.1)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div>
                      <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{c.Name}</div>
                      <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 10, fontFamily: "monospace" }}>{c.CellNo}</div>
                    </div>
                    {p > 0 && <span style={{ color: "#ff6b6b", fontSize: 11, fontWeight: 700 }}>Pending: PKR {fmt(p)}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Customer name + clear button */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{selectedName}</div>
              <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11, fontFamily: "monospace" }}>{selectedCell}</div>
            </div>
            <button className="btn" onClick={handleClear}
              style={{ padding: "4px 9px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 5 }}>✕</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>

            {/* Previous Pending — always shown, shows spinner while loading */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: loadingPending ? "rgba(255,255,255,0.03)" : pending > 0 ? "rgba(255,80,80,0.09)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${loadingPending ? "rgba(255,255,255,0.08)" : pending > 0 ? "rgba(255,80,80,0.3)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 7, padding: "6px 10px", transition: "all 0.4s"
            }}>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>Previous Pending</span>
              {loadingPending
                ? <span style={{ display: "flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.35)", fontSize: 11 }}>
                    <span style={{ width: 10, height: 10, border: "2px solid rgba(0,180,255,0.4)", borderTop: "2px solid #00b4ff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                    Syncing...
                  </span>
                : <span style={{ color: pending > 0 ? "#ff6b6b" : "#00e5a0", fontWeight: 700, fontSize: 13 }}>
                    {pending > 0 ? `PKR ${fmt(pending)}` : "NIL ✓"}
                  </span>
              }
            </div>

            {/* Today's Purchase */}
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,180,255,0.06)", border: "1px solid rgba(0,180,255,0.15)", borderRadius: 7, padding: "6px 10px" }}>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>Today's Purchase</span>
              <span style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>PKR {fmt(currentBillTotal)}</span>
            </div>

            {/* Total After Bill */}
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,229,160,0.07)", border: "1px solid rgba(0,229,160,0.2)", borderRadius: 7, padding: "6px 10px" }}>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>Total After Bill</span>
              {loadingPending
                ? <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>—</span>
                : <span style={{ color: "#00e5a0", fontWeight: 800, fontSize: 14 }}>PKR {fmt(totalAfter)}</span>
              }
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
