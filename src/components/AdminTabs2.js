import { useState } from "react";
import { T, inSt, slSt, lbSt } from "../config";
import { fmt, filterDateMatch, dateInRange, safeParseItems } from "../utils/helpers";
import { printReceipt, printReturnReceipt } from "../utils/print";

const card    = { background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, overflow: "hidden", boxShadow: T.shadow };
const thSt    = { padding: "9px 12px", background: T.bgTopBar, color: "rgba(255,255,255,0.85)", fontSize: 10, letterSpacing: 1.5, fontWeight: 700 };
const normBill = b => { const n = String(b||"").replace(/[^0-9]/g,""); return n.replace(/^0+/,"")||"0"; };

function SummaryCard({ icon, label, value, color, bg, border }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 11, padding: "14px 18px", flex: 1, minWidth: 155 }}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
      <div style={{ color: T.textMuted, fontSize: 10, letterSpacing: 1.5, marginBottom: 3, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color, fontSize: 18, fontWeight: 800, fontFamily: "Orbitron" }}>{value}</div>
    </div>
  );
}

function vuEnabled(item) {
  return !!(item.variable_unit_enabled &&
    parseInt(item.pieces_per_box) > 0 &&
    parseInt(item.boxes_per_cotton) > 0);
}

// ── Detect unit type for an item ──────────────────────────────────────────────
function detectUnitLabel(item) {
  if (!vuEnabled(item)) return "Pieces";
  const c = parseInt(item.qty_cottons || 0);
  const b = parseInt(item.qty_boxes   || 0);
  const p = parseInt(item.qty_pieces  || 0);
  if (c > 0 && b === 0 && p === 0) return "Cottons";
  if (c === 0 && b > 0 && p === 0) return "Boxes";
  if (c === 0 && b === 0 && p > 0) return "Pieces";
  return "Mixed"; // multiple units — show breakdown
}

// ── Build customer load data from filtered credit sales ───────────────────────
function buildLoadData(filteredSales, filterCat) {
  const custMap = {}; // CellNo -> { name, cell, items[], total }

  filteredSales.forEach(sale => {
    const custName = (sale.CustomerName || "").trim();
    const custCell = (sale.CustomerCell || "").trim();
    if (!custName || custName === "Unknown" || !custCell) return; // skip walk-in

    const key = custCell || custName;
    if (!custMap[key]) custMap[key] = { name: custName, cell: custCell, items: [], total: 0 };

    const saleItems = safeParseItems(sale.ItemsDetail);
    saleItems.forEach(it => {
      if (filterCat !== "All" && it.Category !== filterCat) return;
      const price = parseFloat(it.piece_sale_price || it.Price || 0);
      const disc  = parseFloat(it.Discount || 0);
      const qty   = parseInt(it.qty || it.qty_total_pcs || 0);
      const lt    = qty * price - disc * qty;
      custMap[key].items.push({ ...it, _lineTotal: lt, _billNo: sale.BillNo, _date: sale.Date });
      custMap[key].total += lt;
    });
  });

  return Object.values(custMap).filter(c => c.items.length > 0);
}

