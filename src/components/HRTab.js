import { useState, useEffect, useCallback } from "react";
import { T, inSt, slSt, lbSt } from "../config";
import { fmt } from "../utils/helpers";

// ── Shared styles (matches AdminTabs2 conventions) ──────────────────────────
const card  = { background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, overflow: "hidden", boxShadow: T.shadow };
const thSt  = { padding: "9px 14px", background: T.bgTopBar, color: "rgba(255,255,255,0.85)", fontSize: 10, letterSpacing: 1.5, fontWeight: 700 };
const btnPrimary = (color = T.accent) => ({
  padding: "9px 16px", background: color, border: "none", color: "#fff",
  borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
});
const btnSecondary = {
  padding: "9px 14px", background: T.bgCardAlt, border: `1px solid ${T.border}`,
  color: T.textSecondary, borderRadius: 7, fontSize: 12, cursor: "pointer",
};

// ── Local-storage key ────────────────────────────────────────────────────────
const HR_KEY = "itkins_hr_data";

function loadHR() {
  try { return JSON.parse(localStorage.getItem(HR_KEY)) || { investments: [], expenses: [], monthlyExpenses: [] }; }
  catch { return { investments: [], expenses: [], monthlyExpenses: [] }; }
}
function saveHR(data) {
  localStorage.setItem(HR_KEY, JSON.stringify(data));
}

// ── Small reusable Summary Card ──────────────────────────────────────────────
function SummaryCard({ icon, label, value, color, bg, border }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 11, padding: "16px 20px", flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ color: T.textMuted, fontSize: 10, letterSpacing: 1.5, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color, fontSize: 17, fontWeight: 800, fontFamily: "Orbitron" }}>{value}</div>
    </div>
  );
}

