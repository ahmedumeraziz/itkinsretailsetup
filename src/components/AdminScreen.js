import { useState } from "react";
import { T, bdgSt } from "../config";
import StatusBar from "./StatusBar";
import { ItemsTab, CategoriesTab, CashiersTab } from "./AdminTabs1";
import { SalesTab, ReturnsTab, ProfitTab } from "./AdminTabs2";
import { StockTab, SetupTab } from "./AdminTabs3";
import { CustomersTab } from "./CustomersTab";
import { HRTab } from "./HRTab";          // ← NEW

const TABS = [
  { id: "items",      label: "📦 Items",      admin: false },
  { id: "stock",      label: "📉 Stock",      admin: false },
  { id: "sales",      label: "💰 Sales",      admin: false },
  { id: "profit",     label: "📈 Profit",     admin: true  },
  { id: "hr",         label: "🧑‍💼 HR",         admin: true  }, // ← NEW
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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: T.bgPage }}>
      {/* TOP BAR */}
      <div style={{ background: T.bgTopBar, borderBottom: `1px solid rgba(255,255,255,0.1)`, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 10, flexWrap: "wrap", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontFamily: "Orbitron", color: "#fff", fontSize: 14, fontWeight: 900, letterSpacing: 1 }}>itKINS POS: MIAN TRADERS</div>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)" }} />
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>ADMIN PANEL</div>
          <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "rgba(255,255,255,0.15)", color: "#fff" }}>
            {user?.Name?.toUpperCase()} · {user?.Role?.toUpperCase()}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusBar isOnline={isOnline} sheetStatus={sheetStatus} lastSync={lastSync} onRefresh={onRefresh} />
          <button className="btn" onClick={onLogout} style={{ padding: "7px 16px", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", fontSize: 12, borderRadius: 7, fontWeight: 600 }}>← Logout</button>
        </div>
      </div>

      {/* TAB BAR */}
      <div style={{ display: "flex", gap: 3, padding: "10px 18px 0", background: T.bgCard, borderBottom: `1px solid ${T.border}`, flexWrap: "wrap", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        {visibleTabs.map(t => (
          <button key={t.id} className="btn" onClick={() => setTab(t.id)}
            style={{
              padding: "9px 16px",
              background: tab === t.id ? T.accent : "transparent",
              border: "none",
              borderBottom: tab === t.id ? `3px solid ${T.accent}` : "3px solid transparent",
              color: tab === t.id ? "#fff" : T.textSecondary,
              fontSize: 12,
              fontWeight: tab === t.id ? 700 : 500,
              borderRadius: "7px 7px 0 0",
              whiteSpace: "nowrap",
              transition: "all 0.15s",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      <div style={{ flex: 1, padding: "20px 18px", overflowY: "auto" }}>
        {tab === "items"      && <ItemsTab      items={items} setItems={setItems} categories={categories} safeCallScript={safeCallScript} />}
        {tab === "stock"      && <StockTab      items={items} setItems={setItems} safeCallScript={safeCallScript} />}
        {tab === "sales"      && <SalesTab      sales={sales} setSales={setSales} customers={customers} returns={returns} />}
        {tab === "profit"     && <ProfitTab     sales={sales} items={items} returns={returns} />}
        {tab === "hr"         && <HRTab         sales={sales} items={items} returns={returns} />}  {/* ← NEW */}
        {tab === "customers"  && <CustomersTab  customers={customers} setCustomers={setCustomers} safeCallScript={safeCallScript} sales={sales} currentUser={user} />}
        {tab === "returns"    && <ReturnsTab    returns={returns} />}
        {tab === "categories" && <CategoriesTab categories={categories} setCategories={setCategories} items={items} safeCallScript={safeCallScript} />}
        {tab === "cashiers"   && <CashiersTab   cashiers={cashiers} setCashiers={setCashiers} safeCallScript={safeCallScript} />}
        {tab === "setup"      && <SetupTab      sheetStatus={sheetStatus} onRefresh={onRefresh} lastSync={lastSync} safeCallScript={safeCallScript} />}
      </div>
    </div>
  );
}
