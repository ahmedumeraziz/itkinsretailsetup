// ─── DEMO DATA ────────────────────────────────────────────────────────────────
export const DEMO_ITEMS = [
  { Barcode: "8964000767221", Category: "Dairy",     Company: "Nestle",    ItemName: "Treat Platinum Pouch 5pcs",     Price: "210", CostPrice: "185", Discount: "0",  Stock: "45", ExpiryDate: "2025-12-31" },
  { Barcode: "5428",          Category: "Grocery",   Company: "National",  ItemName: "Macroni Mix-KG",                Price: "215", CostPrice: "190", Discount: "5",  Stock: "30", ExpiryDate: "2026-06-30" },
  { Barcode: "8964000020364", Category: "Grocery",   Company: "Shangrila", ItemName: "Shangrila Tomato Ketchup 800G", Price: "340", CostPrice: "300", Discount: "10", Stock: "20", ExpiryDate: "2026-09-15" },
  { Barcode: "1001",          Category: "Beverages", Company: "PepsiCo",   ItemName: "Pepsi 1.5L",                    Price: "120", CostPrice: "100", Discount: "0",  Stock: "60", ExpiryDate: "2025-08-01" },
  { Barcode: "1002",          Category: "Beverages", Company: "CocaCola",  ItemName: "Coca Cola 500ml",               Price: "80",  CostPrice: "65",  Discount: "5",  Stock: "3",  ExpiryDate: "2026-03-31" },
  { Barcode: "1003",          Category: "Bakery",    Company: "Local",     ItemName: "Bread Loaf",                    Price: "90",  CostPrice: "70",  Discount: "0",  Stock: "15", ExpiryDate: "2026-05-10" },
  { Barcode: "1005",          Category: "Snacks",    Company: "Lays",      ItemName: "Lays Classic 100g",             Price: "60",  CostPrice: "48",  Discount: "0",  Stock: "40", ExpiryDate: "2026-11-30" },
  { Barcode: "1006",          Category: "Dairy",     Company: "Olpers",    ItemName: "Olpers Milk 1L",                Price: "175", CostPrice: "155", Discount: "10", Stock: "25", ExpiryDate: "2026-04-20" },
  { Barcode: "1007",          Category: "Snacks",    Company: "Kurkure",   ItemName: "Kurkure Masala 80g",            Price: "50",  CostPrice: "40",  Discount: "0",  Stock: "4",  ExpiryDate: "2026-07-15" },
];

export const DEMO_CATEGORIES = ["Dairy", "Grocery", "Beverages", "Bakery", "Snacks"];

export const DEMO_CASHIERS = [
  { Name: "Admin",  Username: "admin",  PIN: "1234", Role: "admin"   },
  { Name: "Rizwan", Username: "rizwan", PIN: "5678", Role: "cashier" },
  { Name: "Ahmed",  Username: "ahmed",  PIN: "9999", Role: "cashier" },
];

export const DEMO_SALES = [
  { BillNo: "0115", Date: "26/04/2026", Time: "10:15 AM", Cashier: "Rizwan", GrandTotal: "451",  Discount: "0",  FBR: "1", PaymentMethod: "Cash", CustomerName: "Ali Khan",    CustomerCell: "0300-1234567", ItemsDetail: '[{"Barcode":"1001","ItemName":"Pepsi 1.5L","Category":"Beverages","Price":"120","CostPrice":"100","Discount":"0","qty":2},{"Barcode":"1003","ItemName":"Bread Loaf","Category":"Bakery","Price":"90","CostPrice":"70","Discount":"0","qty":2}]' },
  { BillNo: "0116", Date: "26/04/2026", Time: "11:30 AM", Cashier: "Ahmed",  GrandTotal: "1161", Discount: "60", FBR: "1", PaymentMethod: "Card", CustomerName: "Sara Ahmed",  CustomerCell: "0312-9876543", ItemsDetail: '[{"Barcode":"1006","ItemName":"Olpers Milk 1L","Category":"Dairy","Price":"175","CostPrice":"155","Discount":"10","qty":4},{"Barcode":"5428","ItemName":"Macroni Mix-KG","Category":"Grocery","Price":"215","CostPrice":"190","Discount":"5","qty":2}]' },
  { BillNo: "0117", Date: "25/04/2026", Time: "01:45 PM", Cashier: "Rizwan", GrandTotal: "841",  Discount: "0",  FBR: "1", PaymentMethod: "Cash", CustomerName: "",     CustomerCell: "",             ItemsDetail: '[{"Barcode":"8964000767221","ItemName":"Treat Platinum Pouch 5pcs","Category":"Dairy","Price":"210","CostPrice":"185","Discount":"0","qty":4}]' },
  { BillNo: "0118", Date: "25/04/2026", Time: "02:20 PM", Cashier: "Rizwan", GrandTotal: "331",  Discount: "10", FBR: "1", PaymentMethod: "Cash", CustomerName: "Usman Malik", CustomerCell: "0321-1111111", ItemsDetail: '[{"Barcode":"8964000020364","ItemName":"Shangrila Tomato Ketchup 800G","Category":"Grocery","Price":"340","CostPrice":"300","Discount":"10","qty":1}]' },
  { BillNo: "0119", Date: "24/04/2026", Time: "03:30 PM", Cashier: "Rizwan", GrandTotal: "756",  Discount: "15", FBR: "1", PaymentMethod: "Cash", CustomerName: "Ali Khan",    CustomerCell: "0300-1234567", ItemsDetail: '[{"Barcode":"8964000767221","ItemName":"Treat Platinum Pouch 5pcs","Category":"Dairy","Price":"210","CostPrice":"185","Discount":"0","qty":1},{"Barcode":"5428","ItemName":"Macroni Mix-KG","Category":"Grocery","Price":"215","CostPrice":"190","Discount":"5","qty":1},{"Barcode":"8964000020364","ItemName":"Shangrila Tomato Ketchup 800G","Category":"Grocery","Price":"340","CostPrice":"300","Discount":"10","qty":1}]' },
];

export const DEMO_CUSTOMERS = [
  { Name: "Ali Khan",    CellNo: "0300-1234567", BillNo: "0115,0119", payments: [] },
  { Name: "Sara Ahmed",  CellNo: "0312-9876543", BillNo: "0116",      payments: [] },
  { Name: "Usman Malik", CellNo: "0321-1111111", BillNo: "0118",      payments: [] },
];

export const DEMO_RETURNS = [];