// ── Modal wrapper ────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: T.bgOverlay, zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: T.bgCard, borderRadius: 14, width: "100%", maxWidth: 440, boxShadow: T.shadowLg, overflow: "hidden" }}>
        <div style={{ ...thSt, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#fff", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Field helper ─────────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={lbSt}>{label}</label>
      {children}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HR TAB
// ═══════════════════════════════════════════════════════════════════════════════
export function HRTab({ sales, items, returns }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [hr, setHR]               = useState(loadHR);
  const [filterFrom, setFrom]     = useState("");
  const [filterTo,   setTo]       = useState("");
  const [filterCat,  setFilterCat]= useState("All");

  // Modals
  const [showInvest,   setInvest]  = useState(false);
  const [showReturn,   setReturn]  = useState(false);
  const [showExpense,  setExpense] = useState(false);
  const [showMonthly,  setMonthly] = useState(false);

  // ── Persist on change ──────────────────────────────────────────────────────
  useEffect(() => { saveHR(hr); }, [hr]);

  // ── Net Profit from Profit tab (read-only mirror) ──────────────────────────
  const itemMap = new Map(items.map(i => [i.Barcode, i]));
  let totalRevenue = 0, totalCost = 0, totalRefund = 0;
  sales.forEach(sale => {
    const si = safeParseItems(sale.ItemsDetail);
    si.forEach(it => {
      const master = itemMap.get(it.Barcode);
      const sell = parseFloat(it.Price || 0), cost = parseFloat(master?.CostPrice || it.CostPrice || 0);
      const disc = parseFloat(it.Discount || 0), qty = parseInt(it.qty) || 1;
      totalRevenue += (sell - disc) * qty;
      totalCost    += cost * qty;
    });
  });
  returns.forEach(r => { totalRefund += parseFloat(r.RefundAmount || 0); });
  const netProfit = totalRevenue - totalRefund - totalCost;

  // ── HR totals with date+category filter ───────────────────────────────────
  const inRange = date => {
    if (!date) return true;
    if (filterFrom && date < filterFrom) return false;
    if (filterTo   && date > filterTo)   return false;
    return true;
  };

  const investments = hr.investments.filter(r => inRange(r.date));
  const expenses    = hr.expenses.filter(r =>
    inRange(r.date) && (filterCat === "All" || r.category === filterCat)
  );

  const totalInvest  = investments.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenses.reduce((s, r) => s + r.amount, 0);
  const returnedAmt  = hr.investments.filter(r => inRange(r.date) && r.returned)
                          .reduce((s, r) => s + (r.returnedAmount || 0), 0);
  const netInvest    = totalInvest - returnedAmt;

  const balance      = netProfit - netInvest - totalExpense;
  const statusColor  = balance > 0 ? T.success : balance < 0 ? T.danger : T.warning;
  const statusBg     = balance > 0 ? T.successLight : balance < 0 ? T.dangerLight : T.warningLight;
  const statusBorder = balance > 0 ? T.successBorder : balance < 0 ? T.dangerBorder : T.warningBorder;
  const statusLabel  = balance > 0 ? "📈 In Profit" : balance < 0 ? "📉 In Loss" : "⚖ Balanced";

  // ── Ledger: merge all HR events, latest first ─────────────────────────────
  const ledger = [
    ...hr.investments.map(r => ({ ...r, _type: r.returned ? "return" : "invest" })),
    ...hr.expenses.map(r => ({ ...r, _type: "expense" })),
  ].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.id > a.id ? 1 : -1));

  // ── Handlers ──────────────────────────────────────────────────────────────
  const addInvestment = (amount, date) => {
    setHR(h => ({ ...h, investments: [...h.investments, { id: uid(), amount, date, returned: false }] }));
  };
  const addReturn = (amount, date) => {
    // Mark as a separate "return" investment entry
    setHR(h => ({ ...h, investments: [...h.investments, { id: uid(), amount, date, returned: true, returnedAmount: amount }] }));
  };
  const addExpense = (name, category, amount, date) => {
    setHR(h => ({ ...h, expenses: [...h.expenses, { id: uid(), name, category, amount, date }] }));
  };
  const saveMonthlyExpenses = (items) => {
    setHR(h => ({ ...h, monthlyExpenses: items }));
  };

  // ── Expense categories ─────────────────────────────────────────────────────
  const EXP_CATS = ["Salary", "Personal", "Bill", "Other"];

  return (
    <div>
      {/* ── Summary Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
        <SummaryCard icon="📈" label="Net Profit"  value={`PKR ${fmt(netProfit)}`}
          color={netProfit >= 0 ? T.success : T.danger}
          bg={netProfit >= 0 ? T.successLight : T.dangerLight}
          border={netProfit >= 0 ? T.successBorder : T.dangerBorder} />
        <SummaryCard icon="💼" label="Investment"  value={`PKR ${fmt(netInvest)}`}
          color={T.accent} bg={T.accentLight} border={T.accentBorder} />
        <SummaryCard icon="💸" label="Expenses"    value={`PKR ${fmt(totalExpense)}`}
          color={T.danger} bg={T.dangerLight} border={T.dangerBorder} />
        <div style={{ background: statusBg, border: `1px solid ${statusBorder}`, borderRadius: 11, padding: "16px 20px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>📊</div>
          <div style={{ color: T.textMuted, fontSize: 10, letterSpacing: 1.5, marginBottom: 4, textTransform: "uppercase" }}>Status</div>
          <div style={{ color: statusColor, fontSize: 14, fontWeight: 800, fontFamily: "Orbitron" }}>{statusLabel}</div>
          <div style={{ color: statusColor, fontSize: 11, marginTop: 4, fontWeight: 600 }}>PKR {fmt(Math.abs(balance))}</div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <label style={lbSt}>From Date</label>
          <input type="date" value={filterFrom} onChange={e => setFrom(e.target.value)} style={{ ...inSt, maxWidth: 170, background: T.bgCard }} />
        </div>
        <div>
          <label style={lbSt}>To Date</label>
          <input type="date" value={filterTo} onChange={e => setTo(e.target.value)} style={{ ...inSt, maxWidth: 170, background: T.bgCard }} />
        </div>
        <div>
          <label style={lbSt}>Category</label>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...slSt, background: T.bgCard }}>
            <option value="All">All</option>
            {EXP_CATS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <button style={btnSecondary} onClick={() => { setFrom(""); setTo(""); setFilterCat("All"); }}>Clear</button>
      </div>

      {/* ── Action Buttons ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
        <button style={btnPrimary(T.accent)}   onClick={() => setInvest(true)}>💼 Investment</button>
        <button style={btnPrimary(T.danger)}   onClick={() => setExpense(true)}>💸 Add Expense</button>
        <button style={btnPrimary(T.posOrange)}onClick={() => setReturn(true)}>↩ Return Investment</button>
        <button style={btnPrimary("#7c3aed")}  onClick={() => setMonthly(true)}>📋 Monthly Expense</button>
      </div>

      {/* ── Ledger ── */}
      <div style={card}>
        <div style={thSt}>LEDGER — LATEST FIRST</div>
        {ledger.length === 0
          ? <div style={{ padding: 24, color: T.textMuted, textAlign: "center", fontSize: 13 }}>No entries yet. Add an investment or expense to get started.</div>
          : ledger.map((row, i) => <LedgerRow key={row.id + i} row={row} />)
        }
      </div>

      {/* ── Modals ── */}
      {showInvest  && <InvestModal  onClose={() => setInvest(false)}  onSave={addInvestment} />}
      {showReturn  && <ReturnModal  onClose={() => setReturn(false)}  onSave={addReturn} />}
      {showExpense && <ExpenseModal onClose={() => setExpense(false)} onSave={addExpense} cats={EXP_CATS} />}
      {showMonthly && <MonthlyModal onClose={() => setMonthly(false)} initial={hr.monthlyExpenses} onSave={saveMonthlyExpenses} />}
    </div>
  );
}

