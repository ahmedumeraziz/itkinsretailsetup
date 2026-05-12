import { fmt, safeParseItems, getExpiryStatus, fmtExpiry } from "./helpers";

// ─── PRINT RECEIPT ────────────────────────────────────────────────────────────
export function printReceipt(bill) {
  const isCredit = !!(
    bill.customerName &&
    bill.customerName.trim() !== "" &&
    bill.customerName !== "Unknown"
  );

  // Group items by category
  const grouped = {};
  (bill.items || []).forEach(item => {
    const c = item.Category || "General";
    if (!grouped[c]) grouped[c] = [];
    grouped[c].push(item);
  });
  const cats = Object.keys(grouped).sort();

  let itemsHtml = "";
  cats.forEach(cat => {
    itemsHtml += `<div class="cat-hdr">── ${cat} ──</div>`;
    grouped[cat].forEach(item => {
      const disc = parseFloat(item.Discount || 0);
      const lt   = item.qty * parseFloat(item.Price || 0) - disc * item.qty;
      itemsHtml += `
        <div class="item">
          <div class="iname">${item.ItemName || item.Barcode}</div>
          <div class="idet">${item.qty} x PKR ${fmt(item.Price)}${disc > 0 ? `  Disc: PKR ${fmt(disc * item.qty)}` : ""}</div>
          <div class="itot">PKR ${fmt(lt)}</div>
        </div>`;
    });
  });

  // ── Discount / refund / totals block ──────────────────────────────────────
  const billDiscLine = bill.billDiscount > 0
    ? `<div class="tr" style="color:#a00"><span>Bill Discount (${bill.billDiscountPct}%)</span><span>- PKR ${fmt(bill.billDiscount)}</span></div>`
    : "";

  // Refund line — shown for both cash and credit
  const refundLine = bill.refundApplied > 0
    ? `<div class="tr" style="color:#b05000;font-weight:700">
         <span>↩ Refund ${bill.refundReturnNo ? `(${bill.refundReturnNo})` : ""}</span>
         <span>- PKR ${fmt(bill.refundApplied)}</span>
       </div>`
    : "";

  // ── Payment section ────────────────────────────────────────────────────────
  let paymentSection = "";

  if (isCredit) {
    const prevPending     = parseFloat(bill.prevPending || 0);
    const grandTotalDebit = parseFloat(bill.grandTotal || 0) + prevPending;
    paymentSection = `
      <div class="dv"></div>
      ${prevPending > 0
        ? `<div class="pr"><span>Previous Balance</span><span style="color:#c00;font-weight:700">PKR ${fmt(prevPending)}</span></div>`
        : `<div class="pr" style="color:#777"><span>Previous Balance</span><span>NIL</span></div>`
      }
      <div class="pr gr" style="border-top:1px dashed #000;padding-top:5px;margin-top:4px">
        <span>GRAND TOTAL DEBIT</span>
        <span style="color:#c00">PKR ${fmt(grandTotalDebit)}</span>
      </div>
      <div style="text-align:center;font-size:10px;margin-top:5px;color:#555">Credit Sale — Please pay by due date</div>`;
  } else {
    // Walk-in / cash customer
    let payHtml = "";
    (bill.payments || []).forEach(p => {
      const amt = parseFloat(p.amount) || 0;
      if (amt > 0) {
        payHtml += `<div class="pr">
          <span>${p.type === "cash" ? "Cash Paid" : p.type === "refund" ? `Refund (${p.origReturnNo || ""})` : `Card (****${p.last4 || "----"})`}</span>
          <span>${p.type === "refund" ? "- " : ""}PKR ${fmt(amt)}</span>
        </div>`;
      }
    });
    const change = parseFloat(bill.change || 0);
    paymentSection = `
      <div class="dv"></div>
      ${payHtml}
      <div class="pr" style="font-weight:bold;margin-top:4px">
        <span>CHANGE RETURNED</span>
        <span>PKR ${fmt(Math.max(0, change))}</span>
      </div>`;
  }

  // Customer line
  const custLine = isCredit
    ? `<div class="bi"><span>Customer: ${bill.customerName}</span><span>${bill.customerCell || ""}</span></div>`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',monospace;font-size:12px;width:302px;padding:10px 6px;color:#000;background:#fff}
    .sn{font-size:15px;font-weight:bold;text-align:center;margin-bottom:1px}
    .dv{border-top:1px dashed #000;margin:5px 0}
    .bi{display:flex;justify-content:space-between;font-size:10px;margin:1px 0}
    .cat-hdr{text-align:center;font-weight:bold;margin:6px 0 2px;font-size:11px}
    .item{margin:3px 0}
    .iname{font-weight:bold;font-size:11px}
    .idet{font-size:10px;padding-left:6px;color:#333}
    .itot{font-size:11px;text-align:right;font-weight:bold}
    .tr{display:flex;justify-content:space-between;margin:2px 0;font-size:12px}
    .gr{font-size:14px;font-weight:bold;margin:4px 0}
    .pr{display:flex;justify-content:space-between;font-size:11px;margin:2px 0}
    .ft{text-align:center;font-size:10px;margin-top:8px}
    @media print{body{margin:0}}
  </style></head><body>
  <div class="sn">MIAN TRADERS</div>
  <div class="sn">GUJRANWALA</div>
  <div class="dv"></div>
  <div class="bi"><span>Bill#: ${bill.billNo}</span><span>${bill.date}</span></div>
  <div class="bi"><span>Cashier: ${bill.cashier}</span><span>${bill.time}</span></div>
  ${custLine}
  <div class="dv"></div>
  ${itemsHtml}
  <div class="dv"></div>
  <div class="tr"><span>Sub Total</span><span>PKR ${fmt(bill.subTotal)}</span></div>
  ${bill.totalDiscount > 0 ? `<div class="tr" style="color:#a00"><span>Item Discounts</span><span>- PKR ${fmt(bill.totalDiscount)}</span></div>` : ""}
  ${billDiscLine}
  ${refundLine}
  <div class="dv"></div>
  <div class="tr gr"><span>${isCredit ? "THIS BILL TOTAL" : "GRAND TOTAL"}</span><span>PKR ${fmt(bill.grandTotal)}</span></div>
  ${paymentSection}
  <div class="dv"></div>
  <div class="ft">Thank you for shopping at<br><b>Mian Traders</b></div>
  <div style="text-align:center;font-size:9px;margin-top:3px;color:#555">Designed by itkins.com | 0304-7414437</div>
  <br/><br/>
  </body></html>`;

  const w = window.open("", "_blank", "width=340,height=720");
  if (!w) { alert("Allow popups to print!"); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 450);
}

// ─── RETURN RECEIPT ───────────────────────────────────────────────────────────
export function printReturnReceipt(ret) {
  const items = safeParseItems(ret.Items || ret.items || "[]");
  const rows  = items.map(i =>
    `<div style="display:flex;justify-content:space-between;margin:3px 0;font-size:11px">
      <span>${i.ItemName} x${i.qty}</span>
      <span>PKR ${fmt(parseFloat(i.Price || 0) * i.qty)}</span>
    </div>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;width:302px;padding:10px 6px;color:#000}</style>
  </head><body>
  <div style="font-size:15px;font-weight:bold;text-align:center">MIAN TRADERS</div>
  <div style="font-size:13px;font-weight:bold;text-align:center;margin:3px 0">— RETURN RECEIPT —</div>
  <div style="border-top:1px dashed #000;margin:5px 0"></div>
  <div style="display:flex;justify-content:space-between;font-size:10px"><span>Return#: ${ret.ReturnNo}</span><span>${ret.Date}</span></div>
  <div style="display:flex;justify-content:space-between;font-size:10px"><span>Orig Bill#: ${ret.OrigBillNo}</span><span>${ret.Time}</span></div>
  <div style="border-top:1px dashed #000;margin:5px 0"></div>
  ${rows}
  <div style="border-top:1px dashed #000;margin:5px 0"></div>
  <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px">
    <span>REFUND AMOUNT</span><span>PKR ${fmt(ret.RefundAmount)}</span>
  </div>
  <div style="text-align:center;font-size:10px;margin-top:8px">Reason: ${ret.Reason || "Customer Return"}</div>
  <br/><br/>
  </body></html>`;

  const w = window.open("", "_blank", "width=340,height=600");
  if (!w) { alert("Allow popups!"); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

// ─── STOCK PDF ────────────────────────────────────────────────────────────────
export function downloadStockPDF(filtered, filterCat, filterCo, filterStatus) {
  const now        = new Date().toLocaleString("en-PK");
  const filterDesc = [
    filterCat    !== "All" ? `Category: ${filterCat}` : "",
    filterCo     !== "All" ? `Company: ${filterCo}`   : "",
    filterStatus !== "All" ? `Status: ${
      filterStatus === "out"      ? "Out of Stock"  :
      filterStatus === "low"      ? "Low Stock"     :
      filterStatus === "ok"       ? "In Stock"      :
      filterStatus === "expired"  ? "Expired Items" :
      filterStatus === "expiring" ? "Expiring Soon" : filterStatus
    }` : "",
  ].filter(Boolean).join("  |  ") || "All Items";

  const totalValue = filtered.reduce((s, i) => s + parseFloat(i.Price || 0) * (Number(i.Stock) || 0), 0);
  const outCount   = filtered.filter(i => (Number(i.Stock) || 0) <= 0).length;
  const lowCount   = filtered.filter(i => (Number(i.Stock) || 0) > 0 && (Number(i.Stock) || 0) <= 5).length;
  const okCount    = filtered.filter(i => (Number(i.Stock) || 0) > 5).length;

  const rows = filtered.map((item, i) => {
    const stk         = Number(item.Stock) || 0;
    const statusColor = stk <= 0 ? "#c0392b" : stk <= 5 ? "#d68910" : "#1e8449";
    const statusText  = stk <= 0 ? "OUT"     : stk <= 5 ? "LOW"     : "OK";
    const rowBg       = i % 2 === 0 ? "#ffffff" : "#f7f9fc";
    const es          = getExpiryStatus(item.ExpiryDate);
    const expiryColor = es.status === "expired" ? "#c0392b" : es.status === "critical" || es.status === "today" ? "#d35400" : es.status === "warning" ? "#d68910" : es.status === "ok" ? "#1e8449" : "#888";
    const expiryText  = item.ExpiryDate ? fmtExpiry(item.ExpiryDate) : "—";
    const expiryLabel = item.ExpiryDate ? es.label : "";
    return `
      <tr style="background:${rowBg}">
        <td style="text-align:center;color:#888">${i + 1}</td>
        <td style="font-family:monospace;font-size:10px;color:#555">${item.Barcode}</td>
        <td style="font-weight:600;color:#111">${item.ItemName}</td>
        <td style="color:#444">${item.Category || "—"}</td>
        <td style="color:#0057a8">${item.Company || "—"}</td>
        <td style="text-align:right;font-weight:700">PKR ${fmt(item.Price)}</td>
        <td style="text-align:right;color:#555">${item.CostPrice ? "PKR " + fmt(item.CostPrice) : "—"}</td>
        <td style="text-align:right;font-weight:800;font-size:13px;color:${statusColor}">${item.Stock}</td>
        <td style="text-align:center">
          <div style="color:${expiryColor};font-weight:700;font-size:11px">${expiryText}</div>
          <div style="color:${expiryColor};font-size:9px;opacity:0.85">${expiryLabel}</div>
        </td>
        <td style="text-align:center">
          <span style="background:${statusColor};color:#fff;padding:2px 9px;border-radius:10px;font-size:10px;font-weight:700">${statusText}</span>
        </td>
      </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Stock Report — Mian Traders</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;font-size:12px;color:#222;background:#fff;padding:24px}
    h1{font-size:22px;color:#0a2540;margin-bottom:3px}
    .sub{color:#666;font-size:11px;margin-bottom:18px}
    .cards{display:flex;gap:14px;margin-bottom:20px}
    .card{flex:1;border-radius:8px;padding:13px 16px;text-align:center}
    .card .val{font-size:22px;font-weight:800;margin-bottom:3px}
    .card .lbl{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.5px}
    table{width:100%;border-collapse:collapse}
    thead th{background:#0a2540;color:#fff;padding:9px 10px;text-align:left;font-size:10px;letter-spacing:0.8px;text-transform:uppercase}
    tbody td{padding:7px 10px;border-bottom:1px solid #eaecef}
    .footer{margin-top:24px;text-align:center;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:10px}
    @media print{body{padding:10px}.footer{position:fixed;bottom:0;width:100%}}
  </style>
  </head><body>
  <h1>📦 Stock Report — MIAN TRADERS</h1>
  <div class="sub">Generated: ${now} &nbsp;·&nbsp; Filter: ${filterDesc} &nbsp;·&nbsp; Total Items: ${filtered.length}</div>
  <div class="cards">
    <div class="card" style="background:#fde8e8;border:1px solid #f5c6c6"><div class="val" style="color:#c0392b">${outCount}</div><div class="lbl">Out of Stock</div></div>
    <div class="card" style="background:#fef9e7;border:1px solid #f9e4a0"><div class="val" style="color:#d68910">${lowCount}</div><div class="lbl">Low Stock (≤5)</div></div>
    <div class="card" style="background:#e8f8f0;border:1px solid #a9dfbf"><div class="val" style="color:#1e8449">${okCount}</div><div class="lbl">In Stock</div></div>
    <div class="card" style="background:#eaf4ff;border:1px solid #a9ccee"><div class="val" style="color:#1a5276;font-size:16px">PKR ${fmt(totalValue)}</div><div class="lbl">Stock Value</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:32px;text-align:center">#</th>
        <th>Barcode</th><th>Item Name</th><th>Category</th><th>Company</th>
        <th style="text-align:right">Price</th><th style="text-align:right">Cost</th>
        <th style="text-align:right">Stock</th><th style="text-align:center">Expiry</th>
        <th style="text-align:center">Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">itKINS POS System &nbsp;·&nbsp; Designed by itkins.com &nbsp;|&nbsp; 0304-7414437</div>
  <script>window.onload = () => { window.print(); }</script>
  </body></html>`;

  const w = window.open("", "_blank", "width=960,height=720");
  if (!w) { alert("Please allow popups to download PDF!"); return; }
  w.document.write(html);
  w.document.close();
}
