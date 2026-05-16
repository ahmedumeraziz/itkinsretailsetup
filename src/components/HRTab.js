import { useState, useEffect, useCallback } from "react";
import { T, inSt, slSt, lbSt } from "../config";
import { fmt } from "../utils/helpers";
import { SHEET_URLS } from "../config";

// ── Shared styles ─────────────────────────────────────────────────────────────
const card   = { background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, overflow: "hidden", boxShadow: T.shadow };
const thSt   = { padding: "9px 14px", background: T.bgTopBar, color: "rgba(255,255,255,0.85)", fontSize: 10, letterSpacing: 1.5, fontWeight: 700 };
const btnPri = (color = T.accent) => ({ padding: "9px 16px", background: color, border: "none", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer" });
const btnSec = { padding: "9px 14px", background: T.bgCardAlt, border: `1px solid ${T.border}`, color: T.textSecondary, borderRadius: 7, fontSize: 12, cursor: "pointer" };

const EXP_CATS = ["Salary", "Personal", "Bill", "Other"];
const today    = () => new Date().toISOString().slice(0, 10);
const uid      = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeParseItems(raw) {
  if (!raw) return [];
  try { const p = typeof raw === "string" ? JSON.parse(raw) : raw; return Array.isArray(p) ? p : []; }
  catch { return []; }
}

function parseCsvLine(line) {
  const result = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { result.push(cur); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur); return result;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SummaryCard({ icon, label, value, color, bg, border, sub }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 11, padding: "16px 20px", flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ color: T.textMuted, fontSize: 10, letterSpacing: 1.5, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color, fontSize: 17, fontWeight: 800, fontFamily: "Orbitron" }}>{value}</div>
      {sub && <div style={{ color, fontSize: 11, marginTop: 4, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

function Modal({ title, onClose, children, maxWidth = 440 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: T.bgOverlay, zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: T.bgCard, borderRadius: 14, width: "100%", maxWidth, boxShadow: T.shadowLg, overflow: "hidden" }}>
        <div style={{ ...thSt, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={lbSt}>{label}</label>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN HR TAB
// ═══════════════════════════════════════════════════════════════════════════════
export function HRTab({ sales, items, returns, safeCallScript }) {
  const [hrRows,        setHrRows]   = useState([]);
  const [monthlyItems,  setMonthly_] = useState([]);
  const [loading,       setLoading]  = useState(false);
  const [saving,        setSaving]   = useState(false);

  const [filterFrom, setFrom]    = useState("");
  const [filterTo,   setTo]      = useState("");
  const [filterCat,  setFCat]    = useState("All");

  const [showInvest,  setInvest]  = useState(false);
  const [showReturn,  setReturn_] = useState(false);
  const [showExpense, setExpense] = useState(false);
  const [showMonthly, setMonthly] = useState(false);

  // ── Load HR from Sheet ─────────────────────────────────────────────────────
  const loadHR = useCallback(async () => {
    setLoading(true);
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(SHEET_URLS.hr + "&t=" + Date.now(), { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) { setLoading(false); return; }
      const text = await res.text();
      const lines = text.trim().split("\n").filter(Boolean);
      if (lines.length < 2) { setLoading(false); return; }
      const headers = lines[0].split(",").map(h => h.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim());
      const rows = lines.slice(1).map(line => {
        const vals = parseCsvLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (vals[i] || "").replace(/^"|"$/g, "").trim(); });
        return obj;
      });
      // Latest monthly note
      const latestMonthly = [...rows].reverse().find(r => r.Type === "monthly");
      if (latestMonthly?.Note) {
        try { setMonthly_(JSON.parse(latestMonthly.Note)); } catch { setMonthly_([]); }
      }
      setHrRows(rows);
    } catch (e) { console.warn("HR load failed:", e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { loadHR(); }, [loadHR]);

  // ── Net Profit (read from sales/items/returns — same as ProfitTab) ─────────
  const itemMap = new Map(items.map(i => [i.Barcode, i]));
  let rev = 0, cost = 0, refund = 0;
  sales.forEach(s => {
    safeParseItems(s.ItemsDetail).forEach(it => {
      const m = itemMap.get(it.Barcode);
      const sell = parseFloat(it.Price || 0), c = parseFloat(m?.CostPrice || it.CostPrice || 0);
      const disc = parseFloat(it.Discount || 0), qty = parseInt(it.qty) || 1;
      rev  += (sell - disc) * qty;
      cost += c * qty;
    });
  });
  returns.forEach(r => { refund += parseFloat(r.RefundAmount || 0); });
  const netProfit = rev - refund - cost;

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const inRange = d => {
    if (!d) return true;
    if (filterFrom && d < filterFrom) return false;
    if (filterTo   && d > filterTo)   return false;
    return true;
  };

  const filtered = hrRows.filter(r => {
    if (r.Type === "monthly") return false;
    if (!inRange(r.Date)) return false;
    if (filterCat !== "All" && r.Type === "expense" && r.Category !== filterCat) return false;
    return true;
  });

  const totalInvest  = filtered.filter(r => r.Type === "investment").reduce((s, r) => s + parseFloat(r.Amount || 0), 0);
  const totalReturns = filtered.filter(r => r.Type === "return").reduce((s, r) => s + parseFloat(r.Amount || 0), 0);
  const totalExpense = filtered.filter(r => r.Type === "expense").reduce((s, r) => s + parseFloat(r.Amount || 0), 0);
  const netInvest    = totalInvest - totalReturns;
  const balance      = netProfit - netInvest - totalExpense;

  const statusColor  = balance > 0 ? T.success : balance < 0 ? T.danger : T.warning;
  const statusBg     = balance > 0 ? T.successLight : balance < 0 ? T.dangerLight : T.warningLight;
  const statusBorder = balance > 0 ? T.successBorder : balance < 0 ? T.dangerBorder : T.warningBorder;
  const statusLabel  = balance > 0 ? "📈 In Profit" : balance < 0 ? "📉 In Loss" : "⚖ Balanced";

  const ledger = [...filtered].sort((a, b) => b.Date > a.Date ? 1 : b.Date < a.Date ? -1 : 0);

  // ── Save a row to Google Sheet ─────────────────────────────────────────────
  const saveRow = async (row) => {
    setSaving(true);
    await safeCallScript({
      action:   "saveHREntry",
      id:       row.id,
      type:     row.type,
      name:     row.name,
      category: row.category || "",
      amount:   row.amount,
      date:     row.date,
      note:     row.note || "",
    });
    await loadHR();
    setSaving(false);
  };

  const addInvestment = (amount, date, note)          => saveRow({ id: uid(), type: "investment", name: "Investment",        category: "",       amount, date, note });
  const addReturn     = (amount, date, note)          => saveRow({ id: uid(), type: "return",     name: "Return Investment", category: "",       amount, date, note });
  const addExpense    = (name, category, amount, date) => saveRow({ id: uid(), type: "expense",   name,                      category,           amount, date, note: "" });
  const saveMonthly   = (mitems) => {
    setMonthly_(mitems);
    const total = mitems.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
    saveRow({ id: uid(), type: "monthly", name: "Monthly Expense Note", category: "", amount: total, date: today(), note: JSON.stringify(mitems) });
  };

  return (
    <div>
      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
        <SummaryCard icon="📈" label="Net Profit" value={`PKR ${fmt(netProfit)}`}
          color={netProfit >= 0 ? T.success : T.danger}
          bg={netProfit >= 0 ? T.successLight : T.dangerLight}
          border={netProfit >= 0 ? T.successBorder : T.dangerBorder} />
        <SummaryCard icon="💼" label="Investment (Net)" value={`PKR ${fmt(netInvest)}`}
          sub={totalReturns > 0 ? `↩ Returned: PKR ${fmt(totalReturns)}` : null}
          color={T.accent} bg={T.accentLight} border={T.accentBorder} />
        <SummaryCard icon="💸" label="Expenses" value={`PKR ${fmt(totalExpense)}`}
          color={T.danger} bg={T.dangerLight} border={T.dangerBorder} />
        <div style={{ background: statusBg, border: `1px solid ${statusBorder}`, borderRadius: 11, padding: "16px 20px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>📊</div>
          <div style={{ color: T.textMuted, fontSize: 10, letterSpacing: 1.5, marginBottom: 4, textTransform: "uppercase" }}>Status</div>
          <div style={{ color: statusColor, fontSize: 14, fontWeight: 800, fontFamily: "Orbitron" }}>{statusLabel}</div>
          <div style={{ color: statusColor, fontSize: 11, marginTop: 4, fontWeight: 600 }}>PKR {fmt(Math.abs(balance))}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <div><label style={lbSt}>From Date</label>
          <input type="date" value={filterFrom} onChange={e => setFrom(e.target.value)} style={{ ...inSt, maxWidth: 170, background: T.bgCard }} /></div>
        <div><label style={lbSt}>To Date</label>
          <input type="date" value={filterTo} onChange={e => setTo(e.target.value)} style={{ ...inSt, maxWidth: 170, background: T.bgCard }} /></div>
        <div><label style={lbSt}>Category</label>
          <select value={filterCat} onChange={e => setFCat(e.target.value)} style={{ ...slSt, background: T.bgCard }}>
            <option value="All">All</option>
            {EXP_CATS.map(c => <option key={c}>{c}</option>)}
          </select></div>
        <button style={btnSec} onClick={() => { setFrom(""); setTo(""); setFCat("All"); }}>Clear</button>
        <button style={{ ...btnSec, marginLeft: "auto" }} onClick={loadHR} disabled={loading}>
          {loading ? "⟳ Loading…" : "⟳ Refresh"}
        </button>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22, alignItems: "center" }}>
        <button className="btn" style={btnPri(T.accent)}    onClick={() => setInvest(true)}  disabled={saving}>💼 Investment</button>
        <button className="btn" style={btnPri(T.danger)}    onClick={() => setExpense(true)} disabled={saving}>💸 Add Expense</button>
        <button className="btn" style={btnPri(T.posOrange)} onClick={() => setReturn_(true)} disabled={saving}>↩ Return Investment</button>
        <button className="btn" style={btnPri("#7c3aed")}   onClick={() => setMonthly(true)} disabled={saving}>📋 Monthly Expense</button>
        {saving && <span style={{ color: T.textMuted, fontSize: 12 }}>⟳ Saving to Sheet…</span>}
      </div>

      {/* Ledger */}
      <div style={card}>
        <div style={{ ...thSt, display: "flex", justifyContent: "space-between" }}>
          <span>LEDGER — LATEST FIRST</span>
          <span style={{ opacity: 0.7 }}>{ledger.length} entries</span>
        </div>
        {loading
          ? <div style={{ padding: 24, color: T.textMuted, textAlign: "center" }}>⟳ Loading from Google Sheet…</div>
          : ledger.length === 0
            ? <div style={{ padding: 24, color: T.textMuted, textAlign: "center", fontSize: 13 }}>No entries yet. Use the buttons above to add investments or expenses.</div>
            : ledger.map((row, i) => <LedgerRow key={row.ID || i} row={row} />)
        }
      </div>

      {/* Modals */}
      {showInvest  && <InvestModal  onClose={() => setInvest(false)}  onSave={addInvestment} />}
      {showReturn  && <ReturnModal  onClose={() => setReturn_(false)} onSave={addReturn} />}
      {showExpense && <ExpenseModal onClose={() => setExpense(false)} onSave={addExpense} />}
      {showMonthly && <MonthlyModal onClose={() => setMonthly(false)} initial={monthlyItems} onSave={saveMonthly} />}
    </div>
  );
}

// ── Ledger Row ────────────────────────────────────────────────────────────────
function LedgerRow({ row }) {
  const t = row.Type;
  const isI = t === "investment", isR = t === "return", isE = t === "expense";
  const color = isI ? T.accent : isR ? T.posOrange : T.danger;
  const bg    = isI ? T.accentLight : isR ? "#fff7ed" : T.dangerLight;
  const icon  = isI ? "💼" : isR ? "↩" : "💸";
  const sign  = isI ? "+" : "−";
  const sub   = isE ? row.Category : isR ? "Return" : "Investment";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${T.borderLight}`, background: bg + "55" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 700 }}>{row.Name || t}</div>
          <div style={{ color: T.textMuted, fontSize: 10 }}>{row.Date}{sub ? ` · ${sub}` : ""}</div>
        </div>
      </div>
      <div style={{ color, fontWeight: 800, fontFamily: "Orbitron", fontSize: 13 }}>{sign} PKR {fmt(parseFloat(row.Amount || 0))}</div>
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────
function InvestModal({ onClose, onSave }) {
  const [amount, setAmount] = useState(""); const [date, setDate] = useState(today()); const [note, setNote] = useState("");
  const submit = () => { const a = parseFloat(amount); if (!a || a <= 0) return alert("Enter a valid amount."); onSave(a, date, note); onClose(); };
  return (
    <Modal title="💼 ADD INVESTMENT" onClose={onClose}>
      <Field label="Amount (PKR)"><input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inSt} placeholder="0.00" min="0" /></Field>
      <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inSt} /></Field>
      <Field label="Note (optional)"><input type="text" value={note} onChange={e => setNote(e.target.value)} style={inSt} placeholder="e.g. Capital injection" /></Field>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button className="btn" style={{ ...btnPri(T.accent), flex: 1 }} onClick={submit}>✔ Add</button>
        <button className="btn" style={{ ...btnSec, flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function ReturnModal({ onClose, onSave }) {
  const [amount, setAmount] = useState(""); const [date, setDate] = useState(today()); const [note, setNote] = useState("");
  const submit = () => { const a = parseFloat(amount); if (!a || a <= 0) return alert("Enter a valid amount."); onSave(a, date, note); onClose(); };
  return (
    <Modal title="↩ RETURN INVESTMENT" onClose={onClose}>
      <Field label="Return Amount (PKR)"><input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inSt} placeholder="0.00" min="0" /></Field>
      <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inSt} /></Field>
      <Field label="Note (optional)"><input type="text" value={note} onChange={e => setNote(e.target.value)} style={inSt} placeholder="e.g. Partial withdrawal" /></Field>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button className="btn" style={{ ...btnPri(T.posOrange), flex: 1 }} onClick={submit}>↩ Return</button>
        <button className="btn" style={{ ...btnSec, flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function ExpenseModal({ onClose, onSave }) {
  const [name, setName] = useState(""); const [category, setCategory] = useState("Salary"); const [amount, setAmount] = useState(""); const [date, setDate] = useState(today());
  const submit = () => { if (!name.trim()) return alert("Enter expense name."); const a = parseFloat(amount); if (!a || a <= 0) return alert("Enter a valid amount."); onSave(name.trim(), category, a, date); onClose(); };
  return (
    <Modal title="💸 ADD EXPENSE" onClose={onClose}>
      <Field label="Name"><input type="text" value={name} onChange={e => setName(e.target.value)} style={inSt} placeholder="e.g. Ahmad Salary" /></Field>
      <Field label="Category">
        <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...slSt, width: "100%" }}>
          {EXP_CATS.map(c => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Amount (PKR)"><input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inSt} placeholder="0.00" min="0" /></Field>
      <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inSt} /></Field>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button className="btn" style={{ ...btnPri(T.danger), flex: 1 }} onClick={submit}>💾 Save</button>
        <button className="btn" style={{ ...btnSec, flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function MonthlyModal({ onClose, onSave, initial }) {
  const [items, setItems] = useState(initial?.length ? initial : [{ id: uid(), name: "", amount: "" }]);
  const update = (id, f, v) => setItems(p => p.map(it => it.id === id ? { ...it, [f]: v } : it));
  const addRow = () => setItems(p => [...p, { id: uid(), name: "", amount: "" }]);
  const delRow = id => setItems(p => p.filter(it => it.id !== id));
  const total  = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
  const submit = () => { onSave(items.filter(it => it.name.trim() || parseFloat(it.amount))); onClose(); };
  return (
    <Modal title="📋 MONTHLY EXPENSE NOTE" onClose={onClose} maxWidth={520}>
      <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: 12 }}>
        {items.map((it, idx) => (
          <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: T.textMuted, fontSize: 12, minWidth: 22, fontWeight: 700 }}>{idx + 1}.</span>
            <input type="text"   value={it.name}   onChange={e => update(it.id, "name",   e.target.value)} style={{ ...inSt, flex: 2 }} placeholder="Item description" />
            <input type="number" value={it.amount} onChange={e => update(it.id, "amount", e.target.value)} style={{ ...inSt, flex: 1 }} placeholder="PKR" min="0" />
            <button onClick={() => delRow(it.id)} style={{ background: T.dangerLight, border: `1px solid ${T.dangerBorder}`, color: T.danger, borderRadius: 6, width: 30, height: 30, cursor: "pointer", fontSize: 18, lineHeight: "1", flexShrink: 0 }}>−</button>
          </div>
        ))}
        <button onClick={addRow} style={{ ...btnSec, width: "100%", marginTop: 4 }}>+ Add Item</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: `1px solid ${T.border}`, marginBottom: 12 }}>
        <span style={{ color: T.textSecondary, fontSize: 12 }}>Total Items: <strong>{items.length}</strong></span>
        <span style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800, fontFamily: "Orbitron" }}>PKR {fmt(total)}</span>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn" style={{ ...btnPri("#7c3aed"), flex: 1 }} onClick={submit}>💾 Save to Sheet</button>
        <button className="btn" style={{ ...btnSec, flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
