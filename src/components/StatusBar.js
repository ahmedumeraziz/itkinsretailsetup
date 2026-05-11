import { T } from "../config";

export default function StatusBar({ isOnline, sheetStatus, lastSync, onRefresh }) {
  const syncLabel = lastSync
    ? lastSync.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
    : "Not synced";

  const statusColor = sheetStatus === "loaded"  ? T.success
    : sheetStatus === "cached"  ? T.accent
    : sheetStatus === "error"   ? T.danger
    : T.warning;

  const statusBg = sheetStatus === "loaded"  ? T.successLight
    : sheetStatus === "cached"  ? T.accentLight
    : sheetStatus === "error"   ? T.dangerLight
    : T.warningLight;

  const statusBorder = sheetStatus === "loaded"  ? T.successBorder
    : sheetStatus === "cached"  ? T.accentBorder
    : sheetStatus === "error"   ? T.dangerBorder
    : T.warningBorder;

  const statusText = sheetStatus === "loaded"  ? syncLabel
    : sheetStatus === "cached"  ? "Cached"
    : sheetStatus === "error"   ? "Error · Retry"
    : sheetStatus === "syncing" ? "Syncing..."
    : "Demo";

  const statusIcon = sheetStatus === "loaded"  ? "✓"
    : sheetStatus === "cached"  ? "💾"
    : sheetStatus === "error"   ? "⚠"
    : sheetStatus === "syncing" ? "⟳"
    : "◉";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {/* Online/Offline badge */}
      <div title={isOnline ? "Online" : "Offline"} style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
        background: isOnline ? T.successLight : T.dangerLight,
        border: `1px solid ${isOnline ? T.successBorder : T.dangerBorder}`,
        color: isOnline ? T.success : T.danger,
        whiteSpace: "nowrap",
      }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: isOnline ? T.success : T.danger, display: "inline-block", boxShadow: isOnline ? `0 0 5px ${T.success}` : "none" }} />
        {isOnline ? "Online" : "Offline"}
      </div>

      {/* Sync badge */}
      <div onClick={onRefresh} title="Click to sync" style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
        cursor: "pointer",
        background: statusBg,
        border: `1px solid ${statusBorder}`,
        color: statusColor,
        whiteSpace: "nowrap",
        transition: "opacity 0.15s",
      }}>
        <span style={{ fontSize: 12 }}>{statusIcon}</span>
        {statusText}
        <span style={{ opacity: 0.5, fontSize: 10, marginLeft: 1 }}>↻</span>
      </div>
    </div>
  );
}
