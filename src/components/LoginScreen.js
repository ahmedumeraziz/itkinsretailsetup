import { useState, useRef, useCallback } from "react";
import { inSt, lbSt } from "../config";

export default function LoginScreen({ cashiers, onLogin, sheetStatus, onRefresh }) {
  const [username, setUsername] = useState(""); const [pin, setPin] = useState(""); const [error, setError] = useState(""); const [shake, setShake] = useState(false);
  const pinRef = useRef(pin); pinRef.current = pin;
  const doLogin = useCallback((pinOverride) => {
    const p = pinOverride !== undefined ? pinOverride : pinRef.current;
    const f = cashiers.find(c => c.Username?.toLowerCase().trim() === username.toLowerCase().trim() && c.PIN?.trim() === p.trim());
    if (f) { onLogin(f); } else { setError("Invalid username or PIN"); setShake(true); setTimeout(() => setShake(false), 600); setPin(""); }
  }, [cashiers, username, onLogin]);
  const handleKeyDown = useCallback(e => {
    if (e.target.id === "username-input") return;
    if (e.key >= "0" && e.key <= "9") { e.preventDefault(); setPin(p => { if (p.length >= 6) return p; const np = p + e.key; const f = cashiers.find(c => c.Username?.toLowerCase().trim() === username.toLowerCase().trim() && c.PIN?.trim() === np.trim()); if (f) setTimeout(() => onLogin(f), 120); return np; }); setError(""); }
    else if (e.key === "Backspace") { e.preventDefault(); setPin(p => p.slice(0, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); doLogin(); }
  }, [cashiers, username, onLogin, doLogin]);
  const padPress = useCallback(k => {
    if (k === "⌫") { setPin(p => p.slice(0, -1)); return; }
    if (k === "✓") { doLogin(); return; }
    setPin(p => { if (p.length >= 6) return p; const np = p + k; const f = cashiers.find(c => c.Username?.toLowerCase().trim() === username.toLowerCase().trim() && c.PIN?.trim() === np.trim()); if (f) setTimeout(() => onLogin(f), 120); return np; });
    setError("");
  }, [cashiers, username, onLogin, doLogin]);
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0a0e1a 0%,#0d1b2a 60%,#0a1628 100%)", position: "relative", overflow: "hidden", outline: "none" }} tabIndex={0} onKeyDown={handleKeyDown}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "linear-gradient(rgba(0,180,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,180,255,0.04) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="fadein" style={{ width: 400, padding: "38px 34px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(0,180,255,0.18)", borderRadius: 18, backdropFilter: "blur(20px)", boxShadow: "0 0 80px rgba(0,80,255,0.12)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontFamily: "Orbitron", fontSize: 10, color: "#00b4ff", letterSpacing: 5, marginBottom: 10, opacity: 0.7 }}>POINT OF SALE SYSTEM</div>
          <div style={{ fontFamily: "Orbitron", fontSize: 21, color: "#fff", fontWeight: 900, letterSpacing: 2, lineHeight: 1.3 }}>itKINS<br /><span style={{ color: "#00b4ff" }}>MART - BAKERY</span></div>
          <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 11, marginTop: 5, letterSpacing: 3 }}>& STORE</div>
        </div>
        {sheetStatus === "error" && (
          <div style={{ background: "rgba(255,150,0,0.07)", border: "1px solid rgba(255,150,0,0.22)", borderRadius: 8, padding: "10px 13px", marginBottom: 14, fontSize: 11, color: "rgba(255,180,0,0.88)", lineHeight: 1.7 }}>
            ⚠ Could not load database. Check your internet.<br />
            <button className="btn" onClick={onRefresh} style={{ marginTop: 5, padding: "4px 10px", background: "rgba(255,180,0,0.1)", border: "1px solid rgba(255,180,0,0.28)", color: "#ffd700", fontSize: 11, borderRadius: 5 }}>🔄 Retry</button>
          </div>
        )}
        <div style={{ marginBottom: 12 }}><label style={lbSt}>USERNAME</label>
          <input id="username-input" value={username} onChange={e => { setUsername(e.target.value); setError(""); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("pin-box")?.focus(); } }} style={inSt} placeholder="Enter username" autoComplete="off" />
        </div>
        <div style={{ marginBottom: 16 }}><label style={lbSt}>PIN CODE</label>
          <div id="pin-box" style={{ width: "100%", padding: "13px 14px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,180,255,0.25)", borderRadius: 8, textAlign: "center", minHeight: 50, userSelect: "none" }}>
            {pin.length > 0 ? <span style={{ color: "#fff", fontSize: 22, letterSpacing: 10 }}>{"●".repeat(pin.length)}</span> : <span style={{ color: "rgba(255,255,255,0.22)", fontSize: 12 }}>Type PIN or use pad below</span>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14, ...(shake ? { outline: "2px solid #ff6b6b", borderRadius: 8 } : {}) }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "✓"].map(k => (
            <button key={k} className="btn" onClick={() => padPress(String(k))}
              style={{ padding: "15px 10px", background: k === "✓" ? "linear-gradient(135deg,#0062ff,#00b4ff)" : k === "⌫" ? "rgba(255,80,80,0.12)" : "rgba(255,255,255,0.06)", border: k === "✓" ? "none" : `1px solid ${k === "⌫" ? "rgba(255,80,80,0.2)" : "rgba(255,255,255,0.08)"}`, color: k === "✓" ? "#fff" : k === "⌫" ? "#ff6b6b" : "#fff", fontSize: k === "✓" || k === "⌫" ? 18 : 20, fontWeight: 700, borderRadius: 8 }}>{k}</button>
          ))}
        </div>
        {error && <div style={{ color: "#ff6b6b", textAlign: "center", fontSize: 12, marginBottom: 12, padding: 8, background: "rgba(255,80,80,0.08)", borderRadius: 6 }}>{error}</div>}
        <button className="btn" onClick={() => doLogin()} style={{ width: "100%", padding: 14, background: "linear-gradient(135deg,#0062ff,#00b4ff)", color: "#fff", fontSize: 13, letterSpacing: 3, borderRadius: 8, fontFamily: "Orbitron" }}>LOGIN</button>
      </div>
    </div>
  );
}
