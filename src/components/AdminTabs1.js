import { useState } from "react";
import { T, inSt, slSt, lbSt } from "../config";
import { fmt, getExpiryStatus, fmtExpiry } from "../utils/helpers";
import { dbPut, dbDelete } from "../utils/db";

// ── shared card style ──────────────────────────────────────────────────────
const card = { background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, overflow: "hidden", boxShadow: T.shadow };
const thSt = { padding: "9px 12px", background: T.bgTopBar, color: "rgba(255,255,255,0.85)", fontSize: 10, letterSpacing: 1.5, fontWeight: 700, textTransform: "uppercase" };
const btn  = (variant="primary") => {
  const map = {
    primary:  { background: `linear-gradient(135deg,#1d4ed8,#2563eb)`, color: "#fff", border: "none", boxShadow: "0 2px 8px rgba(37,99,235,0.3)" },
    success:  { background: `linear-gradient(135deg,#047857,#059669)`, color: "#fff", border: "none", boxShadow: "0 2px 8px rgba(5,150,105,0.3)" },
    danger:   { background: T.dangerLight, color: T.danger, border: `1px solid ${T.dangerBorder}` },
    ghost:    { background: T.bgCardAlt, color: T.textSecondary, border: `1px solid ${T.border}` },
    edit:     { background: T.accentLight, color: T.accent, border: `1px solid ${T.accentBorder}` },
  };
  return { ...map[variant], padding: "5px 11px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" };
};

