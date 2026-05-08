import { useState, useEffect, useRef } from "react";
import { inSt, lbSt } from "../config";
import { fmt } from "../utils/helpers";
import { dbPut, dbGet, dbDelete } from "../utils/db";

// ─── GENERATE UNIQUE PAYMENT ID ───────────────────────────────────────────────
function generatePID() {
  const now  = new Date();
  const d    = now.toISOString().slice(0, 10).replace(/-/g, "");
  const t    = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `RP-${d}-${t}-${rand}`;
}

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────
function normBill(b) { const n = String(b || "").trim().replace(/[^0-9]/g, ""); return n.replace(/^0+/, "") || "0"; }

function getUniqueBillNos(c) {
  const seen = new Set();
  return (c.BillNo || "").split(",").filter(Boolean).map(b => b.trim()).filter(b => {
    const n = normBill(b);
    if (seen.has(n)) return false;
    seen.add(n); return true;
  });
}

function getCustomerSalesAll(c, sales) {
  return getUniqueBillNos(c).map(bn => {
    const norm = normBill(bn);
    return sales.find(s => normBill(s.BillNo) === norm);
  }).filter(Boolean);
}

function getPendingBalance(c, sales) {
  const custSales    = getCustomerSalesAll(c, sales);
  const totalCredit  = custSales.filter(s => s.PaymentMethod === "Credit").reduce((sum, s) => sum + parseFloat(s.GrandTotal || 0), 0);
  const openingDebit = parseFloat(c.openingDebit || 0);
  const totalPaid    = (c.payments || []).reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  return Math.max(0, totalCredit + openingDebit - totalPaid);
}

function getTotalBilledAll(c, sales) {
  return getCustomerSalesAll(c, sales).reduce((sum, s) => sum + parseFloat(s.GrandTotal || 0), 0);
}

function parseDate(d) {
  if (!d) return 0;
  if (d.includes("/")) { const [dd, mm, yy] = d.split("/"); return parseInt(`${yy}${mm.padStart(2,"0")}${dd.padStart(2,"0")}`); }
  return parseInt(d.replace(/-/g,""));
}
function inputToNum(d) { return d ? parseInt(d.replace(/-/g,"")) : 0; }

