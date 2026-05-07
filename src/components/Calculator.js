import { useState, useEffect, useRef } from "react";

// ─── CALCULATOR ───────────────────────────────────────────────────────────────
export default function Calculator({ onClose }) {
  const [disp, setDisp] = useState("0"); const [prev, setPrev] = useState(null); const [op, setOp] = useState(null); const [fresh, setFresh] = useState(true);
  const [pos, setPos] = useState({ x: null, y: null }); const dragging = useRef(false); const dragOffset = useRef({ dx: 0, dy: 0 }); const calcRef = useRef();
  useEffect(() => {
    const handler = e => {
      const k = e.key;
      if (k >= "0" && k <= "9") { e.preventDefault(); press(k); }
      else if (k === "." || k === ",") { e.preventDefault(); press("."); }
      else if (k === "+" || k === "-") { e.preventDefault(); press(k); }
      else if (k === "*") { e.preventDefault(); press("×"); }
      else if (k === "/") { e.preventDefault(); press("÷"); }
      else if (k === "Enter" || k === "=") { e.preventDefault(); press("="); }
      else if (k === "Backspace") { e.preventDefault(); press("⌫"); }
      else if (k === "Escape") { onClose(); }
      else if (k === "c" || k === "C") { e.preventDefault(); press("C"); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  const press = v => {
    if (v === "C") { setDisp("0"); setPrev(null); setOp(null); setFresh(true); return; }
    if (v === "⌫") { setDisp(d => d.length > 1 ? d.slice(0, -1) : "0"); return; }
    if (["+", "-", "×", "÷"].includes(v)) { setPrev(parseFloat(disp)); setOp(v); setFresh(true); return; }
    if (v === "=") { if (prev != null && op) { const a = prev, b = parseFloat(disp); let r = op === "+" ? a + b : op === "-" ? a - b : op === "×" ? a * b : b !== 0 ? a / b : 0; setDisp(String(parseFloat(r.toFixed(6)))); setPrev(null); setOp(null); setFresh(true); } return; }
    if (v === ".") { if (!disp.includes(".")) { setDisp(d => (fresh ? "0" : d) + "."); setFresh(false); } return; }
    setDisp(d => fresh ? v : (d === "0" ? v : d + v)); setFresh(false);
  };
  const onMouseDown = e => { if (e.target.closest("button")) return; dragging.current = true; const rect = calcRef.current.getBoundingClientRect(); dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }; e.preventDefault(); };
  useEffect(() => { const move = e => { if (!dragging.current) return; setPos({ x: e.clientX - dragOffset.current.dx, y: e.clientY - dragOffset.current.dy }); }; const up = () => { dragging.current = false; }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }; }, []);
  const rows = [["7", "8", "9", "÷"], ["4", "5", "6", "×"], ["1", "2", "3", "-"], ["C", "0", ".", "+"], ["⌫", "", "", "="]];
  const style = pos.x !== null ? { position: "fixed", left: pos.x, top: pos.y, zIndex: 3000 } : { position: "fixed", bottom: 80, right: 20, zIndex: 3000 };
  return (
    <div ref={calcRef} style={{ ...style, background: "#0d1b2a", border: "1px solid rgba(0,180,255,0.3)", borderRadius: 14, padding: 14, boxShadow: "0 8px 40px rgba(0,0,0,0.7)", width: 228, userSelect: "none" }}>
      <div onMouseDown={onMouseDown} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, cursor: "grab" }}>
        <div style={{ color: "#00b4ff", fontFamily: "Orbitron", fontSize: 11, fontWeight: 700 }}>🧮 CALCULATOR</div>
        <button className="btn" onClick={onClose} style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", color: "#ff6b6b", fontSize: 14, padding: "2px 8px", borderRadius: 5 }}>✕</button>
      </div>
      <div style={{ background: "rgba(0,0,0,0.45)", borderRadius: 8, padding: "10px 12px", marginBottom: 10, textAlign: "right" }}>
        {op && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{prev} {op}</div>}
        <div style={{ color: "#fff", fontSize: 26, fontWeight: 700, fontFamily: "Orbitron", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{disp}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5 }}>
        {rows.flat().map((k, i) => (k === "" ? <div key={i} /> : <button key={i} onClick={() => press(k)} style={{ padding: "11px 0", background: k === "=" ? "linear-gradient(135deg,#0062ff,#00b4ff)" : ["+","×","-","÷"].includes(k) ? "rgba(0,180,255,0.18)" : k === "C" ? "rgba(255,80,80,0.18)" : k === "⌫" ? "rgba(255,150,0,0.15)" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: k === "=" ? "#fff" : k === "C" ? "#ff6b6b" : "#fff", fontSize: 14, fontWeight: 700, borderRadius: 6, cursor: "pointer" }}>{k}</button>))}
      </div>
    </div>
  );
}
