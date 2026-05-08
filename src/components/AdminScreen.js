import { useState } from "react";
import { bdgSt } from "../config";
import StatusBar from "./StatusBar";
import { ItemsTab, CategoriesTab, CashiersTab } from "./AdminTabs1";
import { SalesTab, ReturnsTab, ProfitTab } from "./AdminTabs2";
import { StockTab, SetupTab } from "./AdminTabs3";
import { CustomersTab } from "./CustomersTab";

const TABS = [
  { id: "items",      label: "📦 Items",      admin: false },
  { id: "stock",      label: "📉 Stock",      admin: false },
  { id: "sales",      label: "💰 Sales",      admin: false },
  { id: "profit",     label: "📈 Profit",     admin: true  },
  { id: "customers",  label: "👥 Customers",  admin: false },
  { id: "returns",    label: "↩ Returns",     admin: false },
  { id: "categories", label: "🏷 Categories", admin: true  },
  { id: "cashiers",   label: "👤 Cashiers",   admin: true  },
  { id: "setup",      label: "⚙️ Setup",      admin: true  },
];

export default function AdminScreen({
  user, items, setItems, categories, setCategories, cashiers, setCashiers,
  sales, setSales, customers, setCustomers, returns, setReturns,
  sheetStatus, isOnline, lastSync, onRefresh, onLogout, safeCallScript,
}) {
  const [tab, setTab] = useState("items");
  const visibleTabs = TABS.filter(t => !t.admin || user?.Role === "admin");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#0a0e1a" }}>
      {/* TOP BAR */}
      <div style={{ background: "linear-gradient(90deg,#0c1828,#091422)", borderBottom: "1px solid rgba(0,180,255,0.18)", padding: "9px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontFamily: "Orbitron", color: "#00b4ff", fontSize: 14, fontWeight: 900 }}>itKINS POS — ADMIN</div>
          <div style={bdgSt("#00b4ff")}>{user?.Name?.toUpperCase()} · {user?.Role?.toUpperCase()}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusBar isOnline={isOnline} sheetStatus={sheetStatus} lastSync={lastSync} onRefresh={onRefresh} />
          <button className="btn" onClick={onLogout} style={{ padding: "6px 14px", background: "rgba(255,80,80,0.12)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff6b6b", fontSize: 12, borderRadius: 6 }}>← Logout</button>
        </div>
      </div>

      {/* TAB BAR */}
      <div style={{ display: "flex", gap: 4, padding: "8px 18px 0", background: "rgba(0,0,0,0.2)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
        {visibleTabs.map(t => (
          <button key={t.id} className="btn" onClick={() => setTab(t.id)}
            style={{ padding: "8px 16px", background: tab === t.id ? "rgba(0,180,255,0.15)" : "rgba(255,255,255,0.03)", border: `1px solid ${tab === t.id ? "rgba(0,180,255,0.4)" : "rgba(255,255,255,0.07)"}`, borderBottom: tab === t.id ? "1px solid #0a0e1a" : "1px solid rgba(255,255,255,0.07)", color: tab === t.id ? "#00b4ff" : "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: tab === t.id ? 700 : 400, borderRadius: "8px 8px 0 0", marginBottom: -1, whiteSpace: "nowrap" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      <div style={{ flex: 1, padding: 18, overflowY: "auto" }}>
        {tab === "items"      && <ItemsTab      items={items} setItems={setItems} categories={categories} safeCallScript={safeCallScript} />}
        {tab === "stock"      && <StockTab      items={items} setItems={setItems} safeCallScript={safeCallScript} />}
        {tab === "sales"      && <SalesTab      sales={sales} setSales={setSales} customers={customers} returns={returns} />}
        {tab === "profit"     && <ProfitTab     sales={sales} items={items} returns={returns} />}
        {tab === "customers"  && <CustomersTab  customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} sales={sales} currentUser={user} />}
        {tab === "returns"    && <ReturnsTab    returns={returns} />}
        {tab === "categories" && <CategoriesTab categories={categories} setCategories={setCategories} items={items} safeCallScript={safeCallScript} />}
        {tab === "cashiers"   && <CashiersTab   cashiers={cashiers} setCashiers={setCashiers} safeCallScript={safeCallScript} />}
        {tab === "setup"      && <SetupTab      sheetStatus={sheetStatus} onRefresh={onRefresh} lastSync={lastSync} safeCallScript={safeCallScript} />}
      </div>
    </div>
  );
}