// ── ITEMS TAB ─────────────────────────────────────────────────────────────────
export function ItemsTab({ items, setItems, categories, safeCallScript }) {
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState({});
  const [search,    setSearch]    = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [filterCo,  setFilterCo]  = useState("All");
  const companies = [...new Set(items.map(i => i.Company || "").filter(Boolean))].sort();
  const filtered  = items.filter(i =>
    (filterCat === "All" || i.Category === filterCat) &&
    (filterCo  === "All" || i.Company  === filterCo)  &&
    (!search || i.ItemName?.toLowerCase().includes(search.toLowerCase()) || i.Barcode?.includes(search))
  );
  const startAdd  = () => { setEditing("new"); setForm({ Barcode:"", Category: categories[0]||"", Company:"", ItemName:"", Price:"", CostPrice:"", Discount:"0", Stock:"", ExpiryDate:"" }); };
  const startEdit = item => { setEditing(item.Barcode); setForm({ ...item }); };
  const save = async () => {
    if (!form.Barcode || !form.ItemName || !form.Price) return;
    if (editing === "new") setItems(p => [...p, form]); else setItems(p => p.map(i => i.Barcode === editing ? form : i));
    try { await dbPut("items", { ...form, id: form.Barcode }); } catch {}
    safeCallScript({ action: editing === "new" ? "addItem" : "editItem", ...form });
    setEditing(null);
  };
  const del = async bc => {
    if (!window.confirm("Delete this item?")) return;
    setItems(p => p.filter(i => i.Barcode !== bc));
    try { await dbDelete("items", bc); } catch {}
    safeCallScript({ action: "deleteItem", Barcode: bc });
  };
  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 9, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search items..." style={{ ...inSt, maxWidth: 220, background: T.bgCard }} />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...slSt, minWidth: 150, background: T.bgCard }}>
          <option value="All">All Categories</option>{categories.map(c=><option key={c}>{c}</option>)}
        </select>
        <select value={filterCo}  onChange={e => setFilterCo(e.target.value)}  style={{ ...slSt, minWidth: 150, background: T.bgCard }}>
          <option value="All">All Companies</option>{companies.map(c=><option key={c}>{c}</option>)}
        </select>
        <button className="btn" onClick={startAdd} style={{ ...btn("primary"), padding: "9px 18px", fontSize: 12 }}>+ Add Item</button>
        <span style={{ color: T.textMuted, fontSize: 12, marginLeft: "auto" }}>{filtered.length} items</span>
      </div>

      {/* Edit form */}
      {editing && (
        <div style={{ ...card, padding: 18, marginBottom: 16, borderLeft: `4px solid ${T.accent}` }}>
          <div style={{ color: T.accent, fontSize: 11, letterSpacing: 2, marginBottom: 13, fontWeight: 700 }}>{editing==="new"?"➕ ADD NEW ITEM":"✏️ EDIT ITEM"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 11 }}>
            {[["Barcode","Barcode","text"],["ItemName","Item Name","text"],["Company","Company","text"],["Price","Selling Price (PKR)","number"],["CostPrice","Cost Price (PKR)","number"],["Discount","Item Discount (PKR)","number"],["Stock","Stock Qty","number"]].map(([k,l,t])=>(
              <div key={k}><label style={lbSt}>{l}</label><input type={t} value={form[k]||""} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} style={{ ...inSt, background: T.bgCard }} /></div>
            ))}
            <div>
              <label style={lbSt}>EXPIRY DATE</label>
              <input type="date" value={form.ExpiryDate||""} onChange={e=>setForm(p=>({...p,ExpiryDate:e.target.value}))}
                style={{ ...inSt, background: T.bgCard, colorScheme: "light", borderColor: form.ExpiryDate ? getExpiryStatus(form.ExpiryDate).color : T.border }} />
              {form.ExpiryDate&&(()=>{const es=getExpiryStatus(form.ExpiryDate);return<div style={{marginTop:5,fontSize:11,color:es.color,fontWeight:600}}>{es.label}</div>;})()}
            </div>
            <div><label style={lbSt}>Category</label>
              <select value={form.Category||""} onChange={e=>setForm(p=>({...p,Category:e.target.value}))} style={{ ...slSt, background: T.bgCard }}>
                {categories.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {form.Price&&form.CostPrice&&parseFloat(form.Price)>0&&(
            <div style={{marginTop:10,padding:"8px 13px",background:T.successLight,border:`1px solid ${T.successBorder}`,borderRadius:7,fontSize:11,color:T.success}}>
              Profit: PKR {fmt(parseFloat(form.Price)-parseFloat(form.CostPrice))} · Margin: {((parseFloat(form.Price)-parseFloat(form.CostPrice))/parseFloat(form.Price)*100).toFixed(1)}%
            </div>
          )}
          <div style={{display:"flex",gap:9,marginTop:13}}>
            <button className="btn" onClick={save} style={{ ...btn("success"), padding:"9px 22px", fontSize:13 }}>✓ Save</button>
            <button className="btn" onClick={()=>setEditing(null)} style={{ ...btn("ghost"), padding:"9px 16px", fontSize:12 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={card}>
        <div style={{display:"grid",gridTemplateColumns:"110px 1fr 100px 100px 75px 70px 70px 70px 105px 90px",...thSt}}>
          <div>Barcode</div><div>Item Name</div><div>Category</div><div>Company</div>
          <div style={{textAlign:"right"}}>Price</div><div style={{textAlign:"right"}}>Cost</div>
          <div style={{textAlign:"right"}}>Disc</div><div style={{textAlign:"right"}}>Stock</div>
          <div style={{textAlign:"center"}}>Expiry</div><div style={{textAlign:"center"}}>Actions</div>
        </div>
        {filtered.map((item,idx)=>{
          const stk=Number(item.Stock)||0;
          return(
            <div key={idx} style={{display:"grid",gridTemplateColumns:"110px 1fr 100px 100px 75px 70px 70px 70px 105px 90px",padding:"9px 12px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",background:stk<=0?"#fef2f2":stk<=5?"#fffbeb":"transparent",transition:"background 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background=stk<=0?"#fef2f2":stk<=5?"#fffbeb":"transparent"}>
              <div style={{color:T.textMuted,fontSize:11}}>{item.Barcode}</div>
              <div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{item.ItemName}</div>
              <div style={{color:T.textSecondary,fontSize:11}}>{item.Category}</div>
              <div style={{color:T.accent,fontSize:11}}>{item.Company||"—"}</div>
              <div style={{color:T.accent,textAlign:"right",fontWeight:700,fontSize:12}}>{fmt(item.Price)}</div>
              <div style={{color:T.success,textAlign:"right",fontSize:11}}>{item.CostPrice?fmt(item.CostPrice):"—"}</div>
              <div style={{color:parseFloat(item.Discount)>0?T.posGold:T.textMuted,textAlign:"right",fontSize:12}}>{item.Discount}</div>
              <div style={{textAlign:"right",fontWeight:700,fontSize:12,color:stk<=0?T.danger:stk<=5?T.warning:T.success}}>{item.Stock}{stk<=0?" ❌":stk<=5?" ⚠️":""}</div>
              {(()=>{const es=getExpiryStatus(item.ExpiryDate);return(
                <div style={{textAlign:"center"}}>
                  <div style={{color:es.color,fontSize:10,fontWeight:700}}>{fmtExpiry(item.ExpiryDate)}</div>
                  {item.ExpiryDate&&<div style={{fontSize:9,color:es.color,opacity:0.85}}>{es.label}</div>}
                </div>);})()}
              <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                <button className="btn" onClick={()=>startEdit(item)} style={btn("edit")}>Edit</button>
                <button className="btn" onClick={()=>del(item.Barcode)} style={btn("danger")}>Del</button>
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
  const add = () => { const v=val.trim(); if(v&&!categories.includes(v)){setCategories(p=>[...p,v]);safeCallScript({action:"addCategory",CategoryName:v});setVal("");} };
  const del = cat => { if(items.some(i=>i.Category===cat)){alert(`"${cat}" used by items.`);return;} if(window.confirm(`Delete "${cat}"?`)){setCategories(p=>p.filter(c=>c!==cat));safeCallScript({action:"deleteCategory",CategoryName:cat});} };
  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{display:"flex",gap:9,marginBottom:16}}>
        <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="New category name..." style={{ ...inSt, background: T.bgCard }} />
        <button className="btn" onClick={add} style={{ ...btn("primary"), padding:"9px 18px", whiteSpace:"nowrap", fontSize:12 }}>+ Add</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {categories.map(cat=>{const cnt=items.filter(i=>i.Category===cat).length;return(
          <div key={cat} style={{...card,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px"}}>
            <div><span style={{color:T.textPrimary,fontSize:13,fontWeight:600}}>{cat}</span><span style={{color:T.textMuted,fontSize:11,marginLeft:9}}>{cnt} items</span></div>
            <button className="btn" onClick={()=>del(cat)} style={btn("danger")}>Delete</button>
          </div>
        );})}
      </div>
    </div>
  );
}

// ── CASHIERS TAB ──────────────────────────────────────────────────────────────
export function CashiersTab({ cashiers, setCashiers, safeCallScript }) {
  const [editing, setEditing] = useState(null);
  const [origUsername, setOrigUsername] = useState("");
  const [form, setForm] = useState({ Name:"", Username:"", PIN:"", Role:"cashier" });
  const startAdd  = () => { setEditing("__new__"); setOrigUsername(""); setForm({Name:"",Username:"",PIN:"",Role:"cashier"}); };
  const startEdit = c => { setEditing(c.Username); setOrigUsername(c.Username); setForm({...c}); };
  const save = async () => {
    if(!form.Name||!form.Username||!form.PIN) return;
    if(editing==="__new__"){setCashiers(p=>[...p,form]);safeCallScript({action:"addCashier",...form});}
    else{setCashiers(p=>p.map(c=>c.Username===origUsername?form:c));safeCallScript({action:"editCashier",...form,OrigUsername:origUsername});}
    setEditing(null); setOrigUsername("");
  };
  const del = username => { if(window.confirm("Delete this user?")){setCashiers(p=>p.filter(c=>c.Username!==username));safeCallScript({action:"deleteCashier",Username:username});} };
  return (
    <div style={{ maxWidth: 580 }}>
      <button className="btn" onClick={startAdd} style={{ ...btn("primary"), padding:"9px 18px", fontSize:12, marginBottom:14 }}>+ Add User</button>
      {editing&&(
        <div style={{...card,padding:18,marginBottom:16,borderLeft:`4px solid ${T.accent}`}}>
          <div style={{color:T.accent,fontSize:11,letterSpacing:2,marginBottom:13,fontWeight:700}}>{editing==="__new__"?"➕ ADD USER":"✏️ EDIT USER"}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
            {[["Name","Full Name"],["Username","Username"],["PIN","PIN Code"]].map(([k,l])=>(
              <div key={k}><label style={lbSt}>{l}</label><input value={form[k]||""} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} style={{ ...inSt, background: T.bgCard }} type={k==="PIN"?"password":"text"} /></div>
            ))}
            <div><label style={lbSt}>Role</label>
              <select value={form.Role||"cashier"} onChange={e=>setForm(p=>({...p,Role:e.target.value}))} style={{ ...slSt, background: T.bgCard }}>
                <option value="cashier">Cashier</option><option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div style={{display:"flex",gap:9,marginTop:13}}>
            <button className="btn" onClick={save} style={{ ...btn("success"), padding:"9px 22px", fontSize:13 }}>✓ Save</button>
            <button className="btn" onClick={()=>{setEditing(null);setOrigUsername("");}} style={{ ...btn("ghost"), padding:"9px 16px", fontSize:12 }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {cashiers.map((c,i)=>(
          <div key={i} style={{...card,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:40,height:40,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:16,color:"#fff",background:c.Role==="admin"?"linear-gradient(135deg,#d97706,#f59e0b)":"linear-gradient(135deg,#1d4ed8,#2563eb)",boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
                {c.Name?.[0]||"?"}
              </div>
              <div>
                <div style={{color:T.textPrimary,fontWeight:600,fontSize:13}}>{c.Name}</div>
                <div style={{color:T.textMuted,fontSize:11}}>@{c.Username} · PIN: {"●".repeat(c.PIN?.length||4)}</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:700,background:c.Role==="admin"?"#fffbeb":"#eff6ff",color:c.Role==="admin"?"#92400e":"#1d4ed8",border:`1px solid ${c.Role==="admin"?"#fde68a":"#bfdbfe"}`}}>{c.Role?.toUpperCase()}</span>
              <button className="btn" onClick={()=>startEdit(c)} style={btn("edit")}>Edit</button>
              <button className="btn" onClick={()=>del(c.Username)} style={btn("danger")}>Del</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
