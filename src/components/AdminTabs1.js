import { useState } from "react";
import { inSt, slSt, lbSt } from "../config";
import { fmt, getExpiryStatus, fmtExpiry } from "../utils/helpers";
import { dbPut, dbDelete } from "../utils/db";

// ── ITEMS TAB ─────────────────────────────────────────────────────────────────
export function ItemsTab({ items, setItems, categories, safeCallScript }) {
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState({ Barcode: "", Category: "", Company: "", ItemName: "", Price: "", CostPrice: "", Discount: "0", Stock: "" });
  const [search,    setSearch]    = useState(""); const [filterCat, setFilterCat] = useState("All"); const [filterCo, setFilterCo] = useState("All");
  const companies = [...new Set(items.map(i => i.Company || "").filter(Boolean))].sort();
  const filtered  = items.filter(i => (filterCat === "All" || i.Category === filterCat) && (filterCo === "All" || i.Company === filterCo) && (!search || i.ItemName?.toLowerCase().includes(search.toLowerCase()) || i.Barcode?.includes(search)));
  const startAdd  = () => { setEditing("new"); setForm({ Barcode: "", Category: categories[0] || "", Company: "", ItemName: "", Price: "", CostPrice: "", Discount: "0", Stock: "" }); };
  const startEdit = item => { setEditing(item.Barcode); setForm({ ...item }); };
  const save = async () => {
    if (!form.Barcode || !form.ItemName || !form.Price) return;
    if (editing === "new") setItems(p => [...p, form]); else setItems(p => p.map(i => i.Barcode === editing ? form : i));
    try { await dbPut("items", { ...form, id: form.Barcode }); } catch (e) {}
    safeCallScript({ action: editing === "new" ? "addItem" : "editItem", ...form }); setEditing(null);
  };
  const del = async bc => {
    if (window.confirm("Delete this item?")) {
      setItems(p => p.filter(i => i.Barcode !== bc));
      try { await dbDelete("items", bc); } catch (e) {}
      safeCallScript({ action: "deleteItem", Barcode: bc });
    }
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 9, marginBottom: 13, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..." style={{ ...inSt, maxWidth: 200 }} />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={slSt}><option value="All">All Categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <select value={filterCo}  onChange={e => setFilterCo(e.target.value)}  style={slSt}><option value="All">All Companies</option>{companies.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <button className="btn" onClick={startAdd} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, borderRadius: 7 }}>+ Add Item</button>
        <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, marginLeft: "auto" }}>{filtered.length} items</span>
      </div>
      {editing && (
        <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.17)", borderRadius: 11, padding: 18, marginBottom: 16 }}>
          <div style={{ color: "#00b4ff", fontSize: 11, letterSpacing: 2, marginBottom: 13, fontWeight: 700 }}>{editing === "new" ? "➕ ADD NEW ITEM" : "✏️ EDIT ITEM"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 11 }}>
            {[["Barcode","Barcode","text"],["ItemName","Item Name","text"],["Company","Company","text"],["Price","Selling Price (PKR)","number"],["CostPrice","Cost Price (PKR)","number"],["Discount","Item Discount (PKR)","number"],["Stock","Stock Qty","number"]].map(([k,l,t]) => (
              <div key={k}><label style={lbSt}>{l}</label><input type={t} value={form[k] || ""} onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} style={inSt} /></div>
            ))}
            <div>
              <label style={lbSt}>EXPIRY DATE</label>
              <input type="date" value={form.ExpiryDate || ""} onChange={e => setForm(p => ({ ...p, ExpiryDate: e.target.value }))}
                style={{ ...inSt, border: form.ExpiryDate ? `1px solid ${getExpiryStatus(form.ExpiryDate).color}` : "1px solid rgba(0,180,255,0.22)", colorScheme: "dark" }} />
              {form.ExpiryDate && (() => { const es = getExpiryStatus(form.ExpiryDate); return (
                <div style={{ marginTop: 5, fontSize: 11, color: es.color, fontWeight: 600 }}>{es.status === "expired" ? "⛔" : es.status === "critical" || es.status === "today" ? "⚠️" : "✅"} {es.label}</div>
              ); })()}
            </div>
            <div><label style={lbSt}>Category</label><select value={form.Category} onChange={e => setForm(p => ({ ...p, Category: e.target.value }))} style={slSt}>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          {form.Price && form.CostPrice && parseFloat(form.Price) > 0 && (
            <div style={{ marginTop: 10, padding: "8px 13px", background: "rgba(0,200,100,0.07)", border: "1px solid rgba(0,200,100,0.2)", borderRadius: 7, fontSize: 11, color: "#00e5a0" }}>
              Profit per unit: PKR {fmt(parseFloat(form.Price) - parseFloat(form.CostPrice))} · Margin: {((parseFloat(form.Price) - parseFloat(form.CostPrice)) / parseFloat(form.Price) * 100).toFixed(1)}%
            </div>
          )}
          <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
            <button className="btn" onClick={save} style={{ padding: "9px 20px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontWeight: 700, borderRadius: 7 }}>✓ Save</button>
            <button className="btn" onClick={() => setEditing(null)} style={{ padding: "9px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)", borderRadius: 7 }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 100px 100px 75px 70px 70px 70px 100px 90px", padding: "8px 12px", background: "rgba(0,180,255,0.07)", color: "rgba(0,180,255,0.72)", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>
          <div>BARCODE</div><div>ITEM NAME</div><div>CATEGORY</div><div>COMPANY</div><div style={{ textAlign: "right" }}>PRICE</div><div style={{ textAlign: "right" }}>COST</div><div style={{ textAlign: "right" }}>DISC</div><div style={{ textAlign: "right" }}>STOCK</div><div style={{ textAlign: "center" }}>EXPIRY</div><div style={{ textAlign: "center" }}>ACTIONS</div>
        </div>
        {filtered.map((item, idx) => {
          const stk = Number(item.Stock) || 0;
          const profit = parseFloat(item.Price || 0) - parseFloat(item.CostPrice || 0);
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "110px 1fr 100px 100px 75px 70px 70px 70px 100px 90px", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", background: stk <= 0 ? "rgba(255,50,50,0.03)" : stk <= 5 ? "rgba(255,200,0,0.03)" : "transparent" }}>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{item.Barcode}</div>
              <div style={{ color: "#fff", fontSize: 12, fontWeight: 500 }}>{item.ItemName}</div>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{item.Category}</div>
              <div style={{ color: "rgba(0,180,255,0.7)", fontSize: 11 }}>{item.Company || "—"}</div>
              <div style={{ color: "#00b4ff", textAlign: "right", fontWeight: 700, fontSize: 12 }}>{fmt(item.Price)}</div>
              <div style={{ color: profit > 0 ? "#00e5a0" : "rgba(255,255,255,0.3)", textAlign: "right", fontSize: 11 }} title={`Profit: PKR ${fmt(profit)}`}>{item.CostPrice ? fmt(item.CostPrice) : "—"}</div>
              <div style={{ color: parseFloat(item.Discount) > 0 ? "#ffd700" : "rgba(255,255,255,0.22)", textAlign: "right", fontSize: 12 }}>{item.Discount}</div>
              <div style={{ textAlign: "right", fontWeight: 700, fontSize: 12, color: stk <= 0 ? "#ff6b6b" : stk <= 5 ? "#ffd700" : "#00e5a0" }}>{item.Stock}{stk <= 0 ? " ❌" : stk <= 5 ? " ⚠️" : ""}</div>
              {(() => { const es = getExpiryStatus(item.ExpiryDate); return (
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: es.color, fontSize: 10, fontWeight: 700 }}>{fmtExpiry(item.ExpiryDate)}</div>
                  {item.ExpiryDate && <div style={{ fontSize: 9, color: es.color, opacity: 0.85 }}>{es.label}</div>}
                </div>
              ); })()}
              <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                <button className="btn" onClick={() => startEdit(item)} style={{ padding: "4px 9px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 11, borderRadius: 5 }}>Edit</button>
                <button className="btn" onClick={() => del(item.Barcode)} style={{ padding: "4px 9px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 5 }}>Del</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── CATEGORIES TAB ────────────────────────────────────────────────────────────
export function CategoriesTab({ categories, setCategories, items, safeCallScript }) {
  const [val, setVal] = useState("");
  const add = () => { const v = val.trim(); if (v && !categories.includes(v)) { setCategories(p => [...p, v]); safeCallScript({ action: "addCategory", CategoryName: v }); setVal(""); } };
  const del = cat => { if (items.some(i => i.Category === cat)) { alert(`"${cat}" used by items.`); return; } if (window.confirm(`Delete "${cat}"?`)) { setCategories(p => p.filter(c => c !== cat)); safeCallScript({ action: "deleteCategory", CategoryName: cat }); } };
  return (
    <div style={{ maxWidth: 460 }}>
      <div style={{ display: "flex", gap: 9, marginBottom: 16 }}>
        <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="New category name..." style={inSt} />
        <button className="btn" onClick={add} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, borderRadius: 7, whiteSpace: "nowrap" }}>+ Add</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {categories.map(cat => { const cnt = items.filter(i => i.Category === cat).length; return (
          <div key={cat} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 15px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}>
            <div><span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{cat}</span><span style={{ color: "rgba(255,255,255,0.26)", fontSize: 11, marginLeft: 9 }}>{cnt} items</span></div>
            <button className="btn" onClick={() => del(cat)} style={{ padding: "5px 11px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 6 }}>Delete</button>
          </div>
        ); })}
      </div>
    </div>
  );
}

// ── CASHIERS TAB ──────────────────────────────────────────────────────────────
export function CashiersTab({ cashiers, setCashiers, safeCallScript }) {
  const [editing, setEditing] = useState(null); const [origUsername, setOrigUsername] = useState(""); const [form, setForm] = useState({ Name: "", Username: "", PIN: "", Role: "cashier" });
  const startAdd  = () => { setEditing("__new__"); setOrigUsername(""); setForm({ Name: "", Username: "", PIN: "", Role: "cashier" }); };
  const startEdit = c => { setEditing(c.Username); setOrigUsername(c.Username); setForm({ ...c }); };
  const save = async () => {
    if (!form.Name || !form.Username || !form.PIN) return;
    if (editing === "__new__") {
      setCashiers(p => [...p, form]);
      try { await dbPut("cashiers", { ...form, id: form.Username }); } catch(e) {}
      safeCallScript({ action: "addCashier", Name: form.Name, Username: form.Username, PIN: form.PIN, Role: form.Role });
    } else {
      setCashiers(p => p.map(c => c.Username === origUsername ? form : c));
      try { await dbPut("cashiers", { ...form, id: form.Username }); } catch(e) {}
      safeCallScript({ action: "editCashier", Name: form.Name, Username: form.Username, PIN: form.PIN, Role: form.Role, OrigUsername: origUsername });
    }
    setEditing(null); setOrigUsername("");
  };
  const del = username => { if (window.confirm("Delete this user?")) { setCashiers(p => p.filter(c => c.Username !== username)); safeCallScript({ action: "deleteCashier", Username: username }); } };
  return (
    <div style={{ maxWidth: 560 }}>
      <button className="btn" onClick={startAdd} style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 12, borderRadius: 7, marginBottom: 14 }}>+ Add User</button>
      {editing && (
        <div style={{ background: "rgba(0,180,255,0.04)", border: "1px solid rgba(0,180,255,0.17)", borderRadius: 11, padding: 18, marginBottom: 16 }}>
          <div style={{ color: "#00b4ff", fontSize: 11, letterSpacing: 2, marginBottom: 13, fontWeight: 700 }}>{editing === "__new__" ? "➕ ADD USER" : "✏️ EDIT USER"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
            {[["Name","Full Name"],["Username","Username"],["PIN","PIN Code"]].map(([k,l]) => (
              <div key={k}><label style={lbSt}>{l}</label><input value={form[k]} onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} style={inSt} type={k === "PIN" ? "password" : "text"} /></div>
            ))}
            <div><label style={lbSt}>Role</label><select value={form.Role} onChange={e => setForm(p => ({ ...p, Role: e.target.value }))} style={slSt}><option value="cashier">Cashier</option><option value="admin">Admin</option></select></div>
          </div>
          <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
            <button className="btn" onClick={save} style={{ padding: "9px 20px", background: "linear-gradient(135deg,#00a651,#00e5a0)", color: "#000", fontWeight: 700, borderRadius: 7 }}>✓ Save</button>
            <button className="btn" onClick={() => { setEditing(null); setOrigUsername(""); }} style={{ padding: "9px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.42)", borderRadius: 7 }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {cashiers.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 15px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, color: "#fff", background: c.Role === "admin" ? "linear-gradient(135deg,#ffd700,#ff8c00)" : "linear-gradient(135deg,#0062ff,#00b4ff)" }}>{c.Name?.[0] || "?"}</div>
              <div><div style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{c.Name}</div><div style={{ color: "rgba(255,255,255,0.32)", fontSize: 11 }}>@{c.Username} · PIN: {"●".repeat(c.PIN?.length || 4)}</div></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ padding: "3px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: c.Role === "admin" ? "rgba(255,200,0,0.1)" : "rgba(0,180,255,0.1)", color: c.Role === "admin" ? "#ffd700" : "#00b4ff" }}>{c.Role?.toUpperCase()}</span>
              <button className="btn" onClick={() => startEdit(c)} style={{ padding: "4px 10px", background: "rgba(0,180,255,0.1)", border: "1px solid rgba(0,180,255,0.2)", color: "#00b4ff", fontSize: 11, borderRadius: 5 }}>Edit</button>
              <button className="btn" onClick={() => del(c.Username)} style={{ padding: "4px 10px", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 11, borderRadius: 5 }}>Del</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
