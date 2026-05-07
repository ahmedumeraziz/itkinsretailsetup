// ─── STATUS BAR ───────────────────────────────────────────────────────────────
export default function StatusBar({ isOnline, sheetStatus, lastSync, onRefresh }) {
  const syncLabel = lastSync ? lastSync.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "Not synced";
  const statusColor = sheetStatus === "loaded" ? "#00e080" : sheetStatus === "cached" ? "#00b4ff" : sheetStatus === "error" ? "#ff6b6b" : "#ffd700";
  const statusText  = sheetStatus === "loaded" ? `${syncLabel}` : sheetStatus === "cached" ? "Cached" : sheetStatus === "error" ? "Error · Retry" : sheetStatus === "syncing" ? "Syncing..." : "Demo";
  const statusIcon  = sheetStatus === "loaded" ? "✓" : sheetStatus === "cached" ? "💾" : sheetStatus === "error" ? "⚠" : sheetStatus === "syncing" ? "⟳" : "◉";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div title={isOnline ? "Online" : "Offline"} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: isOnline ? "rgba(0,200,0,0.12)" : "rgba(255,80,80,0.12)", border: `1px solid ${isOnline ? "rgba(0,200,0,0.35)" : "rgba(255,80,80,0.35)"}`, color: isOnline ? "#00e080" : "#ff6b6b", whiteSpace: "nowrap" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: isOnline ? "#00e080" : "#ff6b6b", display: "inline-block", boxShadow: isOnline ? "0 0 6px #00e080" : "none" }} />
        {isOnline ? "Online" : "Offline"}
      </div>
      <div onClick={onRefresh} title="Click to sync" style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: "pointer", background: `rgba(${sheetStatus === "loaded" ? "0,160,0" : sheetStatus === "error" ? "255,80,80" : "255,200,0"},0.15)`, border: `1px solid ${statusColor}66`, color: statusColor, whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 11 }}>{statusIcon}</span>{statusText}<span style={{ opacity: 0.5, fontSize: 9, marginLeft: 2 }}>↻</span>
      </div>
    </div>
  );
}
