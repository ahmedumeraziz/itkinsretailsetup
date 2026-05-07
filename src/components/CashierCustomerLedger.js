import { useState, useEffect } from "react";
import { inSt } from "../config";
import { fmt } from "../utils/helpers";

export default function CashierCustomerLedger({ customers, sales, currentBillTotal, onSelectCustomer, selectedName, selectedCell, onClear }) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!selectedName || selectedName.trim() === "" || selectedName === "Unknown") {
      setSelected(null);
      setQuery("");
    }
  }, [selectedName]);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) { setResults([]); return; }
    setResults(customers.filter(c =>
      c.Name?.toLowerCase().includes(q) || c.CellNo?.includes(q)
    ).slice(0, 6));
  }, [query, customers]);

  const getPending = (c) => {
    const billNos = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
    const totalBills = billNos.reduce((s, bn) => {
      const sale = sales.find(s => s.BillNo === bn);
      return s + parseFloat(sale?.GrandTotal || 0);
    }, 0);
    const totalPaid = (c.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    return Math.max(0, totalBills - totalPaid);
  };

  const handleSelect = (c) => {
    setSelected(c);
    setQuery("");
    setResults([]);
    onSelectCustomer(c.Name, c.CellNo);
  };

  const handleClear = () => {
    setSelected(null);
    onClear();
  };

  const isSelected = selectedName && selectedName.trim() !== "" && selectedName !== "Unknown";
  const selCustomer = isSelected ? (customers.find(c => c.CellNo === selectedCell) || null) : null;
  const pending = selCustomer ? getPending(selCustomer) : 0;

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
                const p = getPending(c);
                return (
                  <div key={i} onClick={() => handleSelect(c)} style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{selectedName}</div>
              <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11, fontFamily: "monospace" }}>{selectedCell}</div>
            </div>
            <button className="btn" onClick={handleClear} style={{ padding: "4px 9px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 5 }}>✕</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {pending > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(255,80,80,0.07)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 7, padding: "6px 10px" }}>
                <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>Previous Pending</span>
                <span style={{ color: "#ff6b6b", fontWeight: 700, fontSize: 13 }}>PKR {fmt(pending)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,180,255,0.06)", border: "1px solid rgba(0,180,255,0.15)", borderRadius: 7, padding: "6px 10px" }}>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>Today's Purchase</span>
              <span style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13 }}>PKR {fmt(currentBillTotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,229,160,0.07)", border: "1px solid rgba(0,229,160,0.2)", borderRadius: 7, padding: "6px 10px" }}>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>Total After Bill</span>
              <span style={{ color: "#00e5a0", fontWeight: 800, fontSize: 14 }}>PKR {fmt(pending + currentBillTotal)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
