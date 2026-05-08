// ─── APPS SCRIPT TEXT ─────────────────────────────────────────────────────────
export function getScriptText() {
  return `// ═══════════════════════════════════════════════════════════════
//  itKINS POS — Apps Script v8.0
//  Designed by itKINS → Engr. Ahmed Umer (0304-7414437)
//  Setup: Apps Script → Delete all → Paste → Save → Deploy →
//         New Deployment → Web App → Anyone → Copy /exec URL
// ═══════════════════════════════════════════════════════════════

var SECRET_TOKEN     = "itKINS@POS#2024$Secure!";

var SHEET_ITEMS      = "Items";
var SHEET_CATEGORIES = "Categories";
var SHEET_CASHIER    = "Cashier";
var SHEET_SALES      = "Sales";
var SHEET_STOCKLOG   = "StockLog";
var SHEET_CUSTOMER   = "Customer";
var SHEET_RETURNS    = "Returns";

var HEADERS = {
  Items:      ["Barcode","Category","Company","ItemName","Price","CostPrice","Discount","Stock","ExpiryDate"],
  Categories: ["CategoryName"],
  Cashier:    ["Name","Username","PIN","Role"],
  Sales:      ["BillNo","Date","Time","Cashier","GrandTotal","Discount","FBR","PaymentMethod","ItemsDetail","CustomerName","CustomerCell"],
  StockLog:   ["Date","Barcode","ItemName","StockBefore","StockAfter","Reason"],
  Customer:   ["Name","CellNo","BillNo","Payments","OpeningDebit"],
  Returns:    ["ReturnNo","OrigBillNo","Date","Time","Cashier","Items","RefundAmount","Reason","UsedInBill"]
};

function makeResp(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return makeResp({ status: "ok", message: "itKINS Script v8 Running", time: new Date().toString() });
}

function doPost(e) {
  try {
    var raw  = e.postData ? e.postData.contents : "{}";
    var data = JSON.parse(raw);
    if (!data.token || data.token !== SECRET_TOKEN) {
      return makeResp({ status: "error", message: "Unauthorized request blocked" });
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var result;
    switch (data.action) {
      case "saveSale":         result = saveSale(ss, data);         break;
      case "saveCustomer":     result = saveCustomer(ss, data);     break;
      case "deleteCustomer":   result = deleteCustomer(ss, data);   break;
      case "savePayment":      result = savePayment(ss, data);      break;
      case "syncPayments":     result = syncPayments(ss, data);     break;
      case "adjustStock":      result = adjustStock(ss, data);      break;
      case "addItem":          result = addItem(ss, data);          break;
      case "editItem":         result = editItem(ss, data);         break;
      case "deleteItem":       result = deleteItem(ss, data);       break;
      case "addCategory":      result = addCategory(ss, data);      break;
      case "deleteCategory":   result = deleteCategory(ss, data);   break;
      case "addCashier":       result = addCashier(ss, data);       break;
      case "editCashier":      result = editCashier(ss, data);      break;
      case "deleteCashier":    result = deleteCashier(ss, data);    break;
      case "saveReturn":       result = saveReturn(ss, data);       break;
      case "markReturnUsed":   result = markReturnUsed(ss, data);   break;
      case "ensureHeaders":    result = ensureAllHeaders(ss);        break;
      case "generateAllSheets": result = generateAllSheets(ss);     break;
      case "ping":             result = { status: "ok", message: "pong" }; break;
      default:                 result = { status: "error", message: "Unknown action: " + data.action };
    }
    return makeResp(result);
  } catch (err) {
    return makeResp({ status: "error", message: err.toString() });
  }
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function getHeaders(sheet) {
  var last = sheet.getLastColumn();
  if (last < 1) return {};
  var row = sheet.getRange(1, 1, 1, last).getValues()[0];
  var map = {};
  row.forEach(function(h, i) { map[String(h).trim()] = i; });
  return map;
}

function findRow(sheet, colIndex, value) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var col = sheet.getRange(2, colIndex + 1, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim() === String(value).trim()) return i + 2;
  }
  return -1;
}

// Normalise bill numbers for matching (strip leading zeros)
function normBill(b) {
  var n = String(b || "").trim().replace(/[^0-9]/g, "");
  return n.replace(/^0+/, "") || "0";
}

// ── GENERATE ALL SHEETS (create + ensure all headers) ────────────────────────
function generateAllSheets(ss) {
  var created = [];
  var fixed   = [];
  var sheetMap = {
    Items: SHEET_ITEMS, Categories: SHEET_CATEGORIES, Cashier: SHEET_CASHIER,
    Sales: SHEET_SALES, StockLog: SHEET_STOCKLOG, Customer: SHEET_CUSTOMER, Returns: SHEET_RETURNS
  };
  Object.keys(sheetMap).forEach(function(key) {
    var tabName = sheetMap[key];
    var sh      = ss.getSheetByName(tabName);
    if (!sh) {
      sh = ss.insertSheet(tabName);
      sh.getRange(1, 1, 1, HEADERS[key].length).setValues([HEADERS[key]]);
      // Style header row
      sh.getRange(1, 1, 1, HEADERS[key].length)
        .setBackground("#0a2540")
        .setFontColor("#ffffff")
        .setFontWeight("bold");
      created.push(tabName);
    } else {
      // Sheet exists — ensure all required headers
      var last     = sh.getLastColumn();
      var existing = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0].map(function(h) { return String(h).trim(); }) : [];
      var required = HEADERS[key] || [];
      var toAdd    = required.filter(function(h) { return !existing.includes(h); });
      if (toAdd.length > 0) {
        toAdd.forEach(function(h) {
          var col = sh.getLastColumn() + 1;
          sh.getRange(1, col).setValue(h).setBackground("#0a2540").setFontColor("#ffffff").setFontWeight("bold");
          fixed.push(tabName + "." + h);
        });
      }
    }
  });
  return {
    status: "ok",
    created: created,
    fixed: fixed,
    message: "Created: [" + created.join(", ") + "] Fixed: [" + fixed.join(", ") + "]"
  };
}

// ── ENSURE ALL HEADERS ────────────────────────────────────────────────────────
function ensureAllHeaders(ss) {
  var fixed = [];
  var sheetMap = {
    Items: SHEET_ITEMS, Categories: SHEET_CATEGORIES, Cashier: SHEET_CASHIER,
    Sales: SHEET_SALES, StockLog: SHEET_STOCKLOG, Customer: SHEET_CUSTOMER, Returns: SHEET_RETURNS
  };
  Object.keys(sheetMap).forEach(function(key) {
    var tabName = sheetMap[key];
    var sh      = ss.getSheetByName(tabName);
    if (!sh) {
      sh = ss.insertSheet(tabName);
      sh.getRange(1, 1, 1, HEADERS[key].length).setValues([HEADERS[key]]);
      fixed.push("CREATED: " + tabName);
      return;
    }
    var last     = sh.getLastColumn();
    var existing = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0].map(function(h) { return String(h).trim(); }) : [];
    var required = HEADERS[key] || [];
    var toAdd    = required.filter(function(h) { return !existing.includes(h); });
    if (toAdd.length > 0) {
      toAdd.forEach(function(h) {
        var col = sh.getLastColumn() + 1;
        sh.getRange(1, col).setValue(h);
        fixed.push(tabName + "." + h);
      });
    }
  });
  return { status: "ok", fixed: fixed, message: fixed.length > 0 ? "Fixed: " + fixed.join(", ") : "All headers OK" };
}

// ── SAVE SALE ─────────────────────────────────────────────────────────────────
function saveSale(ss, data) {
  var salesSh = ss.getSheetByName(SHEET_SALES);
  if (!salesSh) return { status: "error", message: "Sheet not found: " + SHEET_SALES };

  // FBR is now 0
  salesSh.appendRow([
    data.BillNo || "", data.Date || "", data.Time || "", data.Cashier || "",
    parseFloat(data.GrandTotal) || 0, parseFloat(data.Discount) || 0, 0,
    data.PaymentMethod || "", data.ItemsDetail || "[]",
    data.CustomerName || "Unknown", data.CustomerCell || ""
  ]);

  // Auto-add/update customer for Credit sales
  var custName = (data.CustomerName || "").trim();
  var custCell = (data.CustomerCell || "").trim();
  if (custName && custName !== "Unknown" && custCell && data.PaymentMethod === "Credit") {
    var custSh = ss.getSheetByName(SHEET_CUSTOMER);
    if (custSh) {
      var custHdrMap  = getHeaders(custSh);
      var custCellIdx = custHdrMap["CellNo"];
      if (custCellIdx !== undefined) {
        var custRowNum = findRow(custSh, custCellIdx, custCell);
        if (custRowNum === -1) {
          custSh.appendRow([custName, custCell, data.BillNo || "", "", 0]);
        } else {
          var billsIdx = custHdrMap["BillNo"];
          if (billsIdx !== undefined) {
            var existingBills = String(custSh.getRange(custRowNum, billsIdx + 1).getValue() || "");
            var billsArr = existingBills.split(",").map(function(b) { return b.trim(); }).filter(Boolean);
            // Deduplicate check
            var normNew = normBill(data.BillNo || "");
            var alreadyHas = billsArr.some(function(b) { return normBill(b) === normNew; });
            if (!alreadyHas && data.BillNo) {
              // Deduplicate existing before adding
              var seen = {};
              var unique = billsArr.filter(function(b) { var n = normBill(b); if (seen[n]) return false; seen[n] = true; return true; });
              unique.push(String(data.BillNo));
              custSh.getRange(custRowNum, billsIdx + 1).setValue(unique.join(","));
            }
          }
        }
      }
    }
  }

  // Deduct stock
  var itemsSh    = ss.getSheetByName(SHEET_ITEMS);
  var stockLogSh = ss.getSheetByName(SHEET_STOCKLOG);
  if (itemsSh && data.items && data.items.length > 0) {
    var allRows  = itemsSh.getDataRange().getValues();
    var hdr      = allRows[0];
    var bcIdx    = hdr.indexOf("Barcode");
    var stockIdx = hdr.indexOf("Stock");
    var nameIdx  = hdr.indexOf("ItemName");
    if (bcIdx === -1 || stockIdx === -1) return { status: "warning", message: "Sale saved but stock columns missing" };
    var logRows = [];
    data.items.forEach(function(soldItem) {
      for (var i = 1; i < allRows.length; i++) {
        if (String(allRows[i][bcIdx]).trim() === String(soldItem.Barcode).trim()) {
          var before = parseInt(allRows[i][stockIdx]) || 0;
          var qty    = parseInt(soldItem.qty) || 1;
          var after  = Math.max(0, before - qty);
          itemsSh.getRange(i + 1, stockIdx + 1).setValue(after);
          allRows[i][stockIdx] = after;
          logRows.push([data.Date || "", soldItem.Barcode || "", allRows[i][nameIdx] || "", before, after, "Bill #" + (data.BillNo || "")]);
          break;
        }
      }
    });
    if (stockLogSh && logRows.length > 0) {
      var nextRow = stockLogSh.getLastRow() + 1;
      stockLogSh.getRange(nextRow, 1, logRows.length, 6).setValues(logRows);
    }
  }
  return { status: "ok", message: "Sale saved: Bill #" + data.BillNo };
}

// ── SAVE RETURN ───────────────────────────────────────────────────────────────
function saveReturn(ss, data) {
  var retSh = ss.getSheetByName(SHEET_RETURNS);
  if (!retSh) return { status: "error", message: "Returns sheet not found" };
  retSh.appendRow([
    data.ReturnNo || "", data.OrigBillNo || "", data.Date || "", data.Time || "",
    data.Cashier || "", data.Items || "[]", parseFloat(data.RefundAmount) || 0, data.Reason || "", "0"
  ]);

  // Restore stock
  var itemsSh    = ss.getSheetByName(SHEET_ITEMS);
  var stockLogSh = ss.getSheetByName(SHEET_STOCKLOG);
  var returnedItems = [];
  try { returnedItems = JSON.parse(data.Items || "[]"); } catch (e) {}
  if (itemsSh && returnedItems.length > 0) {
    var allRows  = itemsSh.getDataRange().getValues();
    var hdr      = allRows[0];
    var bcIdx    = hdr.indexOf("Barcode");
    var stockIdx = hdr.indexOf("Stock");
    var nameIdx  = hdr.indexOf("ItemName");
    var logRows  = [];
    returnedItems.forEach(function(ri) {
      for (var i = 1; i < allRows.length; i++) {
        if (String(allRows[i][bcIdx]).trim() === String(ri.Barcode).trim()) {
          var before = parseInt(allRows[i][stockIdx]) || 0;
          var qty    = parseInt(ri.qty) || 1;
          var after  = before + qty;
          itemsSh.getRange(i + 1, stockIdx + 1).setValue(after);
          allRows[i][stockIdx] = after;
          logRows.push([data.Date || "", ri.Barcode || "", allRows[i][nameIdx] || "", before, after, "Return #" + (data.ReturnNo || "")]);
          break;
        }
      }
    });
    if (stockLogSh && logRows.length > 0) {
      var nextRow = stockLogSh.getLastRow() + 1;
      stockLogSh.getRange(nextRow, 1, logRows.length, 6).setValues(logRows);
    }
  }
  return { status: "ok", message: "Return saved: " + data.ReturnNo };
}

// ── MARK RETURN USED ──────────────────────────────────────────────────────────
function markReturnUsed(ss, data) {
  var sh = ss.getSheetByName(SHEET_RETURNS);
  if (!sh) return { status: "error", message: "Returns sheet not found" };
  var hdrMap   = getHeaders(sh);
  var retNoIdx = hdrMap["ReturnNo"];
  var usedIdx  = hdrMap["UsedInBill"];
  if (retNoIdx === undefined) return { status: "error", message: "ReturnNo column not found" };
  if (usedIdx === undefined) {
    var col = sh.getLastColumn() + 1;
    sh.getRange(1, col).setValue("UsedInBill");
    usedIdx = col - 1;
  }
  var rowNum = findRow(sh, retNoIdx, data.ReturnNo);
  if (rowNum === -1) return { status: "error", message: "Return not found: " + data.ReturnNo };
  sh.getRange(rowNum, usedIdx + 1).setValue("1");
  return { status: "ok", message: "Marked used: " + data.ReturnNo };
}

// ── SAVE CUSTOMER ─────────────────────────────────────────────────────────────
function saveCustomer(ss, data) {
  var sh = ss.getSheetByName(SHEET_CUSTOMER);
  if (!sh) return { status: "error", message: "Sheet not found: " + SHEET_CUSTOMER };
  var name    = (data.Name   || "").trim();
  var cell    = (data.CellNo || "").trim();
  var billNo  = (data.BillNo || "").trim();
  var opening = parseFloat(data.OpeningDebit) || 0;
  if (!name || !cell) return { status: "error", message: "Name and CellNo required" };
  var hdrMap  = getHeaders(sh);
  var cellIdx = hdrMap["CellNo"];
  if (cellIdx === undefined) return { status: "error", message: "CellNo column not found" };
  var rowNum  = findRow(sh, cellIdx, cell);
  if (rowNum === -1) {
    sh.appendRow([name, cell, billNo, "", opening]);
    return { status: "ok", message: "Customer created: " + name };
  }
  // Update name
  var nameIdx = hdrMap["Name"];
  if (nameIdx !== undefined) sh.getRange(rowNum, nameIdx + 1).setValue(name);
  // Update opening debit — only write if provided AND either: cell is empty, or new value > 0
  var openIdx = hdrMap["OpeningDebit"];
  if (openIdx !== undefined) {
    var existingDebit = sh.getRange(rowNum, openIdx + 1).getValue();
    var existingDebitVal = parseFloat(existingDebit) || 0;
    // Only overwrite if: new value is explicitly > 0, OR cell is currently empty/zero
    if (opening > 0) {
      sh.getRange(rowNum, openIdx + 1).setValue(opening);
    } else if (existingDebitVal === 0 && opening === 0) {
      // Both zero — no-op, leave as is
    }
    // If existing > 0 and new value = 0 → do NOT overwrite (preserve existing)
  }
  // Append bill if new — deduplicate using normBill logic
  var billsIdx = hdrMap["BillNo"];
  if (billsIdx !== undefined && billNo) {
    var existing = String(sh.getRange(rowNum, billsIdx + 1).getValue() || "");
    var bills    = existing.split(",").map(function(b) { return b.trim(); }).filter(Boolean);
    // Deduplicate: strip leading zeros for comparison
    var normNew = normBill(billNo);
    var alreadyHas = bills.some(function(b) { return normBill(b) === normNew; });
    if (!alreadyHas) {
      // Also deduplicate existing bills before saving
      var seen = {};
      var uniqueBills = bills.filter(function(b) {
        var n = normBill(b);
        if (seen[n]) return false;
        seen[n] = true;
        return true;
      });
      uniqueBills.push(billNo);
      sh.getRange(rowNum, billsIdx + 1).setValue(uniqueBills.join(","));
    } else {
      // Still deduplicate existing even if this bill already present
      var seenD = {};
      var dedupBills = bills.filter(function(b) {
        var n = normBill(b);
        if (seenD[n]) return false;
        seenD[n] = true;
        return true;
      });
      if (dedupBills.length !== bills.length) {
        sh.getRange(rowNum, billsIdx + 1).setValue(dedupBills.join(","));
      }
    }
  }
  return { status: "ok", message: "Customer updated: " + name };
}

// ── DELETE CUSTOMER ───────────────────────────────────────────────────────────
function deleteCustomer(ss, data) {
  var sh = ss.getSheetByName(SHEET_CUSTOMER);
  if (!sh) return { status: "error", message: "Sheet not found: " + SHEET_CUSTOMER };
  var cell    = (data.CellNo || "").trim();
  if (!cell) return { status: "error", message: "CellNo required" };
  var hdrMap  = getHeaders(sh);
  var cellIdx = hdrMap["CellNo"];
  if (cellIdx === undefined) return { status: "error", message: "CellNo column not found" };
  var rowNum = findRow(sh, cellIdx, cell);
  if (rowNum === -1) return { status: "error", message: "Customer not found: " + cell };
  sh.deleteRow(rowNum);
  return { status: "ok", message: "Customer deleted: " + cell };
}

// ── SYNC PAYMENTS (full replace — used for delete and receive payment) ────────
function syncPayments(ss, data) {
  var sh = ss.getSheetByName(SHEET_CUSTOMER);
  if (!sh) return { status: "error", message: "Sheet not found: " + SHEET_CUSTOMER };
  var cell = (data.CellNo || "").trim();
  if (!cell) return { status: "error", message: "CellNo required" };
  var hdrMap  = getHeaders(sh);
  var cellIdx = hdrMap["CellNo"];
  if (cellIdx === undefined) return { status: "error", message: "CellNo column not found" };
  var rowNum = findRow(sh, cellIdx, cell);
  if (rowNum === -1) return { status: "error", message: "Customer not found: " + cell };
  var payIdx = hdrMap["Payments"];
  if (payIdx === undefined) {
    var col = sh.getLastColumn() + 1;
    sh.getRange(1, col).setValue("Payments");
    payIdx = col - 1;
  }
  // Replace entire payments cell with the provided JSON
  sh.getRange(rowNum, payIdx + 1).setValue(data.payments || "[]");
  return { status: "ok", message: "Payments synced for: " + cell };
}

// ── SAVE PAYMENT (append single payment) ─────────────────────────────────────
function savePayment(ss, data) {
  var sh = ss.getSheetByName(SHEET_CUSTOMER);
  if (!sh) return { status: "error", message: "Sheet not found: " + SHEET_CUSTOMER };
  var cell = (data.CellNo || "").trim();
  if (!cell) return { status: "error", message: "CellNo required" };
  var hdrMap  = getHeaders(sh);
  var cellIdx = hdrMap["CellNo"];
  if (cellIdx === undefined) return { status: "error", message: "CellNo column not found" };
  var rowNum = findRow(sh, cellIdx, cell);
  if (rowNum === -1) return { status: "error", message: "Customer not found: " + cell };
  var payIdx = hdrMap["Payments"];
  if (payIdx === undefined) {
    var col = sh.getLastColumn() + 1;
    sh.getRange(1, col).setValue("Payments");
    payIdx = col - 1;
  }
  var existing = String(sh.getRange(rowNum, payIdx + 1).getValue() || "");
  var payments = [];
  try { if (existing.trim()) payments = JSON.parse(existing); } catch (e) { payments = []; }
  if (!Array.isArray(payments)) payments = [];
  payments.push({ date: data.date || "", amount: parseFloat(data.amount) || 0, note: data.note || "Received" });
  sh.getRange(rowNum, payIdx + 1).setValue(JSON.stringify(payments));
  return { status: "ok", message: "Payment saved for: " + cell };
}

// ── ADJUST STOCK ──────────────────────────────────────────────────────────────
function adjustStock(ss, data) {
  var itemsSh    = ss.getSheetByName(SHEET_ITEMS);
  var stockLogSh = ss.getSheetByName(SHEET_STOCKLOG);
  if (!itemsSh) return { status: "error", message: "Items sheet not found" };
  var hdrMap   = getHeaders(itemsSh);
  var bcIdx    = hdrMap["Barcode"];
  var stockIdx = hdrMap["Stock"];
  var nameIdx  = hdrMap["ItemName"];
  if (bcIdx === undefined || stockIdx === undefined) return { status: "error", message: "Missing columns" };
  var rowNum = findRow(itemsSh, bcIdx, data.Barcode);
  if (rowNum === -1) return { status: "error", message: "Barcode not found" };
  var before = parseInt(itemsSh.getRange(rowNum, stockIdx + 1).getValue()) || 0;
  var val    = parseInt(data.Value) || 0;
  var after  = data.AdjustType === "add" ? before + val : data.AdjustType === "subtract" ? Math.max(0, before - val) : val;
  itemsSh.getRange(rowNum, stockIdx + 1).setValue(after);
  if (stockLogSh) {
    var itemName = nameIdx !== undefined ? itemsSh.getRange(rowNum, nameIdx + 1).getValue() : data.Barcode;
    stockLogSh.appendRow([new Date().toLocaleDateString("en-GB"), data.Barcode, itemName, before, after, "Admin: " + (data.Reason || "Manual")]);
  }
  return { status: "ok", before: before, after: after };
}

// ── ITEM CRUD ─────────────────────────────────────────────────────────────────
function addItem(ss, data) {
  var sh = ss.getSheetByName(SHEET_ITEMS);
  if (!sh) return { status: "error", message: "Items sheet not found" };
  var hdrMap = getHeaders(sh);
  if (hdrMap["Barcode"] !== undefined && findRow(sh, hdrMap["Barcode"], data.Barcode) !== -1)
    return { status: "error", message: "Barcode already exists" };
  sh.appendRow([data.Barcode || "", data.Category || "", data.Company || "", data.ItemName || "",
    parseFloat(data.Price) || 0, parseFloat(data.CostPrice) || 0, parseFloat(data.Discount) || 0,
    parseInt(data.Stock) || 0, data.ExpiryDate || ""]);
  return { status: "ok" };
}

function editItem(ss, data) {
  var sh = ss.getSheetByName(SHEET_ITEMS);
  if (!sh) return { status: "error", message: "Items sheet not found" };
  var hdrMap = getHeaders(sh);
  if (hdrMap["Barcode"] === undefined) return { status: "error", message: "No Barcode column" };
  var rowNum = findRow(sh, hdrMap["Barcode"], data.Barcode);
  if (rowNum === -1) return { status: "error", message: "Barcode not found" };
  var updates = {
    "Category": data.Category, "Company": data.Company || "", "ItemName": data.ItemName,
    "Price": parseFloat(data.Price) || 0, "CostPrice": parseFloat(data.CostPrice) || 0,
    "Discount": parseFloat(data.Discount) || 0, "Stock": parseInt(data.Stock) || 0, "ExpiryDate": data.ExpiryDate || ""
  };
  Object.keys(updates).forEach(function(col) {
    if (hdrMap[col] !== undefined) sh.getRange(rowNum, hdrMap[col] + 1).setValue(updates[col]);
  });
  return { status: "ok" };
}

function deleteItem(ss, data) {
  var sh = ss.getSheetByName(SHEET_ITEMS);
  if (!sh) return { status: "error", message: "Items sheet not found" };
  var bcIdx = getHeaders(sh)["Barcode"];
  if (bcIdx === undefined) return { status: "error", message: "No Barcode column" };
  var rowNum = findRow(sh, bcIdx, data.Barcode);
  if (rowNum === -1) return { status: "error", message: "Item not found" };
  sh.deleteRow(rowNum);
  return { status: "ok" };
}

// ── CATEGORY CRUD ─────────────────────────────────────────────────────────────
function addCategory(ss, data) {
  var sh   = ss.getSheetByName(SHEET_CATEGORIES);
  if (!sh) return { status: "error", message: "Categories sheet not found" };
  var name = (data.CategoryName || "").trim();
  if (!name) return { status: "error", message: "Empty name" };
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) if (String(vals[i][0]).trim() === name) return { status: "error", message: "Category already exists" };
  sh.appendRow([name]);
  return { status: "ok" };
}

function deleteCategory(ss, data) {
  var sh   = ss.getSheetByName(SHEET_CATEGORIES);
  if (!sh) return { status: "error", message: "Categories sheet not found" };
  var name = (data.CategoryName || "").trim();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === name) { sh.deleteRow(i + 1); return { status: "ok" }; }
  }
  return { status: "error", message: "Category not found" };
}

// ── CASHIER CRUD ──────────────────────────────────────────────────────────────
function addCashier(ss, data) {
  var sh = ss.getSheetByName(SHEET_CASHIER);
  if (!sh) return { status: "error", message: "Cashier sheet not found" };
  var hdrMap = getHeaders(sh);
  var unIdx  = hdrMap["Username"];
  if (unIdx === undefined) return { status: "error", message: "No Username column" };
  if (findRow(sh, unIdx, data.Username) !== -1) return { status: "error", message: "Username already exists" };
  sh.appendRow([data.Name || "", data.Username || "", data.PIN || "", data.Role || "cashier"]);
  return { status: "ok" };
}

function editCashier(ss, data) {
  var sh = ss.getSheetByName(SHEET_CASHIER);
  if (!sh) return { status: "error", message: "Cashier sheet not found" };
  var hdrMap = getHeaders(sh);
  var unIdx  = hdrMap["Username"];
  if (unIdx === undefined) return { status: "error", message: "No Username column" };
  var rowNum = findRow(sh, unIdx, data.OrigUsername || data.Username);
  if (rowNum === -1) return { status: "error", message: "User not found" };
  var updates = { "Name": data.Name, "Username": data.Username, "PIN": data.PIN, "Role": data.Role };
  Object.keys(updates).forEach(function(col) {
    if (hdrMap[col] !== undefined) sh.getRange(rowNum, hdrMap[col] + 1).setValue(updates[col]);
  });
  return { status: "ok" };
}

function deleteCashier(ss, data) {
  var sh = ss.getSheetByName(SHEET_CASHIER);
  if (!sh) return { status: "error", message: "Cashier sheet not found" };
  var unIdx = getHeaders(sh)["Username"];
  if (unIdx === undefined) return { status: "error", message: "No Username column" };
  var rowNum = findRow(sh, unIdx, data.Username);
  if (rowNum === -1) return { status: "error", message: "User not found" };
  sh.deleteRow(rowNum);
  return { status: "ok" };
}

// ══════════════════════════════════════════════════════════════════════════════
// DAILY BACKUP SCRIPT
// Run createDailyBackupTrigger() ONCE to activate (runs daily at 2 AM PKT)
// ══════════════════════════════════════════════════════════════════════════════

var SPREADSHEET_ID   = "11xFHs6zVh4ZgNTwtRveTg1Q401pxiCWv8tyOuFfhoiA";
var BACKUP_FOLDER_ID = "1hcszl75hKW7i2YW2vjPD3JUtUbm9s4Rm";
var BACKUP_PREFIX    = "POS_Backup";
var KEEP_DAYS        = 30;

function dailyBackup() {
  try {
    var ss        = SpreadsheetApp.openById(SPREADSHEET_ID);
    var folder    = DriveApp.getFolderById(BACKUP_FOLDER_ID);
    var date      = Utilities.formatDate(new Date(), "Asia/Karachi", "yyyy-MM-dd_HH-mm");
    var backupName = BACKUP_PREFIX + "_" + date;
    DriveApp.getFileById(SPREADSHEET_ID).makeCopy(backupName, folder);
    console.log("✅ Backup created: " + backupName);
    deleteOldBackups(folder);
    logBackup(ss, backupName, "SUCCESS");
  } catch (e) {
    console.error("❌ Backup failed: " + e.toString());
  }
}

function deleteOldBackups(folder) {
  var cutoff   = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  var allFiles = folder.getFiles();
  var deleted  = 0;
  while (allFiles.hasNext()) {
    var file = allFiles.next();
    if (file.getName().startsWith(BACKUP_PREFIX) && file.getDateCreated() < cutoff) {
      file.setTrashed(true);
      deleted++;
    }
  }
  if (deleted > 0) console.log("Cleaned up " + deleted + " old backup(s)");
}

function logBackup(ss, backupName, status) {
  var logSheetName = "BackupLog";
  var logSheet     = ss.getSheetByName(logSheetName);
  if (!logSheet) {
    logSheet = ss.insertSheet(logSheetName);
    logSheet.getRange(1, 1, 1, 4).setValues([["Date","Time","BackupName","Status"]]);
    logSheet.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#0a2540").setFontColor("#ffffff");
  }
  var now  = new Date();
  var date = Utilities.formatDate(now, "Asia/Karachi", "dd/MM/yyyy");
  var time = Utilities.formatDate(now, "Asia/Karachi", "hh:mm a");
  logSheet.appendRow([date, time, backupName, status]);
}

function createDailyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "dailyBackup") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dailyBackup").timeBased().everyDays(1).atHour(2).create();
  console.log("✅ Daily backup trigger created — runs every day at 2 AM.");
}

function manualBackup() {
  dailyBackup();
  console.log("✅ Manual backup completed.");
}
`;
}
