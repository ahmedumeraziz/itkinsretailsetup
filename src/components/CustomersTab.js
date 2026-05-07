import { useState, useEffect, useRef } from "react";
import { inSt, lbSt } from "../config";
import { fmt } from "../utils/helpers";
import { dbPut, dbGet, dbDelete } from "../utils/db";

// ── CUSTOMERS TAB ─────────────────────────────────────────────────────────────
export function CustomersTab({ customers, setCustomers, safeCallScript, sales, currentUser }) {
  const [filterName, setFilterName] = useState(""); const [filterCell, setFilterCell] = useState(""); const [filterBill, setFilterBill] = useState(""); const [filterDate, setFilterDate] = useState("");
  const [showPayModal, setShowPayModal] = useState(false); const [ledgerCustomer, setLedgerCustomer] = useState(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false); const [editingCustomer, setEditingCustomer] = useState(null);

  const filtered = customers.filter(c => {
    if (filterName && !c.Name?.toLowerCase().includes(filterName.toLowerCase())) return false;
    if (filterCell && !c.CellNo?.includes(filterCell)) return false;
    if (filterBill && !c.BillNo?.includes(filterBill)) return false;
    return true;
  });

  const getCustomerSales = (c) => {
    const billNos = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
    return billNos.map(bn => { const padded = bn.padStart(4, "0"); return sales?.find(s => s.BillNo === padded || s.BillNo === bn); }).filter(Boolean);
  };

  const getPending = (c) => {
    const billNos = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
    const totalBills = billNos.reduce((s, bn) => { const sale = sales.find(sale => sale.BillNo === bn); if (!sale) return s; if (sale.PaymentMethod === "Credit") return s + parseFloat(sale.GrandTotal || 0); return s; }, 0);
    const totalPaid = (c.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    return Math.max(0, totalBills - totalPaid);
  };

  const getTotalReceived = (c) => (c.payments || []).filter(p => !filterDate || p.date === filterDate).reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  const handleDeleteCustomer = (c, e) => {
    e.stopPropagation();
    if (window.confirm(`Delete customer "${c.Name}"? This cannot be undone.`)) { setCustomers(p => p.filter(x => x.CellNo !== c.CellNo)); dbDelete("customers", c.CellNo).catch(() => {}); }
  };

  const exportCSV = () => {
    const header = "Name,CellNo,TotalBills,TotalPaid,Pending\n";
    const rows = filtered.map(c => {
      const totalBills = getCustomerSales(c).reduce((s, sale) => s + parseFloat(sale.GrandTotal || 0), 0);
      const totalPaid  = (c.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const pending    = Math.max(0, totalBills - totalPaid);
      return `"${(c.Name||"").replace(/"/g,'""')}","${(c.CellNo||"").replace(/"/g,'""')}","${totalBills}","${totalPaid}","${pending}"`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `Customers_${new Date().toLocaleDateString("en-GB").replace(/\//g,"-")}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 11, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ padding: "11px 18px", background: "rgba(0,180,255,0.05)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 10 }}><div style={{ color: "#00b4ff", fontSize: 22, fontWeight: 800 }}>{customers.length}</div><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>Total Customers</div></div>
        <div style={{ padding: "11px 18px", background: "rgba(255,80,80,0.05)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 10 }}><div style={{ color: "#ff6b6b", fontSize: 22, fontWeight: 800 }}>PKR {fmt(filtered.reduce((s, c) => s + getPending(c), 0))}</div><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>Total Pending{filterDate ? " (filtered)" : ""}</div></div>
        <div style={{ padding: "11px 18px", background: "rgba(0,229,160,0.05)", border: "1px solid rgba(0,229,160,0.2)", borderRadius: 10 }}><div style={{ color: "#00e5a0", fontSize: 22, fontWeight: 800 }}>PKR {fmt(filtered.reduce((s, c) => s + getTotalReceived(c), 0))}</div><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>Total Received{filterDate ? " (filtered)" : ""}</div></div>
      </div>
      <div style={{ display: "flex", gap: 9, marginBottom: 13, flexWrap: "wrap", alignItems: "center" }}>
        <input value={filterName} onChange={e => setFilterName(e.target.value)} placeholder="Filter by Name..." style={{ ...inSt, maxWidth: 180 }} />
        <input value={filterCell} onChange={e => setFilterCell(e.target.value)} placeholder="Filter by Cell#..." style={{ ...inSt, maxWidth: 160 }} />
        <input value={filterBill} onChange={e => setFilterBill(e.target.value)} placeholder="Filter by Bill#..." style={{ ...inSt, maxWidth: 140 }} />
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...inSt, maxWidth: 160 }} title="Filter received payments by date" />
        <button className="btn" onClick={() => { setFilterName(""); setFilterCell(""); setFilterBill(""); setFilterDate(""); }} style={{ padding: "9px 13px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Clear</button>
        <button className="btn" onClick={() => setShowAddCustomer(true)} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>+ Add Customer</button>
        {currentUser?.Role === "admin" && <button className="btn" onClick={() => setShowPayModal(true)} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>💰 Receive Payment</button>}
        <button className="btn" onClick={exportCSV} style={{ marginLeft: "auto", padding: "9px 16px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>📥 Export CSV</button>
      </div>
      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: currentUser?.Role === "admin" ? "1fr 160px 1fr 110px 110px 70px" : "1fr 160px 1fr 110px 110px", padding: "8px 14px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>NAME</div><div>CELL NUMBER</div><div>BILL NO(S)</div><div style={{ textAlign: "right" }}>TOTAL BILLS</div><div style={{ textAlign: "right" }}>PENDING</div>{currentUser?.Role === "admin" && <div style={{ textAlign: "center" }}>ACTION</div>}
        </div>
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 140, color: "rgba(255,255,255,0.2)", gap: 8 }}><div style={{ fontSize: 30 }}>👥</div><div style={{ fontSize: 12 }}>No customers found</div></div>
          ) : filtered.map((c, i) => {
            const totalBills = getCustomerSales(c).reduce((s, sale) => s + parseFloat(sale.GrandTotal || 0), 0);
            const pending = getPending(c);
            return (
              <div key={i} onClick={() => setLedgerCustomer(c)} style={{ display: "grid", gridTemplateColumns: currentUser?.Role === "admin" ? "1fr 160px 1fr 110px 110px 70px" : "1fr 160px 1fr 110px 110px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.035)", alignItems: "center", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(0,180,255,0.05)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#0062ff,#00b4ff)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{c.Name?.[0]?.toUpperCase() || "?"}</div>
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{c.Name || "—"}</span>
                </div>
                <div style={{ color: "rgba(0,180,255,0.8)", fontSize: 12, fontFamily: "monospace" }}>{c.CellNo || "—"}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{(c.BillNo || "").split(",").filter(Boolean).map(b => (<span key={b} style={{ padding: "2px 8px", borderRadius: 12, background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 10, fontWeight: 700 }}>#{b.trim()}</span>))}</div>
                <div style={{ textAlign: "right", color: "#00e5a0", fontSize: 12, fontWeight: 700 }}>PKR {fmt(totalBills)}</div>
                <div style={{ textAlign: "right", color: pending > 0 ? "#ff6b6b" : "#00e5a0", fontSize: 12, fontWeight: 700 }}>{pending > 0 ? `PKR ${fmt(pending)}` : "✓ Paid"}</div>
                {currentUser?.Role === "admin" && (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 5 }}>
                    <button className="btn" onClick={e => { e.stopPropagation(); setEditingCustomer(c); }} style={{ padding: "4px 10px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 11, borderRadius: 5 }}>Edit</button>
                    <button className="btn" onClick={e => handleDeleteCustomer(c, e)} style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 5 }}>Del</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {showAddCustomer && <AddCustomerModal customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} onClose={() => setShowAddCustomer(false)} />}
      {showPayModal && <ReceivePaymentModal customers={customers} setCustomers={setCustomers} sales={sales} safeCallScript={safeCallScript} onClose={() => setShowPayModal(false)} />}
      {ledgerCustomer && <CustomerLedgerModal customer={ledgerCustomer} customers={customers} setCustomers={setCustomers} sales={sales} onClose={() => setLedgerCustomer(null)} />}
      {editingCustomer && <EditCustomerModal customer={editingCustomer} customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} onClose={() => setEditingCustomer(null)} />}
    </div>
  );
}

// ─── ADD CUSTOMER MODAL ───────────────────────────────────────────────────────
function AddCustomerModal({ customers, setCustomers, safeCallScript, onClose }) {
  const [name, setName] = useState(""); const [cell, setCell] = useState(""); const [msg, setMsg] = useState("");
  const handleSave = async () => {
    if (!name.trim() || !cell.trim()) { setMsg("Name and Cell# are required."); return; }
    if (customers.find(c => c.CellNo === cell.trim())) { setMsg("A customer with this cell# already exists."); return; }
    const newCust = { Name: name.trim(), CellNo: cell.trim(), BillNo: "", payments: [] };
    setCustomers(p => [...p, newCust]);
    try { await dbPut("customers", { ...newCust, id: cell.trim() }); } catch(e) {}
    await safeCallScript({ action: "saveCustomer", Name: name.trim(), CellNo: cell.trim(), BillNo: "" });
    onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0c1828", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 380, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ color: "#00b4ff", fontSize: 14, fontWeight: 700 }}>➕ Add New Customer</div>
          <button className="btn" onClick={onClose} style={{ width: 28, height: 28, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6, fontSize: 14 }}>✕</button>
        </div>
        <div style={{ marginBottom: 12 }}><label style={lbSt}>FULL NAME</label><input value={name} onChange={e => setName(e.target.value)} style={inSt} placeholder="Customer name..." /></div>
        <div style={{ marginBottom: 14 }}><label style={lbSt}>CELL NUMBER</label><input value={cell} onChange={e => setCell(e.target.value)} style={inSt} placeholder="e.g. 0300-1234567" onKeyDown={e => e.key === "Enter" && handleSave()} /></div>
        {msg && <div style={{ marginBottom: 12, color: "#ff6b6b", fontSize: 12 }}>{msg}</div>}
        <button className="btn" onClick={handleSave} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>💾 Save Customer</button>
      </div>
    </div>
  );
}

// ─── EDIT CUSTOMER MODAL ──────────────────────────────────────────────────────
function EditCustomerModal({ customer, customers, setCustomers, safeCallScript, onClose }) {
  const [name, setName] = useState(customer.Name || ""); const [cell, setCell] = useState(customer.CellNo || ""); const [msg, setMsg] = useState("");
  const handleSave = async () => {
    if (!name.trim() || !cell.trim()) { setMsg("Name and Cell# required."); return; }
    const updated = { ...customer, Name: name.trim(), CellNo: cell.trim() };
    setCustomers(p => p.map(c => c.CellNo === customer.CellNo ? updated : c));
    try { await dbPut("customers", { ...updated, id: cell.trim() }); } catch(e) {}
    await safeCallScript({ action: "saveCustomer", Name: name.trim(), CellNo: cell.trim(), BillNo: customer.BillNo || "" });
    onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0c1828", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 380, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ color: "#00b4ff", fontSize: 14, fontWeight: 700 }}>✏️ Edit Customer</div>
          <button className="btn" onClick={onClose} style={{ width: 28, height: 28, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6, fontSize: 14 }}>✕</button>
        </div>
        <div style={{ marginBottom: 12 }}><label style={lbSt}>FULL NAME</label><input value={name} onChange={e => setName(e.target.value)} style={inSt} /></div>
        <div style={{ marginBottom: 14 }}><label style={lbSt}>CELL NUMBER</label><input value={cell} onChange={e => setCell(e.target.value)} style={inSt} /></div>
        {msg && <div style={{ marginBottom: 12, color: "#ff6b6b", fontSize: 12 }}>{msg}</div>}
        <button className="btn" onClick={handleSave} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>💾 Save</button>
      </div>
    </div>
  );
}

// ─── RECEIVE PAYMENT MODAL ────────────────────────────────────────────────────
function ReceivePaymentModal({ customers, setCustomers, sales, safeCallScript, onClose }) {
  const [query, setQuery] = useState(""); const [results, setResults] = useState([]); const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState(""); const [note, setNote] = useState("Received"); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [msg, setMsg] = useState("");
  const saving = useRef(false);
  useEffect(() => { const q = query.trim().toLowerCase(); if (!q) { setResults([]); return; } setResults(customers.filter(c => c.Name?.toLowerCase().includes(q) || c.CellNo?.includes(q)).slice(0, 8)); }, [query, customers]);
  const getCustomerSales = (c) => { const billNos = (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim()); return billNos.map(bn => sales?.find(s => s.BillNo === bn.padStart(4,"0") || s.BillNo === bn)).filter(Boolean); };
  const getPending = (c) => { const totalBills = getCustomerSales(c).reduce((s, sale) => { if (sale.PaymentMethod === "Credit") return s + parseFloat(sale.GrandTotal || 0); return s; }, 0); const totalPaid = (c.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0); return Math.max(0, totalBills - totalPaid); };
  const handleSave = async () => {
    if (saving.current) return;
    if (!selected || !amount || parseFloat(amount) <= 0) { setMsg("Please select a customer and enter a valid amount."); return; }
    saving.current = true;
    const payment = { date, amount: parseFloat(amount), note: note.trim() || "Received" };
    const updated = customers.map(c => c.CellNo === selected.CellNo ? { ...c, payments: [...(c.payments || []), payment] } : c);
    setCustomers(updated);
    try { const dbC = await dbGet("customers", selected.CellNo); if (dbC) await dbPut("customers", { ...dbC, payments: [...(dbC.payments || []), payment] }); } catch (e) {}
    await safeCallScript({ action: "savePayment", CellNo: selected.CellNo.trim(), date, amount: parseFloat(amount), note: note.trim() || "Received" });
    saving.current = false; onClose();
  };
  const pending = selected ? getPending(selected) : 0;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0c1828", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 420, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ color: "#00b4ff", fontSize: 14, fontWeight: 700 }}>💰 Receive Payment</div>
          <button className="btn" onClick={onClose} style={{ width: 28, height: 28, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6, fontSize: 14 }}>✕</button>
        </div>
        <label style={{ ...lbSt, marginBottom: 5 }}>Search Customer (Name or Cell #)</label>
        <div style={{ position: "relative", marginBottom: 14 }}>
          <input value={query} onChange={e => { setQuery(e.target.value); setSelected(null); }} placeholder="Type name or number..." style={{ ...inSt, width: "100%", padding: "8px 12px" }} />
          {results.length > 0 && !selected && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#0c1828", border: "1px solid rgba(0,180,255,0.28)", borderRadius: 8, zIndex: 10 }}>
              {results.map((c, i) => (<div key={i} onClick={() => { setSelected(c); setQuery(c.Name); setResults([]); }} style={{ padding: "8px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(0,180,255,0.1)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}><span style={{ color: "#fff", fontSize: 12 }}>{c.Name}</span><span style={{ color: "rgba(0,180,255,0.7)", fontSize: 11 }}>{c.CellNo}</span></div>))}
            </div>
          )}
        </div>
        {selected && (
          <div style={{ background: "rgba(0,180,255,0.06)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 9, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ color: "#fff", fontWeight: 700, marginBottom: 3 }}>{selected.Name}</div>
            <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11, marginBottom: 8 }}>{selected.CellNo}</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Outstanding Balance</span><span style={{ color: pending > 0 ? "#ff6b6b" : "#00e5a0", fontWeight: 700, fontSize: 14 }}>PKR {fmt(pending)}</span></div>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={{ ...lbSt, marginBottom: 5 }}>Amount (PKR)</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" style={{ ...inSt, width: "100%", padding: "8px 12px", fontSize: 15 }} /></div>
          <div style={{ flex: 1 }}><label style={{ ...lbSt, marginBottom: 5 }}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inSt, width: "100%", padding: "8px 12px" }} /></div>
        </div>
        <div style={{ marginBottom: 14 }}><label style={{ ...lbSt, marginBottom: 5 }}>Note</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Cash received, Bank transfer..." style={{ ...inSt, width: "100%", padding: "8px 12px" }} /></div>
        {msg && <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", borderRadius: 7, color: "#ff6b6b", fontSize: 12 }}>{msg}</div>}
        <button className="btn" onClick={handleSave} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>💾 Save Payment</button>
      </div>
    </div>
  );
}

// ─── CUSTOMER LEDGER MODAL ────────────────────────────────────────────────────
function CustomerLedgerModal({ customer, customers, setCustomers, sales, onClose }) {
  const billNos = (customer.BillNo || "").split(",").filter(Boolean).map(b => b.trim());
  const custSales = billNos.map(bn => sales?.find(s => s.BillNo === bn)).filter(Boolean);
  const debitRows  = custSales.filter(s => s.PaymentMethod === "Credit").map(s => ({ date: s.Date, type: "debit", billNo: s.BillNo, desc: `Bill #${s.BillNo} (Credit)`, debit: parseFloat(s.GrandTotal || 0), credit: 0 }));
  const creditRows = (customer.payments || []).map((p, i) => ({ date: p.date, type: "credit", billNo: null, desc: `Payment Received${p.note ? " — " + p.note : ""}`, debit: 0, credit: parseFloat(p.amount || 0), payIndex: i }));
  const allRows = [...debitRows, ...creditRows].sort((a, b) => {
    const parse = d => { if (!d) return 0; if (d.includes("/")) { const [dd,mm,yy] = d.split("/"); return new Date(yy+"-"+mm+"-"+dd).getTime(); } return new Date(d).getTime(); };
    return parse(a.date) - parse(b.date);
  });
  let running = 0;
  const rows = allRows.map(r => { running = running + r.debit - r.credit; return { ...r, balance: running }; });
  const totalBills = debitRows.reduce((s, r) => s + r.debit, 0);
  const totalPaid  = creditRows.reduce((s, r) => s + r.credit, 0);
  const pending    = Math.max(0, totalBills - totalPaid);

  const downloadPDF = () => {
    let tableRows = "";
    rows.forEach(r => { tableRows += `<tr><td>${r.date||"—"}</td><td>${r.desc}${r.billNo?` (#${r.billNo})`:""}</td><td style="color:${r.debit>0?"#c00":"#aaa"};text-align:right">${r.debit>0?`PKR ${r.debit.toLocaleString()}`:"—"}</td><td style="color:${r.credit>0?"#007700":"#aaa"};text-align:right">${r.credit>0?`PKR ${r.credit.toLocaleString()}`:"—"}</td><td style="font-weight:bold;text-align:right;color:${r.balance>0?"#c00":"#007700"}">${r.balance>0?`PKR ${r.balance.toLocaleString()}`:"NIL"}</td></tr>`; });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;color:#000;background:#fff;padding:30px}h1{font-size:20px;text-align:center;margin-bottom:4px}.sub{text-align:center;color:#555;font-size:12px;margin-bottom:20px}.info-box{display:flex;gap:30px;margin-bottom:20px;padding:12px 16px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9}.info-item{display:flex;flex-direction:column;gap:2px}.info-label{color:#777;font-size:10px;text-transform:uppercase;letter-spacing:1px}.info-val{font-weight:bold;font-size:14px}table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#0c1828;color:#fff;padding:8px 10px;text-align:left;font-size:11px;letter-spacing:1px}td{padding:7px 10px;border-bottom:1px solid #eee;font-size:12px}tr:nth-child(even){background:#f7f7f7}.footer{text-align:center;color:#aaa;font-size:10px;margin-top:10px}@media print{body{padding:10px}}</style></head><body>
    <h1>MART — BAKERY & STORES</h1><div class="sub">Customer Account Statement</div>
    <div class="info-box"><div class="info-item"><span class="info-label">Customer Name</span><span class="info-val">${customer.Name}</span></div><div class="info-item"><span class="info-label">Cell Number</span><span class="info-val">${customer.CellNo||"—"}</span></div><div class="info-item"><span class="info-label">Total Billed</span><span class="info-val" style="color:#c00">PKR ${totalBills.toLocaleString()}</span></div><div class="info-item"><span class="info-label">Total Paid</span><span class="info-val" style="color:#007700">PKR ${totalPaid.toLocaleString()}</span></div><div class="info-item"><span class="info-label">Balance Due</span><span class="info-val" style="color:${pending>0?"#c00":"#007700"}">${pending>0?`PKR ${pending.toLocaleString()}`:"CLEAR"}</span></div></div>
    <table><thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead><tbody>${tableRows}</tbody></table>
    <div class="footer">Generated by itKINS POS System · itkins.com · 0304-7414437</div><br/></body></html>`;
    const w = window.open("", "_blank", "width=900,height=700"); if (!w) { alert("Allow popups!"); return; } w.document.write(html); w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 450);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0a0e1a", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 720, maxWidth: "96vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div><div style={{ color: "#00b4ff", fontSize: 16, fontWeight: 800 }}>{customer.Name}</div><div style={{ color: "rgba(0,180,255,0.6)", fontSize: 12, fontFamily: "monospace" }}>{customer.CellNo || "—"}</div></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={downloadPDF} style={{ padding: "7px 14px", background: "linear-gradient(135deg,#b45309,#fbbf24)", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>📄 Download PDF (A4)</button>
            <button className="btn" onClick={onClose} style={{ width: 30, height: 30, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6, fontSize: 14 }}>✕</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {[{label:"Total Billed",val:`PKR ${fmt(totalBills)}`,color:"#ff6b6b"},{label:"Total Paid",val:`PKR ${fmt(totalPaid)}`,color:"#00e5a0"},{label:"Balance Due",val:pending>0?`PKR ${fmt(pending)}`:"✓ CLEAR",color:pending>0?"#ff6b6b":"#00e5a0"}].map((s,i) => (
            <div key={i} style={{ flex: 1, minWidth: 140, padding: "9px 14px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 9 }}><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10 }}>{s.label}</div><div style={{ color: s.color, fontWeight: 800, fontSize: 15 }}>{s.val}</div></div>
          ))}
        </div>
        <div style={{ flex: 1, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 130px 130px 120px 30px", padding: "8px 14px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700, position: "sticky", top: 0 }}>
            <div>DATE</div><div>DESCRIPTION</div><div style={{ textAlign: "right" }}>DEBIT (Dr)</div><div style={{ textAlign: "right" }}>CREDIT (Cr)</div><div style={{ textAlign: "right" }}>BALANCE</div><div />
          </div>
          <div style={{ overflowY: "auto", maxHeight: 360 }}>
            {rows.length === 0 ? <div style={{ textAlign: "center", padding: 30, color: "rgba(255,255,255,0.2)" }}>No transactions found</div>
            : rows.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr 130px 130px 120px 30px", padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.035)", alignItems: "center", background: i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{r.date||"—"}</div>
                <div style={{ color: "#fff", fontSize: 12 }}>{r.desc}{r.billNo?<span style={{ color: "#00b4ff", marginLeft: 5, fontSize: 10 }}>#{r.billNo}</span>:null}</div>
                <div style={{ textAlign: "right", color: r.debit>0?"#ff6b6b":"rgba(255,255,255,0.2)", fontSize: 12, fontWeight: r.debit>0?700:400 }}>{r.debit>0?`PKR ${fmt(r.debit)}`:"—"}</div>
                <div style={{ textAlign: "right", color: r.credit>0?"#00e5a0":"rgba(255,255,255,0.2)", fontSize: 12, fontWeight: r.credit>0?700:400 }}>{r.credit>0?`PKR ${fmt(r.credit)}`:"—"}</div>
                <div style={{ textAlign: "right", color: r.balance>0?"#ff6b6b":"#00e5a0", fontSize: 13, fontWeight: 800 }}>{r.balance>0?`PKR ${fmt(r.balance)}`:"NIL"}</div>
                <div>{r.type==="credit"&&(<button className="btn" title="Delete this payment" onClick={()=>{ if(!window.confirm("Delete this payment record?"))return; const updatedPayments=(customer.payments||[]).filter((_,pi)=>pi!==r.payIndex); setCustomers(prev=>prev.map(c=>c.CellNo===customer.CellNo?{...c,payments:updatedPayments}:c)); dbGet("customers",customer.CellNo).then(dbC=>{if(dbC)dbPut("customers",{...dbC,payments:updatedPayments});}).catch(()=>{}); onClose(); }} style={{ width:22,height:22,background:"rgba(255,80,80,0.1)",border:"1px solid rgba(255,80,80,0.2)",color:"#ff6b6b",fontSize:11,borderRadius:4,padding:0,cursor:"pointer" }}>✕</button>)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