// ── Generate Load Form PDF ────────────────────────────────────────────────────
function generateLoadFormPDF(filteredSales, filterFrom, filterTo, filterCat, items) {
  const dateRange = filterFrom && filterTo ? `${filterFrom} to ${filterTo}` :
                    filterFrom ? `From ${filterFrom}` : filterTo ? `To ${filterTo}` : "All Dates";
  const now       = new Date().toLocaleString("en-PK");

  // Only credit sales with known customers
  const creditSales = filteredSales.filter(s =>
    s.PaymentMethod === "Credit" &&
    (s.CustomerName || "").trim() &&
    (s.CustomerName || "").trim() !== "Unknown" &&
    (s.CustomerCell || "").trim()
  );

  const customers = buildLoadData(creditSales, filterCat);

  if (customers.length === 0) {
    alert("No credit customer data found for the selected filters.");
    return;
  }

  // ── Grand totals ──────────────────────────────────────────────────────────
  let grandTotal = 0, grandCottons = 0, grandBoxes = 0, grandPieces = 0;
  const catBreakdown = {}; // category -> {cottons,boxes,pieces,amount}

  customers.forEach(cust => {
    grandTotal += cust.total;
    cust.items.forEach(it => {
      const c = parseInt(it.qty_cottons || 0);
      const b = parseInt(it.qty_boxes   || 0);
      const p = parseInt(it.qty_pieces  || 0);
      const qty = parseInt(it.qty || it.qty_total_pcs || 0);
      const isVU = vuEnabled(it);
      grandCottons += c;
      grandBoxes   += b;
      grandPieces  += isVU ? p : qty;
      const cat = it.Category || "General";
      if (!catBreakdown[cat]) catBreakdown[cat] = { cottons: 0, boxes: 0, pieces: 0, amount: 0 };
      catBreakdown[cat].cottons += c;
      catBreakdown[cat].boxes   += b;
      catBreakdown[cat].pieces  += isVU ? p : qty;
      catBreakdown[cat].amount  += it._lineTotal;
    });
  });

  // ── Customer sections HTML ────────────────────────────────────────────────
  const custSections = customers.map((cust, ci) => {
    // Group items by bill
    const billMap = {};
    cust.items.forEach(it => {
      const bn = it._billNo || "?";
      if (!billMap[bn]) billMap[bn] = [];
      billMap[bn].push(it);
    });

    let custCottons = 0, custBoxes = 0, custPieces = 0;
    cust.items.forEach(it => {
      const c = parseInt(it.qty_cottons || 0);
      const b = parseInt(it.qty_boxes   || 0);
      const p = parseInt(it.qty_pieces  || 0);
      const qty = parseInt(it.qty || it.qty_total_pcs || 0);
      const isVU = vuEnabled(it);
      custCottons += c;
      custBoxes   += b;
      custPieces  += isVU ? p : qty;
    });

    const rows = cust.items.map((it, ii) => {
      const isVU = vuEnabled(it);
      const c  = parseInt(it.qty_cottons || 0);
      const b  = parseInt(it.qty_boxes   || 0);
      const p  = parseInt(it.qty_pieces  || 0);
      const qty= parseInt(it.qty || it.qty_total_pcs || 0);
      const unitLabel = isVU
        ? [c>0?`${c}C`:"", b>0?`${b}B`:"", p>0?`${p}P`:""].filter(Boolean).join(" + ")
        : `${qty} pcs`;
      const price = parseFloat(it.piece_sale_price || it.Price || 0);
      const unitType = detectUnitLabel(it);
      const rowBg = ii % 2 === 0 ? "#fff" : "#f8fafc";
      return `<tr style="background:${rowBg}">
        <td>${it.ItemName || it.Barcode}</td>
        <td style="text-align:center">${it.Category||"—"}</td>
        <td style="text-align:center;font-weight:700;color:#1d4ed8">${unitLabel}</td>
        <td style="text-align:center;color:#666">${unitType}</td>
        <td style="text-align:right">PKR ${fmt(price)}/pc</td>
        <td style="text-align:right;font-weight:700;color:#059669">PKR ${fmt(it._lineTotal)}</td>
      </tr>`;
    }).join("");

    const unitSummary = [
      custCottons > 0 ? `<span style="background:#f3e8ff;color:#7c3aed;border:1px solid #ddd6fe;border-radius:8px;padding:3px 10px;font-weight:700;font-size:12px">${custCottons} Cotton${custCottons>1?"s":""}</span>` : "",
      custBoxes   > 0 ? `<span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:8px;padding:3px 10px;font-weight:700;font-size:12px">${custBoxes} Box${custBoxes>1?"es":""}</span>` : "",
      custPieces  > 0 ? `<span style="background:#fff7ed;color:#ea580c;border:1px solid #fed7aa;border-radius:8px;padding:3px 10px;font-weight:700;font-size:12px">${custPieces} Pcs</span>` : "",
    ].filter(Boolean).join("&nbsp;&nbsp;");

    return `
      <div style="margin-bottom:28px;border:1px solid #d1dce8;border-radius:10px;overflow:hidden;page-break-inside:avoid">
        <div style="background:#1e3a5f;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:15px;font-weight:800;letter-spacing:0.5px">${ci+1}. ${cust.name}</div>
            <div style="font-size:11px;opacity:0.8;margin-top:2px">📞 ${cust.cell}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;opacity:0.7">${cust.items.length} item line${cust.items.length>1?"s":""}</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead>
            <tr style="background:#f0f4f8">
              <th style="padding:8px 10px;text-align:left;color:#1e3a5f;font-size:10px;letter-spacing:1px;text-transform:uppercase">Item Name</th>
              <th style="padding:8px 10px;text-align:center;color:#1e3a5f;font-size:10px;letter-spacing:1px;text-transform:uppercase">Category</th>
              <th style="padding:8px 10px;text-align:center;color:#1e3a5f;font-size:10px;letter-spacing:1px;text-transform:uppercase">Quantity</th>
              <th style="padding:8px 10px;text-align:center;color:#1e3a5f;font-size:10px;letter-spacing:1px;text-transform:uppercase">Unit Type</th>
              <th style="padding:8px 10px;text-align:right;color:#1e3a5f;font-size:10px;letter-spacing:1px;text-transform:uppercase">Unit Price</th>
              <th style="padding:8px 10px;text-align:right;color:#1e3a5f;font-size:10px;letter-spacing:1px;text-transform:uppercase">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="padding:12px 16px;background:#f8fafc;border-top:2px solid #1e3a5f;display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="font-size:11px;color:#666;font-weight:600">Load:</span>
            ${unitSummary || '<span style="color:#999;font-size:11px">—</span>'}
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:#666">Amount to Collect</div>
            <div style="font-size:18px;font-weight:900;color:#c00;font-family:monospace">PKR ${fmt(cust.total)}</div>
          </div>
        </div>
      </div>`;
  }).join("");

  // ── Grand Summary Section ─────────────────────────────────────────────────
  const catRows = Object.entries(catBreakdown).sort((a,b)=>b[1].amount-a[1].amount).map(([cat,d],i)=>`
    <tr style="background:${i%2===0?"#fff":"#f8fafc"}">
      <td style="padding:8px 12px;font-weight:600">${cat}</td>
      <td style="padding:8px 12px;text-align:center;color:#7c3aed;font-weight:700">${d.cottons||0}</td>
      <td style="padding:8px 12px;text-align:center;color:#1d4ed8;font-weight:700">${d.boxes||0}</td>
      <td style="padding:8px 12px;text-align:center;color:#ea580c;font-weight:700">${d.pieces||0}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700;color:#059669">PKR ${fmt(d.amount)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Load Form — Mian Traders</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;font-size:12px;color:#222;background:#fff;padding:20px}
    @media print{body{padding:10px}@page{margin:1cm}}
    .page-break{page-break-before:always}
  </style></head><body>

  <!-- Header -->
  <div style="text-align:center;margin-bottom:20px;padding:16px;background:#1e3a5f;border-radius:10px;color:#fff">
    <div style="font-size:22px;font-weight:900;letter-spacing:1px">🚚 LOAD FORM — MIAN TRADERS</div>
    <div style="font-size:12px;opacity:0.8;margin-top:4px">Generated: ${now} &nbsp;·&nbsp; Period: ${dateRange} &nbsp;·&nbsp; Category: ${filterCat} &nbsp;·&nbsp; Customers: ${customers.length}</div>
  </div>

  <!-- Customer Sections -->
  ${custSections}

  <!-- Grand Summary -->
  <div class="page-break"></div>
  <div style="border:2px solid #1e3a5f;border-radius:12px;overflow:hidden;margin-top:24px">
    <div style="background:#1e3a5f;color:#fff;padding:14px 18px;font-size:16px;font-weight:800;letter-spacing:0.5px">
      📊 GRAND SUMMARY — FULL LOAD
    </div>

    <!-- 3 summary boxes -->
    <div style="display:flex;gap:16px;padding:16px;background:#f8fafc">
      <div style="flex:1;background:#f3e8ff;border:2px solid #ddd6fe;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:28px;font-weight:900;color:#7c3aed">${grandCottons}</div>
        <div style="font-size:11px;color:#7c3aed;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Total Cottons</div>
      </div>
      <div style="flex:1;background:#eff6ff;border:2px solid #bfdbfe;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:28px;font-weight:900;color:#1d4ed8">${grandBoxes}</div>
        <div style="font-size:11px;color:#1d4ed8;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Total Boxes</div>
      </div>
      <div style="flex:1;background:#fff7ed;border:2px solid #fed7aa;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:28px;font-weight:900;color:#ea580c">${grandPieces}</div>
        <div style="font-size:11px;color:#ea580c;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Total Pieces</div>
      </div>
    </div>

    <!-- Category breakdown -->
    <div style="padding:0 16px 16px">
      <div style="font-size:12px;font-weight:700;color:#1e3a5f;margin-bottom:8px;letter-spacing:1px;text-transform:uppercase">Category-wise Breakdown</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #d1dce8;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#1e3a5f;color:#fff">
            <th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:1px">CATEGORY</th>
            <th style="padding:9px 12px;text-align:center;font-size:10px;letter-spacing:1px">COTTONS</th>
            <th style="padding:9px 12px;text-align:center;font-size:10px;letter-spacing:1px">BOXES</th>
            <th style="padding:9px 12px;text-align:center;font-size:10px;letter-spacing:1px">PIECES</th>
            <th style="padding:9px 12px;text-align:right;font-size:10px;letter-spacing:1px">AMOUNT</th>
          </tr>
        </thead>
        <tbody>${catRows}</tbody>
      </table>
    </div>

    <!-- Grand total bar -->
    <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;padding:18px 20px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:13px;opacity:0.85;margin-bottom:4px">Full Load Summary</div>
        <div style="font-size:12px;opacity:0.75">${customers.length} Customers &nbsp;·&nbsp; ${grandCottons} Cottons &nbsp;·&nbsp; ${grandBoxes} Boxes &nbsp;·&nbsp; ${grandPieces} Pieces</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:12px;opacity:0.85;margin-bottom:2px">TOTAL TO COLLECT</div>
        <div style="font-size:26px;font-weight:900;letter-spacing:1px;font-family:monospace">PKR ${fmt(grandTotal)}</div>
      </div>
    </div>
  </div>

  <div style="text-align:center;font-size:10px;color:#aaa;margin-top:18px;border-top:1px solid #eee;padding-top:10px">
    itKINS POS System &nbsp;·&nbsp; Mian Traders Gujranwala &nbsp;·&nbsp; itkins.com | 0304-7414437
  </div>
  <script>window.onload=()=>window.print();</script>
  </body></html>`;

  const w = window.open("", "_blank", "width=960,height=800");
  if (!w) { alert("Allow popups to generate Load Form!"); return; }
  w.document.write(html);
  w.document.close();
}

// ── Generate Daily Sale PDF ───────────────────────────────────────────────────
function generateDailySalePDF(filtered, filterFrom, filterTo, filterCashier, filterCat) {
  const now       = new Date().toLocaleString("en-PK");
  const dateRange = filterFrom && filterTo ? `${filterFrom} to ${filterTo}` :
                    filterFrom ? `From ${filterFrom}` : filterTo ? `To ${filterTo}` : "All Dates";

  if (filtered.length === 0) { alert("No sales data for the selected filters."); return; }

  const totalRev   = filtered.reduce((s,r) => s + parseFloat(r.GrandTotal||0), 0);
  const totalDisc  = filtered.reduce((s,r) => s + parseFloat(r.Discount||0), 0);
  const cashSales  = filtered.filter(s => s.PaymentMethod !== "Credit");
  const creditSales= filtered.filter(s => s.PaymentMethod === "Credit");
  const cashRev    = cashSales.reduce((s,r) => s + parseFloat(r.GrandTotal||0), 0);
  const creditRev  = creditSales.reduce((s,r) => s + parseFloat(r.GrandTotal||0), 0);

  // ── Item-level aggregation with VU breakdown ──────────────────────────────
  const itemAgg = {}; // barcode -> {name, cat, cottons, boxes, pieces, revenue}
  const catAgg  = {}; // category -> {cottons, boxes, pieces, revenue, bills}

  filtered.forEach(sale => {
    const saleItems = safeParseItems(sale.ItemsDetail);
    saleItems.forEach(it => {
      if (filterCat !== "All" && it.Category !== filterCat) return;
      const bc   = it.Barcode || it.ItemName;
      const cat  = it.Category || "General";
      const isVU = vuEnabled(it);
      const c    = parseInt(it.qty_cottons||0);
      const b    = parseInt(it.qty_boxes  ||0);
      const p    = parseInt(it.qty_pieces ||0);
      const qty  = parseInt(it.qty || it.qty_total_pcs || 0);
      const price= parseFloat(it.piece_sale_price||it.Price||0);
      const disc = parseFloat(it.Discount||0);
      const lt   = qty*price - disc*qty;

      if (!itemAgg[bc]) itemAgg[bc] = { name:it.ItemName||bc, cat, cottons:0, boxes:0, pieces:0, totalQty:0, revenue:0, isVU };
      itemAgg[bc].cottons  += isVU ? c : 0;
      itemAgg[bc].boxes    += isVU ? b : 0;
      itemAgg[bc].pieces   += isVU ? p : qty;
      itemAgg[bc].totalQty += qty;
      itemAgg[bc].revenue  += lt;

      if (!catAgg[cat]) catAgg[cat] = { cottons:0, boxes:0, pieces:0, revenue:0, qty:0 };
      catAgg[cat].cottons  += isVU ? c : 0;
      catAgg[cat].boxes    += isVU ? b : 0;
      catAgg[cat].pieces   += isVU ? p : qty;
      catAgg[cat].revenue  += lt;
      catAgg[cat].qty      += qty;
    });
  });

  // Totals
  let grandCottons=0, grandBoxes=0, grandPieces=0;
  Object.values(itemAgg).forEach(v=>{ grandCottons+=v.cottons; grandBoxes+=v.boxes; grandPieces+=v.pieces; });

  // ── Bill rows ─────────────────────────────────────────────────────────────
  const billRows = [...filtered].reverse().map((sale,i) => {
    const isCredit = sale.PaymentMethod==="Credit";
    const custName = (sale.CustomerName&&sale.CustomerName!=="Unknown"&&sale.CustomerName.trim()!=="") ? sale.CustomerName : "Walk-in";
    const rowBg    = i%2===0?"#fff":"#f7f9fc";
    return `<tr style="background:${rowBg}">
      <td style="padding:6px 10px;font-weight:700;color:#1d4ed8">#${sale.BillNo}</td>
      <td style="padding:6px 10px">${sale.Date}</td>
      <td style="padding:6px 10px">${sale.Time}</td>
      <td style="padding:6px 10px">${sale.Cashier}</td>
      <td style="padding:6px 10px;color:${isCredit?"#ea580c":"#475569"};font-weight:${isCredit?700:400}">${custName}</td>
      <td style="padding:6px 10px;text-align:right;font-weight:700;color:#059669">PKR ${fmt(sale.GrandTotal)}</td>
      <td style="padding:6px 10px;text-align:center">
        <span style="background:${isCredit?"#fff7ed":"#ecfdf5"};color:${isCredit?"#ea580c":"#059669"};border:1px solid ${isCredit?"#fed7aa":"#a7f3d0"};border-radius:8px;padding:2px 8px;font-size:10px;font-weight:700">${sale.PaymentMethod}</span>
      </td>
    </tr>`;
  }).join("");

  // ── Item summary rows ─────────────────────────────────────────────────────
  const itemRows = Object.values(itemAgg).sort((a,b)=>b.revenue-a.revenue).map((it,i) => {
    const qtyDisplay = it.isVU
      ? [it.cottons>0?`${it.cottons}C`:"", it.boxes>0?`${it.boxes}B`:"", it.pieces>0?`${it.pieces}P`:""].filter(Boolean).join(" + ") || `${it.totalQty} pcs`
      : `${it.totalQty} pcs`;
    const rowBg = i%2===0?"#fff":"#f8fafc";
    return `<tr style="background:${rowBg}">
      <td style="padding:7px 12px;font-weight:600">${it.name}</td>
      <td style="padding:7px 12px;color:#666">${it.cat}</td>
      <td style="padding:7px 12px;text-align:center;font-weight:700;color:#1d4ed8">${qtyDisplay}</td>
      <td style="padding:7px 12px;text-align:right;font-weight:700;color:#059669">PKR ${fmt(it.revenue)}</td>
    </tr>`;
  }).join("");

  // ── Category breakdown rows ───────────────────────────────────────────────
  const catRows = Object.entries(catAgg).sort((a,b)=>b[1].revenue-a[1].revenue).map(([cat,d],i) => {
    const rowBg = i%2===0?"#fff":"#f8fafc";
    return `<tr style="background:${rowBg}">
      <td style="padding:7px 12px;font-weight:600">${cat}</td>
      <td style="padding:7px 12px;text-align:center;color:#7c3aed;font-weight:700">${d.cottons||"—"}</td>
      <td style="padding:7px 12px;text-align:center;color:#1d4ed8;font-weight:700">${d.boxes||"—"}</td>
      <td style="padding:7px 12px;text-align:center;color:#ea580c;font-weight:700">${d.pieces||"—"}</td>
      <td style="padding:7px 12px;text-align:right;font-weight:700;color:#059669">PKR ${fmt(d.revenue)}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Daily Sale Report — Mian Traders</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;font-size:12px;color:#222;background:#fff;padding:20px}
    table{width:100%;border-collapse:collapse}
    thead th{background:#1e3a5f;color:#fff;padding:9px 10px;text-align:left;font-size:10px;letter-spacing:0.8px;text-transform:uppercase}
    tbody td{border-bottom:1px solid #eaecef}
    .section{margin-bottom:24px}
    .section-title{font-size:13px;font-weight:800;color:#1e3a5f;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;padding:8px 12px;background:#f0f4f8;border-left:4px solid #1e3a5f;border-radius:0 6px 6px 0}
    @media print{body{padding:10px}@page{margin:1cm}}
  </style></head><body>

  <!-- Header -->
  <div style="text-align:center;margin-bottom:20px;padding:16px;background:#1e3a5f;border-radius:10px;color:#fff">
    <div style="font-size:22px;font-weight:900;letter-spacing:1px">📊 DAILY SALE REPORT — MIAN TRADERS</div>
    <div style="font-size:12px;opacity:0.8;margin-top:4px">Generated: ${now} &nbsp;·&nbsp; Period: ${dateRange} &nbsp;·&nbsp; Cashier: ${filterCashier} &nbsp;·&nbsp; Category: ${filterCat}</div>
  </div>

  <!-- Summary Cards -->
  <div style="display:flex;gap:12px;margin-bottom:20px">
    <div style="flex:1;background:#eff6ff;border:2px solid #bfdbfe;border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#1d4ed8">PKR ${fmt(totalRev)}</div>
      <div style="font-size:10px;color:#1d4ed8;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Total Revenue</div>
    </div>
    <div style="flex:1;background:#ecfdf5;border:2px solid #a7f3d0;border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#059669">PKR ${fmt(cashRev)}</div>
      <div style="font-size:10px;color:#059669;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Cash Sales (${cashSales.length})</div>
    </div>
    <div style="flex:1;background:#fff7ed;border:2px solid #fed7aa;border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#ea580c">PKR ${fmt(creditRev)}</div>
      <div style="font-size:10px;color:#ea580c;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Credit Sales (${creditSales.length})</div>
    </div>
    <div style="flex:1;background:#fffbeb;border:2px solid #fde68a;border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#d97706">PKR ${fmt(totalDisc)}</div>
      <div style="font-size:10px;color:#d97706;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Total Discounts</div>
    </div>
    <div style="flex:1;background:#f3e8ff;border:2px solid #ddd6fe;border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#7c3aed">${filtered.length}</div>
      <div style="font-size:10px;color:#7c3aed;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Total Bills</div>
    </div>
  </div>

  <!-- VU Summary row if any -->
  ${(grandCottons+grandBoxes+grandPieces)>0 ? `
  <div style="display:flex;gap:12px;margin-bottom:20px">
    ${grandCottons>0?`<div style="flex:1;background:#f3e8ff;border:2px solid #ddd6fe;border-radius:10px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:900;color:#7c3aed">${grandCottons}</div><div style="font-size:10px;color:#7c3aed;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:3px">Cottons</div></div>`:""}
    ${grandBoxes>0?`<div style="flex:1;background:#eff6ff;border:2px solid #bfdbfe;border-radius:10px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:900;color:#1d4ed8">${grandBoxes}</div><div style="font-size:10px;color:#1d4ed8;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:3px">Boxes</div></div>`:""}
    ${grandPieces>0?`<div style="flex:1;background:#fff7ed;border:2px solid #fed7aa;border-radius:10px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:900;color:#ea580c">${grandPieces}</div><div style="font-size:10px;color:#ea580c;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:3px">Pieces</div></div>`:""}
  </div>` : ""}

  <!-- Bills Table -->
  <div class="section">
    <div class="section-title">📋 Bill-by-Bill Breakdown (${filtered.length} bills)</div>
    <table>
      <thead><tr>
        <th>Bill#</th><th>Date</th><th>Time</th><th>Cashier</th><th>Customer</th>
        <th style="text-align:right">Amount</th><th style="text-align:center">Payment</th>
      </tr></thead>
      <tbody>${billRows}</tbody>
    </table>
  </div>

  <!-- Item Summary -->
  <div class="section">
    <div class="section-title">📦 Item-wise Summary</div>
    <table>
      <thead><tr>
        <th>Item Name</th><th>Category</th><th style="text-align:center">Quantity</th><th style="text-align:right">Revenue</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>

  <!-- Category Breakdown -->
  <div class="section">
    <div class="section-title">🏷 Category-wise Breakdown</div>
    <table>
      <thead><tr>
        <th>Category</th><th style="text-align:center">Cottons</th><th style="text-align:center">Boxes</th><th style="text-align:center">Pieces</th><th style="text-align:right">Amount</th>
      </tr></thead>
      <tbody>${catRows}</tbody>
    </table>
  </div>

  <!-- Grand Total Bar -->
  <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;padding:18px 22px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-top:10px">
    <div>
      <div style="font-size:13px;opacity:0.85;margin-bottom:4px">Daily Sale Summary</div>
      <div style="font-size:12px;opacity:0.75">${filtered.length} Bills &nbsp;·&nbsp; ${cashSales.length} Cash &nbsp;·&nbsp; ${creditSales.length} Credit &nbsp;·&nbsp; Disc: PKR ${fmt(totalDisc)}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:12px;opacity:0.85;margin-bottom:2px">GRAND TOTAL REVENUE</div>
      <div style="font-size:28px;font-weight:900;letter-spacing:1px;font-family:monospace">PKR ${fmt(totalRev)}</div>
    </div>
  </div>

  <div style="text-align:center;font-size:10px;color:#aaa;margin-top:18px;border-top:1px solid #eee;padding-top:10px">
    itKINS POS System &nbsp;·&nbsp; Mian Traders Gujranwala &nbsp;·&nbsp; itkins.com | 0304-7414437
  </div>
  <script>window.onload=()=>window.print();</script>
  </body></html>`;

  const w = window.open("", "_blank", "width=960,height=800");
  if (!w) { alert("Allow popups to generate Daily Sale report!"); return; }
  w.document.write(html);
  w.document.close();
}


// ── SALES TAB ─────────────────────────────────────────────────────────────────
export function SalesTab({ sales, setSales, customers, returns, safeCallScript, items }) {
  const [filterFrom,    setFilterFrom]    = useState("");
  const [filterTo,      setFilterTo]      = useState("");
  const [filterCashier, setFilterCashier] = useState("All");
  const [filterCat,     setFilterCat]     = useState("All");
  const [viewBill,      setViewBill]      = useState(null);
  const [editItems,     setEditItems]     = useState(null);
  const [saving,        setSaving]        = useState(false);

  const cashierList  = [...new Set(sales.map(s => s.Cashier).filter(Boolean))];
  const categoryList = [...new Set((items||[]).map(i => i.Category).filter(Boolean))].sort();
  const filtered = sales.filter(s => {
    if (!dateInRange(s.Date, filterFrom, filterTo)) return false;
    if (filterCashier !== "All" && s.Cashier !== filterCashier) return false;
    return true;
  });
  const totalRev  = filtered.reduce((s, r) => s + parseFloat(r.GrandTotal||0), 0);
  const totalDisc = filtered.reduce((s, r) => s + parseFloat(r.Discount||0), 0);

  const getRefundForBill = sale => ({ amount: parseFloat(sale.RefundApplied||0), returnNo: sale.RefundReturnNo||"" });

  const getPrevPending = sale => {
    if (sale.PaymentMethod !== "Credit" || !sale.CustomerCell) return 0;
    const c = (customers||[]).find(cx => cx.CellNo === sale.CustomerCell);
    if (!c) return 0;
    const billNos  = (c.BillNo||"").split(",").filter(Boolean).map(b => b.trim());
    const thisNorm = normBill(sale.BillNo);
    const creditBefore = billNos.reduce((sum, bn) => {
      if (normBill(bn) === thisNorm) return sum;
      const s = sales.find(s2 => normBill(s2.BillNo) === normBill(bn));
      if (!s || s.PaymentMethod !== "Credit") return sum;
      return sum + parseFloat(s.GrandTotal||0);
    }, 0);
    const totalPaid = (c.payments||[]).reduce((sum, p) => sum + parseFloat(p.amount||0), 0);
    return Math.max(0, creditBefore + parseFloat(c.openingDebit||0) - totalPaid);
  };

  const openBill  = sale => { setViewBill(sale); setEditItems(null); };
  const startEdit = ()   => { setEditItems(safeParseItems(viewBill.ItemsDetail).map(it => ({ ...it }))); };

  // Update a field on one editItems row; recalc VU qty automatically
  const updateField = (idx, field, rawVal) => {
    setEditItems(prev => {
      const next = prev.map((it, i) => i !== idx ? it : (() => {
        const val  = Math.max(0, parseInt(rawVal)||0);
        const item = { ...it, [field]: val };
        if (vuEnabled(item)) {
          const ppb = parseInt(item.pieces_per_box)||1;
          const bpc = parseInt(item.boxes_per_cotton)||1;
          const c = field === "qty_cottons" ? val : parseInt(item.qty_cottons)||0;
          const b = field === "qty_boxes"   ? val : parseInt(item.qty_boxes)  ||0;
          const p = field === "qty_pieces"  ? val : parseInt(item.qty_pieces) ||0;
          const total = c*ppb*bpc + b*ppb + p;
          return { ...item, qty_cottons: c, qty_boxes: b, qty_pieces: p, qty: total, qty_total_pcs: total };
        }
        if (field === "qty") return { ...item, qty: val };
        return item;
      })());
      return next;
    });
  };

  // Live grand total preview while editing
  const previewTotal = editItems ? (() => {
    const sub  = editItems.reduce((s, i) => s + parseFloat(i.piece_sale_price||i.Price||0)*(parseInt(i.qty)||0), 0);
    const iDisc= editItems.reduce((s, i) => s + parseFloat(i.Discount||0)*(parseInt(i.qty)||0), 0);
    const bDisc= Math.max(0, parseFloat(viewBill.Discount||0) - iDisc);
    const ref  = parseFloat(viewBill.RefundApplied||0);
    return Math.max(0, sub - iDisc - bDisc - ref);
  })() : 0;

  const saveItemEdit = async () => {
    if (!viewBill || !editItems) return;
    setSaving(true);
    const sub   = editItems.reduce((s, i) => s + parseFloat(i.piece_sale_price||i.Price||0)*(parseInt(i.qty)||0), 0);
    const iDisc = editItems.reduce((s, i) => s + parseFloat(i.Discount||0)*(parseInt(i.qty)||0), 0);
    const bDisc = Math.max(0, parseFloat(viewBill.Discount||0) - iDisc);
    const ref   = parseFloat(viewBill.RefundApplied||0);
    const newGT = Math.max(0, sub - iDisc - bDisc - ref);
    const newID = JSON.stringify(editItems);
    const updated = { ...viewBill, ItemsDetail: newID, GrandTotal: newGT };
    setSales(prev => prev.map(s => normBill(s.BillNo) === normBill(viewBill.BillNo) ? updated : s));
    if (safeCallScript) await safeCallScript({ action: "editSale", ...updated });
    setViewBill(updated); setEditItems(null); setSaving(false);
  };

  const reprintBill = sale => {
    const items         = safeParseItems(sale.ItemsDetail);
    const subTotal      = items.reduce((s, i) => s + parseFloat(i.Price||0)*(parseInt(i.qty)||1), 0);
    const itemDiscount  = items.reduce((s, i) => s + parseFloat(i.Discount||0)*(parseInt(i.qty)||1), 0);
    const totalDiscount = parseFloat(sale.Discount||0);
    const grandTotal    = parseFloat(sale.GrandTotal||0);
    const isCredit      = sale.PaymentMethod === "Credit";
    const refundInfo    = getRefundForBill(sale);
    printReceipt({ billNo:sale.BillNo, date:sale.Date, time:sale.Time, cashier:sale.Cashier, items, subTotal, totalDiscount, itemDiscount, billDiscount:Math.max(0,totalDiscount-itemDiscount), billDiscountPct:0, grandTotal, payments:isCredit?[]:[{type:"cash",amount:grandTotal,last4:""}], change:0, customerName:sale.CustomerName||"", customerCell:sale.CustomerCell||"", refundApplied:refundInfo.amount, refundReturnNo:refundInfo.returnNo, prevPending:isCredit?getPrevPending(sale):0 }, true);
  };

  // Always-fixed info cell
  const infoCell = (label, value, color = T.textPrimary) => (
    <div style={{ background:T.bgCardAlt, border:`1px solid ${T.borderLight}`, borderRadius:8, padding:"9px 12px", flex:1 }}>
      <div style={{ color:T.accent, fontSize:10, letterSpacing:1, marginBottom:3, fontWeight:700, textTransform:"uppercase" }}>{label}</div>
      <div style={{ color, fontSize:13, fontWeight:600 }}>{value||"—"}</div>
    </div>
  );

  // Small qty input for editing
  const qtyInput = (idx, field, value, color) => (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
      <span style={{ fontSize:9, color, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>{field === "qty" ? "Qty" : field === "qty_cottons" ? "Cotton" : field === "qty_boxes" ? "Box" : "Piece"}</span>
      <input type="number" min="0" value={value}
        onChange={e => updateField(idx, field, e.target.value)}
        onFocus={e => e.target.select()}
        style={{ width:52, padding:"4px 4px", background:T.bgCard, border:`1.5px solid ${color}`, borderRadius:6, color:T.textPrimary, fontSize:13, fontWeight:700, textAlign:"center", outline:"none" }} />
    </div>
  );

  return (
    <div>
      {/* ── Bill popup ── */}
      {viewBill && (
        <div style={{position:"fixed",inset:0,background:T.bgOverlay,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>{ if(!editItems){ setViewBill(null); }}}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:16,padding:24,maxWidth:640,width:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:T.shadowLg}}>

            {/* Header row */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <div style={{fontFamily:"Orbitron",color:T.accent,fontSize:18,fontWeight:900}}>Bill #{viewBill.BillNo}</div>
              <div style={{display:"flex",gap:8}}>
                {!editItems && (
                  <button className="btn" onClick={startEdit} style={{padding:"7px 16px",background:T.accentLight,border:`1px solid ${T.accentBorder}`,color:T.accent,borderRadius:7,fontSize:12,fontWeight:700}}>✏️ Edit Items</button>
                )}
                {editItems && (<>
                  <button className="btn" onClick={saveItemEdit} disabled={saving} style={{padding:"7px 16px",background:"linear-gradient(135deg,#047857,#059669)",border:"none",color:"#fff",borderRadius:7,fontSize:12,fontWeight:700}}>{saving?"⟳ Saving…":"💾 Save"}</button>
                  <button className="btn" onClick={()=>setEditItems(null)} style={{padding:"7px 14px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,borderRadius:7,fontSize:12}}>Cancel</button>
                </>)}
                <button className="btn" onClick={()=>{setViewBill(null);setEditItems(null);}} style={{padding:"7px 12px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,borderRadius:7,fontSize:13,fontWeight:700}}>✕ Close</button>
              </div>
            </div>

            {/* Info rows — always fixed */}
            <div style={{display:"flex",gap:9,marginBottom:9,flexWrap:"wrap"}}>
              {infoCell("Date",    viewBill.Date)}
              {infoCell("Time",    viewBill.Time)}
              {infoCell("Cashier", viewBill.Cashier)}
              {infoCell("Payment", viewBill.PaymentMethod, viewBill.PaymentMethod==="Credit"?T.posOrange:T.success)}
            </div>
            <div style={{display:"flex",gap:9,marginBottom:16,flexWrap:"wrap"}}>
              {infoCell("Customer", (viewBill.CustomerName&&viewBill.CustomerName!=="Unknown"&&viewBill.CustomerName.trim()!=="")?viewBill.CustomerName:"Walk-in")}
              {infoCell("Cell #",   viewBill.CustomerCell||"—")}
            </div>

            {/* Edit mode notice */}
            {editItems && (
              <div style={{padding:"8px 13px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,marginBottom:12,fontSize:11,color:"#92400e",fontWeight:600}}>
                ✏️ Edit mode — adjust quantities below. Grand Total will recalculate automatically.
              </div>
            )}

            {/* Items */}
            {(()=>{
              const displayItems = editItems || safeParseItems(viewBill.ItemsDetail);
              if (!displayItems.length) return <div style={{color:T.textMuted,fontSize:12,textAlign:"center",padding:16}}>No item detail available.</div>;
              const grouped = {};
              displayItems.forEach((it, idx) => {
                const c = it.Category||"Items";
                if (!grouped[c]) grouped[c] = [];
                grouped[c].push({ ...it, _idx: idx });
              });
              return <div>{Object.keys(grouped).sort().map(cat=>(
                <div key={cat} style={{marginBottom:12}}>
                  <div style={{color:T.accent,fontSize:10,letterSpacing:2,fontWeight:700,marginBottom:6,padding:"4px 10px",background:T.accentLight,borderRadius:6,border:`1px solid ${T.accentBorder}`}}>{cat.toUpperCase()}</div>
                  {grouped[cat].map((item)=>{
                    const idx    = item._idx;
                    const isVU   = vuEnabled(item);
                    const price  = parseFloat(item.piece_sale_price||item.Price||0);
                    const disc   = parseFloat(item.Discount||0);
                    const qty    = parseInt(item.qty||item.qty_total_pcs||0);
                    const lt     = qty*price - disc*qty;
                    const cottons= parseInt(item.qty_cottons||0);
                    const boxes  = parseInt(item.qty_boxes||0);
                    const pieces = parseInt(item.qty_pieces||0);
                    return(
                      <div key={idx} style={{padding:"10px 12px",background:T.bgCardAlt,border:`1px solid ${editItems?"#bfdbfe":T.borderLight}`,borderRadius:8,marginBottom:5,transition:"border-color 0.15s"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                          <div style={{flex:1}}>
                            <div style={{color:T.textPrimary,fontSize:13,fontWeight:700}}>
                              {item.ItemName||item.Barcode}
                              {isVU&&<span style={{background:"#f3e8ff",color:"#7c3aed",border:"1px solid #ddd6fe",borderRadius:8,fontSize:9,padding:"1px 6px",fontWeight:700,marginLeft:7}}>📦 VU</span>}
                            </div>

                            {/* Qty controls — edit mode */}
                            {editItems ? (
                              <div style={{display:"flex",gap:8,marginTop:8,alignItems:"center",flexWrap:"wrap"}}>
                                {isVU ? (<>
                                  {qtyInput(idx,"qty_cottons",cottons,"#7c3aed")}
                                  <span style={{color:T.textMuted,fontSize:14,marginTop:12}}>+</span>
                                  {qtyInput(idx,"qty_boxes",boxes,T.accent)}
                                  <span style={{color:T.textMuted,fontSize:14,marginTop:12}}>+</span>
                                  {qtyInput(idx,"qty_pieces",pieces,T.posOrange)}
                                  <div style={{marginTop:12,fontSize:11,color:T.textMuted}}>= {qty} pcs</div>
                                </>) : (
                                  qtyInput(idx,"qty",qty,T.accent)
                                )}
                              </div>
                            ) : (<>
                              {/* View mode — badges for VU */}
                              {isVU&&qty>0&&(
                                <div style={{display:"flex",gap:5,marginTop:4,flexWrap:"wrap"}}>
                                  {cottons>0&&<span style={{background:"#f3e8ff",color:"#7c3aed",border:"1px solid #ddd6fe",borderRadius:8,fontSize:11,padding:"2px 8px",fontWeight:700}}>{cottons} Cotton</span>}
                                  {boxes>0&&<span style={{background:T.accentLight,color:T.accent,border:`1px solid ${T.accentBorder}`,borderRadius:8,fontSize:11,padding:"2px 8px",fontWeight:700}}>{boxes} Box</span>}
                                  {pieces>0&&<span style={{background:"#fff7ed",color:T.posOrange,border:"1px solid #fed7aa",borderRadius:8,fontSize:11,padding:"2px 8px",fontWeight:700}}>{pieces} Pcs</span>}
                                </div>
                              )}
                            </>)}

                            <div style={{color:T.textMuted,fontSize:11,marginTop:4}}>
                              {isVU?`${qty} pcs × PKR ${fmt(price)}/pc`:`${qty} × PKR ${fmt(price)}`}
                              {disc>0?` · Disc: PKR ${fmt(disc*qty)}`:""}
                            </div>
                          </div>
                          <div style={{color:T.success,fontWeight:800,fontSize:14,whiteSpace:"nowrap"}}>PKR {fmt(lt)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}</div>;
            })()}

            {/* Totals footer */}
            <div style={{borderTop:`1px solid ${T.border}`,marginTop:14,paddingTop:14}}>
              {parseFloat(viewBill.Discount)>0&&<div style={{display:"flex",justifyContent:"space-between",color:T.posGold,fontSize:12,marginBottom:5}}><span>Total Discount</span><span>− PKR {fmt(viewBill.Discount)}</span></div>}
              {(()=>{const r=getRefundForBill(viewBill);if(r.amount<=0)return null;return(<div style={{display:"flex",justifyContent:"space-between",color:T.posOrange,fontSize:12,marginBottom:5,fontWeight:600}}><span>↩ Refund {r.returnNo?`(${r.returnNo})`:""}</span><span>− PKR {fmt(r.amount)}</span></div>);})()}
              {viewBill.PaymentMethod==="Credit"&&(()=>{const prev=getPrevPending(viewBill);if(prev<=0)return null;return(<div style={{display:"flex",justifyContent:"space-between",color:T.posOrange,fontSize:12,marginBottom:5}}><span>Previous Balance</span><span>PKR {fmt(prev)}</span></div>);})()}

              {/* Live recalculated total preview in edit mode */}
              {editItems && (
                <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,marginBottom:8,padding:"8px 12px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8}}>
                  <span style={{color:"#92400e",fontSize:13}}>New Total (preview)</span>
                  <span style={{color:"#92400e",fontSize:16,fontFamily:"Orbitron"}}>PKR {fmt(previewTotal)}</span>
                </div>
              )}

              <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,marginTop:4,padding:"10px 14px",background:T.accentLight,border:`1px solid ${T.accentBorder}`,borderRadius:9}}>
                <span style={{color:T.textPrimary,fontSize:15}}>GRAND TOTAL</span>
                <span style={{color:T.accent,fontSize:20,fontFamily:"Orbitron"}}>PKR {fmt(viewBill.GrandTotal)}</span>
              </div>
              {viewBill.PaymentMethod==="Credit"&&(()=>{const prev=getPrevPending(viewBill);if(prev<=0)return null;return(<div style={{display:"flex",justifyContent:"space-between",fontWeight:800,marginTop:9,padding:"10px 14px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,borderRadius:9}}><span style={{color:T.textPrimary,fontSize:13}}>TOTAL DEBIT (incl. previous)</span><span style={{color:T.danger,fontSize:16,fontFamily:"Orbitron"}}>PKR {fmt(parseFloat(viewBill.GrandTotal)+getPrevPending(viewBill))}</span></div>);})()}
            </div>
            <button className="btn" onClick={()=>reprintBill(viewBill)} style={{width:"100%",marginTop:16,padding:"12px",background:"linear-gradient(135deg,#1d4ed8,#2563eb)",color:"#fff",fontSize:13,borderRadius:9,fontWeight:700,boxShadow:"0 3px 10px rgba(37,99,235,0.3)"}}>🖨 Reprint This Bill</button>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div style={{display:"flex",gap:11,marginBottom:16,flexWrap:"wrap"}}>
        <SummaryCard icon="💰" label="Total Revenue"  value={`PKR ${fmt(totalRev)}`}  color={T.accent}    bg={T.accentLight}  border={T.accentBorder}  />
        <SummaryCard icon="🏷️" label="Total Discount" value={`PKR ${fmt(totalDisc)}`} color={T.warning}   bg={T.warningLight} border={T.warningBorder} />
        <SummaryCard icon="📒" label="Credit Sales"   value={filtered.filter(s=>s.PaymentMethod==="Credit").length} color={T.posOrange} bg="#fff7ed" border="#fed7aa" />
        <SummaryCard icon="🧮" label="Total Bills"    value={filtered.length}          color={T.success}   bg={T.successLight} border={T.successBorder} />
      </div>

      {/* Filters + Buttons */}
      <div style={{display:"flex",gap:10,marginBottom:13,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><label style={{...lbSt,marginBottom:4}}>From Date</label><input type="date" value={filterFrom} onChange={e=>setFilterFrom(e.target.value)} style={{...inSt,maxWidth:160,background:T.bgCard}}/></div>
        <div><label style={{...lbSt,marginBottom:4}}>To Date</label><input type="date" value={filterTo} onChange={e=>setFilterTo(e.target.value)} style={{...inSt,maxWidth:160,background:T.bgCard}}/></div>
        <div><label style={{...lbSt,marginBottom:4}}>Cashier</label>
          <select value={filterCashier} onChange={e=>setFilterCashier(e.target.value)} style={{...slSt,background:T.bgCard}}>
            <option value="All">All Cashiers</option>{cashierList.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <div><label style={{...lbSt,marginBottom:4}}>Category</label>
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{...slSt,background:T.bgCard}}>
            <option value="All">All Categories</option>{categoryList.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn" onClick={()=>{setFilterFrom("");setFilterTo("");setFilterCashier("All");setFilterCat("All");}}
          style={{padding:"9px 14px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,borderRadius:7,fontSize:12}}>Clear</button>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <button className="btn" onClick={()=>generateLoadFormPDF(filtered,filterFrom,filterTo,filterCat,items||[])}
            disabled={filtered.length===0}
            style={{padding:"9px 18px",background:"linear-gradient(135deg,#1e3a5f,#2563eb)",color:"#fff",fontSize:12,fontWeight:700,borderRadius:7,border:"none",opacity:filtered.length===0?0.5:1}}>
            🚚 Load Form
          </button>
          <button className="btn" onClick={()=>generateDailySalePDF(filtered,filterFrom,filterTo,filterCashier,filterCat)}
            disabled={filtered.length===0}
            style={{padding:"9px 18px",background:"linear-gradient(135deg,#047857,#059669)",color:"#fff",fontSize:12,fontWeight:700,borderRadius:7,border:"none",opacity:filtered.length===0?0.5:1}}>
            📊 Daily Sale
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={card}>
        <div style={{display:"grid",gridTemplateColumns:"85px 95px 70px 110px 130px 100px 100px 120px",...thSt}}>
          <div>BILL#</div><div>DATE</div><div>TIME</div><div>CASHIER</div><div>CUSTOMER</div><div style={{textAlign:"right"}}>TOTAL</div><div>PAYMENT</div><div>CELL</div>
        </div>
        <div style={{maxHeight:420,overflowY:"auto"}}>
          {filtered.length===0
            ?<div style={{textAlign:"center",padding:40,color:T.textMuted,fontSize:13}}>💰 No sales in this range</div>
            :[...filtered].reverse().map((sale,i)=>{
              const isCredit=sale.PaymentMethod==="Credit";
              const custName=(sale.CustomerName&&sale.CustomerName!=="Unknown"&&sale.CustomerName.trim()!=="")?sale.CustomerName:"Walk-in";
              return(
                <div key={i} onClick={()=>openBill(sale)}
                  style={{display:"grid",gridTemplateColumns:"85px 95px 70px 110px 130px 100px 100px 120px",padding:"9px 12px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",cursor:"pointer",transition:"background 0.12s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{color:T.accent,fontWeight:700,fontSize:12}}>#{sale.BillNo}</div>
                  <div style={{color:T.textSecondary,fontSize:11}}>{sale.Date}</div>
                  <div style={{color:T.textSecondary,fontSize:11}}>{sale.Time}</div>
                  <div style={{color:T.textPrimary,fontSize:12}}>{sale.Cashier}</div>
                  <div style={{color:isCredit?T.posOrange:T.textMuted,fontSize:11,fontWeight:isCredit?700:400}}>{custName}</div>
                  <div style={{color:T.success,textAlign:"right",fontWeight:700,fontSize:12}}>PKR {fmt(sale.GrandTotal)}</div>
                  <div><span style={{background:isCredit?"#fff7ed":T.successLight,color:isCredit?T.posOrange:T.success,border:`1px solid ${isCredit?"#fed7aa":T.successBorder}`,borderRadius:8,padding:"2px 7px",fontSize:10,fontWeight:700}}>{sale.PaymentMethod}</span></div>
                  <div style={{color:T.textMuted,fontSize:10}}>{sale.CustomerCell||"—"}</div>
                </div>
              );
          })}
        </div>
      </div>
      <div style={{marginTop:7,color:T.textMuted,fontSize:11}}>{filtered.length} transactions · 👆 Click any row to view, edit items &amp; reprint</div>
    </div>
  );
}

// ── RETURNS TAB ───────────────────────────────────────────────────────────────
export function ReturnsTab({ returns }) {
  const [filterDate, setFilterDate] = useState("");
  const [viewRet,    setViewRet]    = useState(null);
  const filtered    = returns.filter(r => !filterDate || filterDateMatch(r.Date, filterDate));
  const totalRefund = filtered.reduce((s, r) => s + parseFloat(r.RefundAmount||0), 0);
  return (
    <div>
      <div style={{display:"flex",gap:11,marginBottom:16,flexWrap:"wrap"}}>
        <SummaryCard icon="↩"  label="Total Returns"  value={filtered.length}           color={T.posOrange} bg="#fff7ed"        border="#fed7aa"        />
        <SummaryCard icon="💸" label="Total Refunded" value={`PKR ${fmt(totalRefund)}`}  color={T.danger}    bg={T.dangerLight}  border={T.dangerBorder} />
      </div>
      <div style={{display:"flex",gap:12,marginBottom:13,alignItems:"flex-end"}}>
        <div><label style={{...lbSt,marginBottom:4}}>Filter by Date</label><input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{...inSt,maxWidth:180,background:T.bgCard}}/></div>
        <button className="btn" onClick={()=>setFilterDate("")} style={{padding:"9px 14px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,borderRadius:7,fontSize:12}}>Clear</button>
      </div>
      {viewRet&&(
        <div style={{position:"fixed",inset:0,background:T.bgOverlay,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setViewRet(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:16,padding:24,maxWidth:480,width:"100%",boxShadow:T.shadowLg}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <div style={{fontFamily:"Orbitron",color:T.posOrange,fontSize:15,fontWeight:700}}>Return #{viewRet.ReturnNo}</div>
              <button className="btn" onClick={()=>setViewRet(null)} style={{padding:"5px 11px",background:T.dangerLight,border:`1px solid ${T.dangerBorder}`,color:T.danger,fontSize:13,borderRadius:6,fontWeight:600}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {[["Orig Bill",viewRet.OrigBillNo],["Date",viewRet.Date],["Cashier",viewRet.Cashier],["Reason",viewRet.Reason]].map(([l,v])=>(
                <div key={l} style={{background:T.bgCardAlt,border:`1px solid ${T.borderLight}`,borderRadius:8,padding:"8px 12px"}}>
                  <div style={{color:T.posOrange,fontSize:10,fontWeight:700}}>{l}</div>
                  <div style={{color:T.textPrimary,fontSize:13,fontWeight:600}}>{v}</div>
                </div>
              ))}
            </div>
            {safeParseItems(viewRet.Items).map((item,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",background:T.bgCardAlt,border:`1px solid ${T.borderLight}`,borderRadius:7,marginBottom:4}}>
                <span style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{item.ItemName} × {item.qty}</span>
                <span style={{color:T.posOrange,fontWeight:700}}>PKR {fmt(item.qty*parseFloat(item.Price||0))}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",marginTop:14,padding:"12px 14px",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:9,fontWeight:700}}>
              <span style={{color:T.textPrimary,fontSize:15}}>REFUND AMOUNT</span>
              <span style={{color:T.posOrange,fontSize:18,fontFamily:"Orbitron"}}>PKR {fmt(viewRet.RefundAmount)}</span>
            </div>
            <button className="btn" onClick={()=>printReturnReceipt(viewRet)} style={{width:"100%",marginTop:13,padding:12,background:"linear-gradient(135deg,#c2410c,#ea580c)",color:"#fff",fontSize:13,borderRadius:9,fontWeight:700}}>🖨 Reprint Return Receipt</button>
          </div>
        </div>
      )}
      <div style={card}>
        <div style={{display:"grid",gridTemplateColumns:"90px 90px 95px 80px 110px 100px",...thSt}}>
          <div>RETURN#</div><div>ORIG BILL</div><div>DATE</div><div>TIME</div><div>CASHIER</div><div style={{textAlign:"right"}}>REFUND</div>
        </div>
        {filtered.length===0?<div style={{textAlign:"center",padding:40,color:T.textMuted,fontSize:13}}>↩ No returns yet</div>
        :[...filtered].reverse().map((r,i)=>(
          <div key={i} onClick={()=>setViewRet(r)}
            style={{display:"grid",gridTemplateColumns:"90px 90px 95px 80px 110px 100px",padding:"9px 12px",borderBottom:`1px solid ${T.borderLight}`,alignItems:"center",cursor:"pointer"}}
            onMouseEnter={e=>e.currentTarget.style.background=T.bgHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{color:T.posOrange,fontWeight:700,fontSize:12}}>{r.ReturnNo}</div>
            <div style={{color:T.accent,fontSize:12}}>#{r.OrigBillNo}</div>
            <div style={{color:T.textSecondary,fontSize:11}}>{r.Date}</div>
            <div style={{color:T.textSecondary,fontSize:11}}>{r.Time}</div>
            <div style={{color:T.textPrimary,fontSize:12}}>{r.Cashier}</div>
            <div style={{color:T.danger,textAlign:"right",fontWeight:700,fontSize:12}}>PKR {fmt(r.RefundAmount)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PROFIT TAB ────────────────────────────────────────────────────────────────
export function ProfitTab({ sales, items, returns }) {
  const [filterFrom,    setFilterFrom]    = useState("");
  const [filterTo,      setFilterTo]      = useState("");
  const [filterCashier, setFilterCashier] = useState("All");
  const [filterCat,     setFilterCat]     = useState("All");
  const cashierList = [...new Set(sales.map(s=>s.Cashier).filter(Boolean))];
  const categories  = [...new Set(items.map(i=>i.Category).filter(Boolean))].sort();
  const itemMap     = new Map(items.map(i=>[i.Barcode,i]));
  const filtered    = sales.filter(s=>dateInRange(s.Date,filterFrom,filterTo)&&(filterCashier==="All"||s.Cashier===filterCashier));
  let totalRevenue=0,totalCost=0,totalDiscount=0,totalRefund=0;
  const categoryProfit={},topItems={};
  filtered.forEach(sale=>{
    const si=safeParseItems(sale.ItemsDetail);
    si.forEach(si=>{
      if(filterCat!=="All"&&si.Category!==filterCat)return;
      const master=itemMap.get(si.Barcode);
      const sell=parseFloat(si.Price||0),cost=parseFloat(master?.CostPrice||si.CostPrice||0),disc=parseFloat(si.Discount||0),qty=parseInt(si.qty)||1;
      const revenue=(sell-disc)*qty,cst=cost*qty,profit=revenue-cst;
      totalRevenue+=revenue;totalCost+=cst;
      const cat=si.Category||"Unknown";
      if(!categoryProfit[cat])categoryProfit[cat]={revenue:0,cost:0,profit:0,qty:0};
      categoryProfit[cat].revenue+=revenue;categoryProfit[cat].cost+=cst;categoryProfit[cat].profit+=profit;categoryProfit[cat].qty+=qty;
      if(!topItems[si.Barcode])topItems[si.Barcode]={name:si.ItemName,revenue:0,profit:0,qty:0};
      topItems[si.Barcode].revenue+=revenue;topItems[si.Barcode].profit+=profit;topItems[si.Barcode].qty+=qty;
    });
    totalDiscount+=parseFloat(sale.Discount||0);
  });
  returns.filter(r=>dateInRange(r.Date,filterFrom,filterTo)).forEach(r=>{totalRefund+=parseFloat(r.RefundAmount||0);});
  const netRevenue=totalRevenue-totalRefund,netProfit=netRevenue-totalCost,margin=netRevenue>0?(netProfit/netRevenue*100).toFixed(1):0;
  const topList=Object.entries(topItems).sort((a,b)=>b[1].profit-a[1].profit).slice(0,10);
  return (
    <div>
      <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><label style={{...lbSt,marginBottom:4}}>From Date</label><input type="date" value={filterFrom} onChange={e=>setFilterFrom(e.target.value)} style={{...inSt,maxWidth:175,background:T.bgCard}}/></div>
        <div><label style={{...lbSt,marginBottom:4}}>To Date</label><input type="date" value={filterTo} onChange={e=>setFilterTo(e.target.value)} style={{...inSt,maxWidth:175,background:T.bgCard}}/></div>
        <div><label style={{...lbSt,marginBottom:4}}>Cashier</label><select value={filterCashier} onChange={e=>setFilterCashier(e.target.value)} style={{...slSt,background:T.bgCard}}><option value="All">All</option>{cashierList.map(c=><option key={c}>{c}</option>)}</select></div>
        <div><label style={{...lbSt,marginBottom:4}}>Category</label><select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{...slSt,background:T.bgCard}}><option value="All">All</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
        <button className="btn" onClick={()=>{setFilterFrom("");setFilterTo("");setFilterCashier("All");setFilterCat("All");}} style={{padding:"9px 14px",background:T.bgCardAlt,border:`1px solid ${T.border}`,color:T.textSecondary,borderRadius:7,fontSize:12}}>Clear</button>
      </div>
      {totalCost===0&&<div style={{background:T.warningLight,border:`1px solid ${T.warningBorder}`,borderRadius:10,padding:"13px 18px",marginBottom:16,color:T.warning,fontSize:12}}>⚠ Set Cost Price on items for accurate profit.</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:11,marginBottom:18}}>
        <SummaryCard icon="💰" label="Net Revenue"    value={`PKR ${fmt(netRevenue)}`}    color={T.accent}    bg={T.accentLight}  border={T.accentBorder}  />
        <SummaryCard icon="🏭" label="Total Cost"     value={`PKR ${fmt(totalCost)}`}     color={T.danger}    bg={T.dangerLight}  border={T.dangerBorder}  />
        <SummaryCard icon="📈" label="Net Profit"     value={`PKR ${fmt(netProfit)}`}     color={netProfit>=0?T.success:T.danger} bg={netProfit>=0?T.successLight:T.dangerLight} border={netProfit>=0?T.successBorder:T.dangerBorder} />
        <SummaryCard icon="%" label="Profit Margin"  value={`${margin}%`}                color={T.posGold}   bg="#fffbeb"        border="#fde68a"         />
        <SummaryCard icon="🏷" label="Total Discount" value={`PKR ${fmt(totalDiscount)}`} color="#7c3aed"     bg="#f5f3ff"        border="#ddd6fe"         />
        <SummaryCard icon="↩" label="Refunds"        value={`PKR ${fmt(totalRefund)}`}   color={T.posOrange} bg="#fff7ed"        border="#fed7aa"         />
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {[["PROFIT BY CATEGORY",Object.entries(categoryProfit).sort((a,b)=>b[1].profit-a[1].profit),([cat,data])=>
          <div style={{padding:"9px 14px",borderBottom:`1px solid ${T.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{cat}</div><div style={{color:T.textMuted,fontSize:10}}>Rev: PKR {fmt(data.revenue)} · Qty: {data.qty}</div></div>
            <div style={{textAlign:"right"}}><div style={{color:data.profit>=0?T.success:T.danger,fontWeight:700,fontSize:13}}>PKR {fmt(data.profit)}</div><div style={{color:T.textMuted,fontSize:10}}>{data.revenue>0?(data.profit/data.revenue*100).toFixed(1):0}%</div></div>
          </div>],
         ["TOP ITEMS BY PROFIT",topList,([bc,data])=>
          <div style={{padding:"9px 14px",borderBottom:`1px solid ${T.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{color:T.textPrimary,fontSize:12,fontWeight:600}}>{data.name||bc}</div><div style={{color:T.textMuted,fontSize:10}}>Sold: {data.qty} units</div></div>
            <div style={{textAlign:"right"}}><div style={{color:T.success,fontWeight:700,fontSize:13}}>PKR {fmt(data.profit)}</div><div style={{color:T.textMuted,fontSize:10}}>Rev: PKR {fmt(data.revenue)}</div></div>
          </div>]
        ].map(([title,list,renderRow])=>(
          <div key={title} style={card}>
            <div style={{padding:"10px 14px",...thSt,fontSize:10,letterSpacing:1.5}}>{title}</div>
            {list.length===0?<div style={{padding:20,color:T.textMuted,textAlign:"center",fontSize:12}}>No data</div>:list.map((entry,i)=><div key={i}>{renderRow(entry)}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}
