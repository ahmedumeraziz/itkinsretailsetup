import { useState, useRef, useCallback } from "react";
import { T } from "../config";

export default function LoginScreen({ cashiers, onLogin, sheetStatus, onRefresh }) {
  const [username, setUsername] = useState("");
  const [pin,      setPin]      = useState("");
  const [error,    setError]    = useState("");
  const [shake,    setShake]    = useState(false);
  const pinRef = useRef(pin); pinRef.current = pin;

  const doLogin = useCallback((pinOverride) => {
    const p = pinOverride !== undefined ? pinOverride : pinRef.current;
    const f = cashiers.find(c =>
      c.Username?.toLowerCase().trim() === username.toLowerCase().trim() &&
      c.PIN?.trim() === p.trim()
    );
    if (f) { onLogin(f); }
    else { setError("Invalid username or PIN"); setShake(true); setTimeout(() => setShake(false), 600); setPin(""); }
  }, [cashiers, username, onLogin]);

  const handleKeyDown = useCallback(e => {
    if (e.target.id === "username-input") return;
    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      setPin(p => {
        if (p.length >= 6) return p;
        const np = p + e.key;
        const f  = cashiers.find(c => c.Username?.toLowerCase().trim() === username.toLowerCase().trim() && c.PIN?.trim() === np.trim());
        if (f) setTimeout(() => onLogin(f), 120);
        return np;
      });
      setError("");
    } else if (e.key === "Backspace") { e.preventDefault(); setPin(p => p.slice(0, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); doLogin(); }
  }, [cashiers, username, onLogin, doLogin]);

  const padPress = useCallback(k => {
    if (k === "⌫") { setPin(p => p.slice(0, -1)); return; }
    if (k === "✓") { doLogin(); return; }
    setPin(p => {
      if (p.length >= 6) return p;
      const np = p + k;
      const f  = cashiers.find(c => c.Username?.toLowerCase().trim() === username.toLowerCase().trim() && c.PIN?.trim() === np.trim());
      if (f) setTimeout(() => onLogin(f), 120);
      return np;
    });
    setError("");
  }, [cashiers, username, onLogin, doLogin]);

  const inputSt = {
    width: "100%", padding: "11px 14px", background: T.bgInput,
    border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary,
    fontSize: 14, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, #dbeafe 0%, #f0f4f8 50%, #e0f2fe 100%)`, position: "relative", overflow: "hidden" }}
      tabIndex={0} onKeyDown={handleKeyDown}>

      {/* Decorative circles */}
      <div style={{ position: "absolute", top: -80, right: -80, width: 320, height: 320, borderRadius: "50%", background: "rgba(37,99,235,0.08)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -60, left: -60, width: 240, height: 240, borderRadius: "50%", background: "rgba(37,99,235,0.06)", pointerEvents: "none" }} />

      <div className="fadein" style={{ width: 420, padding: "38px 36px", background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 20, boxShadow: T.shadowLg }}>

        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "linear-gradient(135deg,#1d4ed8,#2563eb)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", boxShadow: "0 4px 14px rgba(37,99,235,0.35)" }}>
            <span style={{ fontSize: 28 }}>🛒</span>
          </div>
          <div style={{ fontFamily: "Orbitron", fontSize: 10, color: T.accent, letterSpacing: 5, marginBottom: 6, opacity: 0.7 }}>POINT OF SALE SYSTEM</div>
          <div style={{ fontFamily: "Orbitron", fontSize: 20, color: T.textPrimary, fontWeight: 900, letterSpacing: 1, lineHeight: 1.3 }}>
            Mian <span style={{ color: T.accent }}>Traders</span>
          </div>
          <div style={{ color: T.textMuted, fontSize: 12, marginTop: 4, letterSpacing: 2 }}>GUJRANWALA</div>
        </div>

        {/* Sheet error */}
        {sheetStatus === "error" && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 9, padding: "10px 13px", marginBottom: 14, fontSize: 12, color: "#92400e", lineHeight: 1.7 }}>
            ⚠ Could not connect to database. Check your internet.
            <br /><button className="btn" onClick={onRefresh} style={{ marginTop: 5, padding: "4px 10px", background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e", fontSize: 11, borderRadius: 5 }}>🔄 Retry</button>
          </div>
        )}

        {/* Username */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: T.textSecondary, marginBottom: 5, letterSpacing: 0.5 }}>USERNAME</label>
          <input id="username-input" value={username} onChange={e => { setUsername(e.target.value); setError(""); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("pin-box")?.focus(); } }}
            style={inputSt} placeholder="Enter your username" autoComplete="off" />
        </div>

        {/* PIN display */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: T.textSecondary, marginBottom: 5, letterSpacing: 0.5 }}>PIN CODE</label>
          <div id="pin-box" style={{ width: "100%", padding: "13px 14px", background: pin.length > 0 ? T.accentLight : T.bgCardAlt, border: `1px solid ${pin.length > 0 ? T.accentBorder : T.border}`, borderRadius: 8, textAlign: "center", minHeight: 50, transition: "all 0.2s" }}>
            {pin.length > 0
              ? <span style={{ color: T.accent, fontSize: 20, letterSpacing: 10 }}>{"●".repeat(pin.length)}</span>
              : <span style={{ color: T.textMuted, fontSize: 12 }}>Tap numbers below or use keyboard</span>}
          </div>
        </div>

        {/* Number pad */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9, marginBottom: 14, ...(shake ? { animation: "shake 0.5s" } : {}) }}>
          {[1,2,3,4,5,6,7,8,9,"⌫",0,"✓"].map(k => (
            <button key={k} className="btn" onClick={() => padPress(String(k))}
              style={{
                padding: "15px 10px",
                background: k === "✓" ? "linear-gradient(135deg,#1d4ed8,#2563eb)"
                          : k === "⌫" ? T.dangerLight
                          : T.bgCardAlt,
                border: k === "✓" ? "none"
                      : k === "⌫" ? `1px solid ${T.dangerBorder}`
                      : `1px solid ${T.border}`,
                color: k === "✓" ? "#fff" : k === "⌫" ? T.danger : T.textPrimary,
                fontSize: k === "✓" || k === "⌫" ? 18 : 20,
                fontWeight: 700,
                borderRadius: 9,
                boxShadow: k === "✓" ? "0 3px 10px rgba(37,99,235,0.3)" : T.shadow,
              }}>
              {k}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ color: T.danger, textAlign: "center", fontSize: 12, marginBottom: 12, padding: "9px 12px", background: T.dangerLight, border: `1px solid ${T.dangerBorder}`, borderRadius: 7 }}>
            {error}
          </div>
        )}

        {/* Login button */}
        <button className="btn" onClick={() => doLogin()}
          style={{ width: "100%", padding: 14, background: "linear-gradient(135deg,#1d4ed8,#2563eb)", color: "#fff", fontSize: 13, letterSpacing: 3, borderRadius: 9, fontFamily: "Orbitron", fontWeight: 700, boxShadow: "0 4px 14px rgba(37,99,235,0.35)" }}>
          LOGIN →
        </button>

        <div style={{ textAlign: "center", marginTop: 16, color: T.textMuted, fontSize: 11 }}>
          Designed by <b style={{ color: T.accent }}>itKINS</b> · 0304-7414437
        </div>
      </div>
    </div>
  );
}