// ─── PRINT PAYMENT RECEIPT ────────────────────────────────────────────────────
function printPaymentReceipt({ customer, amountReceived, date, note, pid, pendingBefore, remainingAfter }) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;width:302px;padding:10px 6px;color:#000;background:#fff}
  .sn{font-size:15px;font-weight:bold;text-align:center;margin-bottom:1px}.dv{border-top:1px dashed #000;margin:5px 0}
  .bi{display:flex;justify-content:space-between;font-size:10px;margin:1px 0}.row{display:flex;justify-content:space-between;margin:5px 0;font-size:12px}
  .big{font-size:14px;font-weight:bold}.ft{text-align:center;font-size:10px;margin-top:8px}@media print{body{margin:0}}</style>
  </head><body>
  <div class="sn">MART - BAKERY AND STORES</div>
  <div class="dv"></div>
  <div class="bi"><span>PAYMENT RECEIPT</span><span>${date}</span></div>
  <div class="bi"><span>Receipt ID:</span><span style="font-weight:bold">${pid}</span></div>
  <div class="dv"></div>
  <div class="bi"><span>Customer:</span><span><b>${customer.Name}</b></span></div>
  <div class="bi"><span>Cell#:</span><span>${customer.CellNo || "—"}</span></div>
  ${note ? `<div class="bi"><span>Note:</span><span>${note}</span></div>` : ""}
  <div class="dv"></div>
  <div class="row"><span>Outstanding Balance</span><span>PKR ${fmt(pendingBefore)}</span></div>
  <div class="row big"><span>Amount Received</span><span>PKR ${fmt(amountReceived)}</span></div>
  <div class="dv"></div>
  <div class="row" style="font-weight:bold;font-size:14px">
    <span>Remaining Balance</span>
    <span style="color:${remainingAfter > 0 ? "#c00" : "#006600"}">${remainingAfter > 0 ? "PKR " + fmt(remainingAfter) : "CLEAR ✓"}</span>
  </div>
  <div class="dv"></div>
  <div class="ft">Thank you for your payment!<br><b>Mart, Bakery & Store</b></div>
  <div style="text-align:center;font-size:9px;margin-top:3px;color:#555">Designed by itkins.com | 0304-7414437</div>
  <br/><br/></body></html>`;
  const w = window.open("", "_blank", "width=340,height=600");
  if (!w) { alert("Allow popups to print!"); return; }
  w.document.write(html); w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

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

  const filtered = customers.filter(c => {
    if (filterName && !c.Name?.toLowerCase().includes(filterName.toLowerCase())) return false;
    if (filterCell && !c.CellNo?.includes(filterCell)) return false;
    if (filterBill) {
      const norm  = normBill(filterBill);
      const bills = getUniqueBillNos(c).map(b => normBill(b));
      if (!bills.includes(norm)) return false;
    }
    if (dateFrom || dateTo) {
      const from = inputToNum(dateFrom);
      const to   = inputToNum(dateTo) || 99999999;
      const custSales = getCustomerSalesAll(c, sales);
      if (!custSales.some(s => { const d = parseDate(s.Date); return d >= (from || 0) && d <= to; })) return false;
    }
    return true;
  });

  const totalPending  = filtered.reduce((s, c) => s + getPendingBalance(c, sales), 0);
  const totalReceived = filtered.reduce((s, c) => (c.payments || []).reduce((ps, p) => ps + parseFloat(p.amount || 0), 0) + s, 0);

  const handleDeleteCustomer = async (c, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete customer "${c.Name}"? This cannot be undone.`)) return;
    setCustomers(p => p.filter(x => x.CellNo !== c.CellNo));
    try { await dbDelete("customers", c.CellNo); } catch {}
    await safeCallScript({ action: "deleteCustomer", CellNo: c.CellNo });
  };

  const exportCSV = () => {
    const header = "Name,CellNo,Bills,TotalBilled,TotalPaid,Pending\n";
    const rows   = filtered.map(c => {
      const totalBilled = getTotalBilledAll(c, sales);
      const totalPaid   = (c.payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const pending     = getPendingBalance(c, sales);
      return `"${(c.Name||"").replace(/"/g,'""')}","${(c.CellNo||"").replace(/"/g,'""')}","${getUniqueBillNos(c).join(",")}","${totalBilled}","${totalPaid}","${pending}"`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `Customers_${new Date().toLocaleDateString("en-GB").replace(/\//g,"-")}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Summary Cards */}
      <div style={{ display: "flex", gap: 11, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Total Customers",    val: customers.length,            color: "#00b4ff" },
          { label: "Total Pending (Cr)", val: `PKR ${fmt(totalPending)}`,  color: "#ff6b6b" },
          { label: "Total Received",     val: `PKR ${fmt(totalReceived)}`, color: "#00e5a0" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "11px 18px", background: `rgba(${s.color==="＃00b4ff"?"0,180,255":s.color==="#ff6b6b"?"255,80,80":"0,229,160"},0.05)`, border: `1px solid ${s.color}33`, borderRadius: 10 }}>
            <div style={{ color: s.color, fontSize: 22, fontWeight: 800 }}>{s.val}</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 9, marginBottom: 13, flexWrap: "wrap", alignItems: "center" }}>
        <input value={filterName} onChange={e => setFilterName(e.target.value)} placeholder="Filter by Name..."  style={{ ...inSt, maxWidth: 155 }} />
        <input value={filterCell} onChange={e => setFilterCell(e.target.value)} placeholder="Filter by Cell#..." style={{ ...inSt, maxWidth: 140 }} />
        <input value={filterBill} onChange={e => setFilterBill(e.target.value)} placeholder="Filter by Bill#..." style={{ ...inSt, maxWidth: 125 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <label style={{ color: "rgba(0,180,255,0.6)", fontSize: 10, whiteSpace: "nowrap" }}>From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inSt, maxWidth: 145, padding: "7px 9px", fontSize: 11 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <label style={{ color: "rgba(0,180,255,0.6)", fontSize: 10, whiteSpace: "nowrap" }}>To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inSt, maxWidth: 145, padding: "7px 9px", fontSize: 11 }} />
        </div>
        <button className="btn" onClick={() => { setFilterName(""); setFilterCell(""); setFilterBill(""); setDateFrom(""); setDateTo(""); }}
          style={{ padding: "9px 13px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Clear</button>
        <button className="btn" onClick={() => setShowAddCustomer(true)}
          style={{ padding: "9px 16px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>+ Add Customer</button>
        {currentUser?.Role === "admin" && (
          <button className="btn" onClick={() => setShowPayModal(true)}
            style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>💰 Receive Payment</button>
        )}
        <button className="btn" onClick={exportCSV}
          style={{ marginLeft: "auto", padding: "9px 16px", background: "linear-gradient(135deg,#b45309,#fbbf24)", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>📥 Export CSV</button>
      </div>

      {/* Table */}
      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: currentUser?.Role === "admin" ? "1fr 160px 1fr 110px 110px 80px" : "1fr 160px 1fr 110px 110px", padding: "8px 14px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>NAME</div><div>CELL NUMBER</div><div>BILL NO(S)</div>
          <div style={{ textAlign: "right" }}>TOTAL BILLED</div>
          <div style={{ textAlign: "right" }}>PENDING</div>
          {currentUser?.Role === "admin" && <div style={{ textAlign: "center" }}>ACTION</div>}
        </div>
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          {filtered.length === 0
            ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 140, color: "rgba(255,255,255,0.2)", gap: 8 }}><div style={{ fontSize: 30 }}>👥</div><div style={{ fontSize: 12 }}>No customers found</div></div>
            : filtered.map((c, i) => {
              const totalBilled = getTotalBilledAll(c, sales);
              const pending     = getPendingBalance(c, sales);
              const uniqueBills = getUniqueBillNos(c);
              return (
                <div key={i} onClick={() => setLedgerCustomer(c)}
                  style={{ display: "grid", gridTemplateColumns: currentUser?.Role === "admin" ? "1fr 160px 1fr 110px 110px 80px" : "1fr 160px 1fr 110px 110px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.035)", alignItems: "center", cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(0,180,255,0.05)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#0062ff,#00b4ff)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{c.Name?.[0]?.toUpperCase() || "?"}</div>
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{c.Name || "—"}</span>
                  </div>
                  <div style={{ color: "rgba(0,180,255,0.8)", fontSize: 12, fontFamily: "monospace" }}>{c.CellNo || "—"}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {uniqueBills.slice(0, 6).map(b => <span key={b} style={{ padding: "2px 7px", borderRadius: 12, background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 10, fontWeight: 700 }}>#{b}</span>)}
                    {uniqueBills.length > 6 && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>+{uniqueBills.length - 6}</span>}
                  </div>
                  <div style={{ textAlign: "right", color: "#00e5a0", fontSize: 12, fontWeight: 700 }}>PKR {fmt(totalBilled)}</div>
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

      {/* Modals */}
      {showAddCustomer && <AddCustomerModal customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} onClose={() => setShowAddCustomer(false)} />}
      {showPayModal    && <ReceivePaymentModal customers={customers} setCustomers={setCustomers} sales={sales} safeCallScript={safeCallScript} onClose={() => setShowPayModal(false)} />}
      {ledgerCustomer  && (
        <CustomerLedgerModal
          customer={customers.find(c => c.CellNo === ledgerCustomer.CellNo) || ledgerCustomer}
          customers={customers} setCustomers={setCustomers} sales={sales}
          safeCallScript={safeCallScript}
          onClose={() => setLedgerCustomer(null)}
        />
      )}
      {editingCustomer && <EditCustomerModal customer={editingCustomer} customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} onClose={() => setEditingCustomer(null)} />}
    </div>
  );
}

// ─── ADD CUSTOMER MODAL ───────────────────────────────────────────────────────
function AddCustomerModal({ customers, setCustomers, safeCallScript, onClose }) {
  const [name, setName] = useState(""); const [cell, setCell] = useState(""); const [openingDebit, setOpeningDebit] = useState(""); const [msg, setMsg] = useState("");
  const handleSave = async () => {
    if (!name.trim() || !cell.trim()) { setMsg("Name and Cell# are required."); return; }
    if (customers.find(c => c.CellNo === cell.trim())) { setMsg("A customer with this cell# already exists."); return; }
    const debit   = parseFloat(openingDebit) || 0;
    const newCust = { Name: name.trim(), CellNo: cell.trim(), BillNo: "", payments: [], openingDebit: debit };
    setCustomers(p => [...p, newCust]);
    try { await dbPut("customers", { ...newCust, id: cell.trim() }); } catch {}
    await safeCallScript({ action: "saveCustomer", Name: name.trim(), CellNo: cell.trim(), BillNo: "", OpeningDebit: debit });
    onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0c1828", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 400, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ color: "#00b4ff", fontSize: 14, fontWeight: 700 }}>➕ Add New Customer</div>
          <button className="btn" onClick={onClose} style={{ width: 28, height: 28, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6, fontSize: 14 }}>✕</button>
        </div>
        <div style={{ marginBottom: 12 }}><label style={lbSt}>FULL NAME</label><input value={name} onChange={e => setName(e.target.value)} style={inSt} placeholder="Customer name..." autoFocus /></div>
        <div style={{ marginBottom: 12 }}><label style={lbSt}>CELL NUMBER</label><input value={cell} onChange={e => setCell(e.target.value)} style={inSt} placeholder="e.g. 0300-1234567" /></div>
        <div style={{ marginBottom: 16 }}>
          <label style={lbSt}>STARTING DEBIT AMOUNT (PKR) — optional</label>
          <input type="number" value={openingDebit} onChange={e => setOpeningDebit(e.target.value)} style={{ ...inSt, border: "1px solid rgba(255,150,0,0.35)" }} placeholder="0 — enter if customer already owes from before" onKeyDown={e => e.key === "Enter" && handleSave()} />
          {parseFloat(openingDebit) > 0 && <div style={{ marginTop: 5, fontSize: 11, color: "#ff9500" }}>⚠ Customer starts with PKR {fmt(parseFloat(openingDebit))} debit</div>}
        </div>
        {msg && <div style={{ marginBottom: 12, color: "#ff6b6b", fontSize: 12 }}>{msg}</div>}
        <button className="btn" onClick={handleSave} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>💾 Save Customer</button>
      </div>
    </div>
  );
}

// ─── EDIT CUSTOMER MODAL ──────────────────────────────────────────────────────
function EditCustomerModal({ customer, customers, setCustomers, safeCallScript, onClose }) {
  const [name, setName] = useState(customer.Name || ""); const [cell, setCell] = useState(customer.CellNo || ""); const [openingDebit, setOpeningDebit] = useState(customer.openingDebit || ""); const [msg, setMsg] = useState("");
  const handleSave = async () => {
    if (!name.trim() || !cell.trim()) { setMsg("Name and Cell# required."); return; }
    const debit   = parseFloat(openingDebit) || 0;
    const updated = { ...customer, Name: name.trim(), CellNo: cell.trim(), openingDebit: debit };
    setCustomers(p => p.map(c => c.CellNo === customer.CellNo ? updated : c));
    try { await dbPut("customers", { ...updated, id: cell.trim() }); } catch {}
    await safeCallScript({ action: "saveCustomer", Name: name.trim(), CellNo: cell.trim(), BillNo: customer.BillNo || "", OpeningDebit: debit });
    onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0c1828", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 400, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ color: "#00b4ff", fontSize: 14, fontWeight: 700 }}>✏️ Edit Customer</div>
          <button className="btn" onClick={onClose} style={{ width: 28, height: 28, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6, fontSize: 14 }}>✕</button>
        </div>
        <div style={{ marginBottom: 12 }}><label style={lbSt}>FULL NAME</label><input value={name} onChange={e => setName(e.target.value)} style={inSt} /></div>
        <div style={{ marginBottom: 12 }}><label style={lbSt}>CELL NUMBER</label><input value={cell} onChange={e => setCell(e.target.value)} style={inSt} /></div>
        <div style={{ marginBottom: 16 }}>
          <label style={lbSt}>STARTING DEBIT AMOUNT (PKR)</label>
          <input type="number" value={openingDebit} onChange={e => setOpeningDebit(e.target.value)} style={{ ...inSt, border: "1px solid rgba(255,150,0,0.35)" }} placeholder="0" />
        </div>
        {msg && <div style={{ marginBottom: 12, color: "#ff6b6b", fontSize: 12 }}>{msg}</div>}
        <button className="btn" onClick={handleSave} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>💾 Save</button>
      </div>
    </div>
  );
}

// ─── RECEIVE PAYMENT MODAL ────────────────────────────────────────────────────
function ReceivePaymentModal({ customers, setCustomers, sales, safeCallScript, onClose }) {
  const [query,    setQuery]    = useState("");
  const [results,  setResults]  = useState([]);
  const [selected, setSelected] = useState(null);
  const [amount,   setAmount]   = useState("");
  const [note,     setNote]     = useState("Cash Received");
  const [date,     setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [msg,      setMsg]      = useState("");
  const saving = useRef(false);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q || selected) { setResults([]); return; }
    setResults(customers.filter(c => c.Name?.toLowerCase().includes(q) || c.CellNo?.includes(q)).slice(0, 8));
  }, [query, customers, selected]);

  const pending   = selected ? getPendingBalance(selected, sales) : 0;
  const received  = parseFloat(amount) || 0;
  const remaining = Math.max(0, pending - received);

  const handleSave = async () => {
    if (saving.current) return;
    if (!selected)     { setMsg("Please select a customer."); return; }
    if (received <= 0) { setMsg("Please enter a valid amount."); return; }
    saving.current = true;

    // Generate unique Payment ID
    const pid     = generatePID();
    const payment = { pid, date, amount: received, note: note.trim() || "Cash Received" };
    const updatedPayments = [...(selected.payments || []), payment];

    setCustomers(prev => prev.map(c => c.CellNo === selected.CellNo ? { ...c, payments: updatedPayments } : c));
    try {
      const dbC = await dbGet("customers", selected.CellNo);
      if (dbC) await dbPut("customers", { ...dbC, payments: updatedPayments });
    } catch {}
    await safeCallScript({ action: "syncPayments", CellNo: selected.CellNo.trim(), payments: JSON.stringify(updatedPayments) });

    printPaymentReceipt({ customer: selected, amountReceived: received, date, note: payment.note, pid, pendingBefore: pending, remainingAfter: remaining });

    saving.current = false;
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0c1828", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 440, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ color: "#00b4ff", fontSize: 14, fontWeight: 700 }}>💰 Receive Payment</div>
          <button className="btn" onClick={onClose} style={{ width: 28, height: 28, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6, fontSize: 14 }}>✕</button>
        </div>

        <label style={{ ...lbSt, marginBottom: 5 }}>SEARCH CUSTOMER</label>
        <div style={{ position: "relative", marginBottom: 14 }}>
          <input value={query} onChange={e => { setQuery(e.target.value); if (selected) setSelected(null); }}
            placeholder="Type name or cell number..." style={{ ...inSt, width: "100%", padding: "8px 12px" }} />
          {results.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#0c1828", border: "1px solid rgba(0,180,255,0.28)", borderRadius: 8, zIndex: 10, boxShadow: "0 8px 30px rgba(0,0,0,0.6)" }}>
              {results.map((c, i) => (
                <div key={i} onClick={() => { setSelected(c); setQuery(c.Name); setResults([]); }}
                  style={{ padding: "8px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(0,180,255,0.1)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ color: "#fff", fontSize: 12 }}>{c.Name}</span>
                  <span style={{ color: "rgba(0,180,255,0.7)", fontSize: 11 }}>{c.CellNo}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div style={{ background: "rgba(0,180,255,0.05)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{selected.Name}</div>
            <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11, fontFamily: "monospace", marginBottom: 10 }}>{selected.CellNo}</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: received > 0 ? 6 : 0 }}>
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Outstanding Balance</span>
              <span style={{ color: pending > 0 ? "#ff6b6b" : "#00e5a0", fontWeight: 700, fontSize: 14 }}>PKR {fmt(pending)}</span>
            </div>
            {received > 0 && <>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Amount Receiving</span>
                <span style={{ color: "#00b4ff", fontWeight: 700, fontSize: 14 }}>PKR {fmt(received)}</span>
              </div>
              <div style={{ borderTop: "1px dashed rgba(255,255,255,0.12)", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>Remaining After</span>
                <span style={{ color: remaining > 0 ? "#ff6b6b" : "#00e5a0", fontWeight: 800, fontSize: 15 }}>{remaining > 0 ? `PKR ${fmt(remaining)}` : "✓ CLEAR"}</span>
              </div>
            </>}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={{ ...lbSt, marginBottom: 5 }}>AMOUNT (PKR)</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" style={{ ...inSt, width: "100%", padding: "8px 12px", fontSize: 15 }} /></div>
          <div style={{ flex: 1 }}><label style={{ ...lbSt, marginBottom: 5 }}>DATE</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inSt, width: "100%", padding: "8px 12px" }} /></div>
        </div>
        <div style={{ marginBottom: 16 }}><label style={{ ...lbSt, marginBottom: 5 }}>NOTE</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Cash received, Bank transfer..." style={{ ...inSt, width: "100%", padding: "8px 12px" }} /></div>
        {msg && <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", borderRadius: 7, color: "#ff6b6b", fontSize: 12 }}>{msg}</div>}
        <button className="btn" onClick={handleSave} style={{ width: "100%", padding: 13, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8 }}>🖨 Save & Print Receipt</button>
      </div>
    </div>
  );
}

// ─── CUSTOMER LEDGER MODAL ────────────────────────────────────────────────────
function CustomerLedgerModal({ customer, customers, setCustomers, sales, safeCallScript, onClose }) {
  const liveCustomer = customers.find(c => c.CellNo === customer.CellNo) || customer;
  const custSales    = getCustomerSalesAll(liveCustomer, sales);
  const openingDebit = parseFloat(liveCustomer.openingDebit || 0);

  const openingRow = openingDebit > 0
    ? [{ date: "", type: "opening", billNo: null, desc: "Opening Balance (Starting Debit)", debit: openingDebit, credit: 0, pid: null }]
    : [];

  const debitRows = custSales
    .filter(s => s.PaymentMethod === "Credit")
    .map(s => ({ date: s.Date, type: "debit", billNo: s.BillNo, desc: `Bill #${s.BillNo} (Debit)`, debit: parseFloat(s.GrandTotal || 0), credit: 0, pid: null }));

  // ── Credit rows use pid as primary key ──────────────────────────────────────
  const creditRows = (liveCustomer.payments || []).map((p, i) => ({
    date:     p.date,
    type:     "credit",
    billNo:   null,
    desc:     `Payment Received${p.note ? " — " + p.note : ""}`,
    debit:    0,
    credit:   parseFloat(p.amount || 0),
    pid:      p.pid || `LEGACY-${i}`,  // backwards compat for old payments without pid
    pidLabel: p.pid || "",
    // Keep index as fallback only for legacy payments without pid
    payIndex: i,
  }));

  const allRows = [...openingRow, ...debitRows, ...creditRows].sort((a, b) => {
    const parse = d => {
      if (!d) return -1;
      if (d.includes("/")) { const [dd, mm, yy] = d.split("/"); return new Date(`${yy}-${mm}-${dd}`).getTime(); }
      return new Date(d).getTime();
    };
    const diff = parse(a.date) - parse(b.date);
    if (diff !== 0) return diff;
    // Same date: opening first, then debits, then credits
    const order = { opening: 0, debit: 1, credit: 2 };
    if ((order[a.type] ?? 1) !== (order[b.type] ?? 1)) return (order[a.type] ?? 1) - (order[b.type] ?? 1);
    return (a.payIndex ?? 0) - (b.payIndex ?? 0);
  });

  let running = 0;
  const rows = allRows.map(r => { running = running + r.debit - r.credit; return { ...r, balance: running }; });

  const totalDebit = debitRows.reduce((s, r) => s + r.debit, 0) + openingDebit;
  const totalPaid  = creditRows.reduce((s, r) => s + r.credit, 0);
  const pending    = Math.max(0, totalDebit - totalPaid);

  // ── Delete by pid (or fallback index for legacy) ───────────────────────────
  const deletePayment = async (pid, payIndex) => {
    if (!window.confirm("Delete this payment record?")) return;

    let updatedPayments;
    if (pid && !pid.startsWith("LEGACY-")) {
      // Modern: delete by pid — 100% safe, index-independent
      updatedPayments = (liveCustomer.payments || []).filter(p => p.pid !== pid);
    } else {
      // Legacy fallback: delete by index
      const target = (liveCustomer.payments || [])[payIndex];
      if (!target) { alert("Payment not found. Please close and reopen."); return; }
      updatedPayments = (liveCustomer.payments || []).filter((_, pi) => pi !== payIndex);
    }

    setCustomers(prev => prev.map(c => c.CellNo === liveCustomer.CellNo ? { ...c, payments: updatedPayments } : c));
    try {
      const dbC = await dbGet("customers", liveCustomer.CellNo);
      if (dbC) await dbPut("customers", { ...dbC, payments: updatedPayments });
    } catch {}
    await safeCallScript({ action: "syncPayments", CellNo: liveCustomer.CellNo.trim(), payments: JSON.stringify(updatedPayments) });
    // Stay open — ledger re-renders immediately with updated data
  };

  const downloadPDF = () => {
    let tableRows = "";
    rows.forEach(r => {
      const pidCell = r.type === "credit" && r.pidLabel ? `<br/><span style="font-size:9px;color:#888">${r.pidLabel}</span>` : "";
      tableRows += `<tr><td>${r.date || "—"}</td><td>${r.desc}${r.billNo ? ` (#${r.billNo})` : ""}${pidCell}</td><td style="color:${r.debit>0?"#c00":"#aaa"};text-align:right">${r.debit>0?`PKR ${r.debit.toLocaleString()}`:"—"}</td><td style="color:${r.credit>0?"#007700":"#aaa"};text-align:right">${r.credit>0?`PKR ${r.credit.toLocaleString()}`:"—"}</td><td style="font-weight:bold;text-align:right;color:${r.balance>0?"#c00":"#007700"}">${r.balance>0?`PKR ${r.balance.toLocaleString()}`:"NIL"}</td></tr>`;
    });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;color:#000;background:#fff;padding:30px}h1{font-size:20px;text-align:center;margin-bottom:4px}.sub{text-align:center;color:#555;font-size:12px;margin-bottom:20px}.info-box{display:flex;gap:20px;margin-bottom:20px;padding:12px 16px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;flex-wrap:wrap}.info-item{display:flex;flex-direction:column;gap:2px}.info-label{color:#777;font-size:10px;text-transform:uppercase;letter-spacing:1px}.info-val{font-weight:bold;font-size:14px}table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#0c1828;color:#fff;padding:8px 10px;text-align:left;font-size:11px;letter-spacing:1px}td{padding:7px 10px;border-bottom:1px solid #eee;font-size:12px}tr:nth-child(even){background:#f7f7f7}.footer{text-align:center;color:#aaa;font-size:10px;margin-top:10px}@media print{body{padding:10px}}</style></head><body>
    <h1>MART — BAKERY & STORES</h1><div class="sub">Customer Account Statement</div>
    <div class="info-box"><div class="info-item"><span class="info-label">Customer</span><span class="info-val">${liveCustomer.Name}</span></div><div class="info-item"><span class="info-label">Cell#</span><span class="info-val">${liveCustomer.CellNo||"—"}</span></div><div class="info-item"><span class="info-label">Total Debit</span><span class="info-val" style="color:#c00">PKR ${totalDebit.toLocaleString()}</span></div><div class="info-item"><span class="info-label">Total Paid</span><span class="info-val" style="color:#007700">PKR ${totalPaid.toLocaleString()}</span></div><div class="info-item"><span class="info-label">Balance Due</span><span class="info-val" style="color:${pending>0?"#c00":"#007700"}">${pending>0?`PKR ${pending.toLocaleString()}`:"CLEAR ✓"}</span></div></div>
    <table><thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Debit (Dr)</th><th style="text-align:right">Credit (Cr)</th><th style="text-align:right">Balance</th></tr></thead><tbody>${tableRows}</tbody></table>
    <div class="footer">Generated by itKINS POS System · itkins.com · 0304-7414437</div><br/></body></html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { alert("Allow popups!"); return; }
    w.document.write(html); w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 450);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0a0e1a", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 24, width: 780, maxWidth: "96vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ color: "#00b4ff", fontSize: 16, fontWeight: 800 }}>{liveCustomer.Name}</div>
            <div style={{ color: "rgba(0,180,255,0.6)", fontSize: 12, fontFamily: "monospace" }}>{liveCustomer.CellNo || "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={downloadPDF} style={{ padding: "7px 14px", background: "linear-gradient(135deg,#b45309,#fbbf24)", color: "#000", fontSize: 12, fontWeight: 700, borderRadius: 7 }}>📄 Print Statement</button>
            <button className="btn" onClick={onClose} style={{ width: 30, height: 30, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", borderRadius: 6, fontSize: 14 }}>✕</button>
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {[
            { label: "Total Debit",  val: `PKR ${fmt(totalDebit)}`,  color: "#ff6b6b" },
            { label: "Total Paid",   val: `PKR ${fmt(totalPaid)}`,   color: "#00e5a0" },
            { label: "Balance Due",  val: pending > 0 ? `PKR ${fmt(pending)}` : "✓ CLEAR", color: pending > 0 ? "#ff6b6b" : "#00e5a0" },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, minWidth: 140, padding: "9px 14px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 9 }}>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10 }}>{s.label}</div>
              <div style={{ color: s.color, fontWeight: 800, fontSize: 15 }}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* Ledger table */}
        <div style={{ flex: 1, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "grid", gridTemplateColumns: "95px 1fr 115px 115px 105px 28px", padding: "8px 14px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
            <div>DATE</div><div>DESCRIPTION</div>
            <div style={{ textAlign: "right" }}>DEBIT (Dr)</div>
            <div style={{ textAlign: "right" }}>CREDIT (Cr)</div>
            <div style={{ textAlign: "right" }}>BALANCE</div>
            <div />
          </div>
          <div style={{ overflowY: "auto", flex: 1, maxHeight: 380 }}>
            {rows.length === 0
              ? <div style={{ textAlign: "center", padding: 30, color: "rgba(255,255,255,0.2)" }}>No transactions found</div>
              : rows.map((r, i) => (
                <div key={r.pid || `row-${i}`}
                  style={{ display: "grid", gridTemplateColumns: "95px 1fr 115px 115px 105px 28px", padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.035)", alignItems: "center", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                  <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{r.date || "—"}</div>
                  <div>
                    <div style={{ color: "#fff", fontSize: 12 }}>
                      {r.desc}
                      {r.billNo && <span style={{ color: "#00b4ff", marginLeft: 5, fontSize: 10 }}>#{r.billNo}</span>}
                    </div>
                    {/* Show Payment ID under description */}
                    {r.type === "credit" && r.pidLabel && (
                      <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, fontFamily: "monospace", marginTop: 2 }}>{r.pidLabel}</div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", color: r.debit > 0 ? "#ff6b6b" : "rgba(255,255,255,0.2)", fontSize: 12, fontWeight: r.debit > 0 ? 700 : 400 }}>{r.debit > 0 ? `PKR ${fmt(r.debit)}` : "—"}</div>
                  <div style={{ textAlign: "right", color: r.credit > 0 ? "#00e5a0" : "rgba(255,255,255,0.2)", fontSize: 12, fontWeight: r.credit > 0 ? 700 : 400 }}>{r.credit > 0 ? `PKR ${fmt(r.credit)}` : "—"}</div>
                  <div style={{ textAlign: "right", color: r.balance > 0 ? "#ff6b6b" : "#00e5a0", fontSize: 13, fontWeight: 800 }}>{r.balance > 0 ? `PKR ${fmt(r.balance)}` : "NIL"}</div>
                  <div>
                    {r.type === "credit" && (
                      <button className="btn" title={`Delete ${r.pidLabel || "payment"}`}
                        onClick={() => deletePayment(r.pid, r.payIndex)}
                        style={{ width: 22, height: 22, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 4, padding: 0 }}>✕</button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