// ── Ledger Row ────────────────────────────────────────────────────────────────
function LedgerRow({ row }) {
  const isInvest  = row._type === "invest";
  const isReturn  = row._type === "return";
  const isExpense = row._type === "expense";

  const color  = isInvest ? T.accent : isReturn ? T.posOrange : T.danger;
  const bg     = isInvest ? T.accentLight : isReturn ? "#fff7ed" : T.dangerLight;
  const label  = isInvest ? "Investment" : isReturn ? "Return" : `Expense · ${row.category}`;
  const sign   = isInvest ? "+" : "−";
  const icon   = isInvest ? "💼" : isReturn ? "↩" : "💸";

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${T.borderLight}`, background: bg + "44" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>{isExpense ? row.name : label}</div>
          <div style={{ color: T.textMuted, fontSize: 10 }}>{row.date} {isExpense ? `· ${label}` : ""}</div>
        </div>
      </div>
      <div style={{ color, fontWeight: 800, fontFamily: "Orbitron", fontSize: 13 }}>{sign} PKR {fmt(row.amount)}</div>
    </div>
  );
}

// ── Investment Modal ──────────────────────────────────────────────────────────
function InvestModal({ onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [date,   setDate]   = useState(today());
  const submit = () => {
    const a = parseFloat(amount);
    if (!a || a <= 0) return alert("Enter a valid amount.");
    onSave(a, date); onClose();
  };
  return (
    <Modal title="💼 ADD INVESTMENT" onClose={onClose}>
      <Field label="Amount (PKR)">
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inSt} placeholder="0.00" min="0" />
      </Field>
      <Field label="Date">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inSt} />
      </Field>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button style={{ ...btnPrimary(T.accent), flex: 1 }} onClick={submit}>✔ Add</button>
        <button style={{ ...btnSecondary, flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Return Investment Modal ───────────────────────────────────────────────────
function ReturnModal({ onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [date,   setDate]   = useState(today());
  const submit = () => {
    const a = parseFloat(amount);
    if (!a || a <= 0) return alert("Enter a valid amount.");
    onSave(a, date); onClose();
  };
  return (
    <Modal title="↩ RETURN INVESTMENT" onClose={onClose}>
      <Field label="Return Amount (PKR)">
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inSt} placeholder="0.00" min="0" />
      </Field>
      <Field label="Date">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inSt} />
      </Field>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button style={{ ...btnPrimary(T.posOrange), flex: 1 }} onClick={submit}>↩ Return</button>
        <button style={{ ...btnSecondary, flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Add Expense Modal ─────────────────────────────────────────────────────────
function ExpenseModal({ onClose, onSave, cats }) {
  const [name,     setName]     = useState("");
  const [category, setCategory] = useState("Salary");
  const [amount,   setAmount]   = useState("");
  const [date,     setDate]     = useState(today());
  const submit = () => {
    if (!name.trim()) return alert("Enter expense name.");
    const a = parseFloat(amount);
    if (!a || a <= 0) return alert("Enter a valid amount.");
    onSave(name.trim(), category, a, date); onClose();
  };
  return (
    <Modal title="💸 ADD EXPENSE" onClose={onClose}>
      <Field label="Name">
        <input type="text" value={name} onChange={e => setName(e.target.value)} style={inSt} placeholder="e.g. Ahmad Salary" />
      </Field>
      <Field label="Category">
        <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...slSt, width: "100%" }}>
          {cats.map(c => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Amount (PKR)">
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inSt} placeholder="0.00" min="0" />
      </Field>
      <Field label="Date">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inSt} />
      </Field>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button style={{ ...btnPrimary(T.danger), flex: 1 }} onClick={submit}>💾 Save</button>
        <button style={{ ...btnSecondary, flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Monthly Expense Modal ─────────────────────────────────────────────────────
function MonthlyModal({ onClose, onSave, initial }) {
  const [items, setItems] = useState(
    initial?.length ? initial : [{ id: uid(), name: "", amount: "" }]
  );

  const update = (id, field, val) =>
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: val } : it));
  const addRow  = () => setItems(prev => [...prev, { id: uid(), name: "", amount: "" }]);
  const delRow  = id  => setItems(prev => prev.filter(it => it.id !== id));

  const totalItems  = items.length;
  const totalAmount = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);

  const submit = () => {
    const cleaned = items.filter(it => it.name.trim() || parseFloat(it.amount));
    onSave(cleaned); onClose();
  };

  return (
    <Modal title="📋 MONTHLY EXPENSE NOTE" onClose={onClose}>
      <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 12 }}>
        {items.map((it, idx) => (
          <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: T.textMuted, fontSize: 12, minWidth: 20, fontWeight: 700 }}>{idx + 1}.</span>
            <input
              type="text"
              value={it.name}
              onChange={e => update(it.id, "name", e.target.value)}
              style={{ ...inSt, flex: 2 }}
              placeholder="Item / note"
            />
            <input
              type="number"
              value={it.amount}
              onChange={e => update(it.id, "amount", e.target.value)}
              style={{ ...inSt, flex: 1 }}
              placeholder="PKR"
              min="0"
            />
            <button onClick={() => delRow(it.id)}
              style={{ background: T.dangerLight, border: `1px solid ${T.dangerBorder}`, color: T.danger, borderRadius: 6, width: 30, height: 30, cursor: "pointer", fontSize: 16, lineHeight: "1", flexShrink: 0 }}>
              −
            </button>
          </div>
        ))}
        <button onClick={addRow} style={{ ...btnSecondary, width: "100%", marginTop: 4 }}>+ Add Item</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: `1px solid ${T.border}`, marginBottom: 12 }}>
        <span style={{ color: T.textSecondary, fontSize: 12 }}>Total Items: <strong>{totalItems}</strong></span>
        <span style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800, fontFamily: "Orbitron" }}>PKR {fmt(totalAmount)}</span>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button style={{ ...btnPrimary("#7c3aed"), flex: 1 }} onClick={submit}>💾 Save</button>
        <button style={{ ...btnSecondary, flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Inline helpers (avoid extra import) ──────────────────────────────────────
function safeParseItems(raw) {
  if (!raw) return [];
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}
