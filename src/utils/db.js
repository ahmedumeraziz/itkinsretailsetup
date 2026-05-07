// ─── INDEXEDDB LAYER ──────────────────────────────────────────────────────────
const DB_NAME    = "AlAminPOS";
const DB_VERSION = 2;

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const stores = ["items","categories","cashiers","sales","customers","stocklog","returns","pendingQueue","meta"];
      stores.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === "pendingQueue" ? "qid" : "id", autoIncrement: s === "pendingQueue" }); });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function dbGet(store, key) {
  const db  = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = () => rej(req.error);
  });
}

export async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function dbClear(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

export async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

export async function dbSaveAll(store, arr, keyField) {
  await dbClear(store);
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    arr.forEach((item, i) => os.put({ ...item, id: item[keyField] || String(i) }));
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

export async function dbQueueAction(payload) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction("pendingQueue", "readwrite");
    const req = tx.objectStore("pendingQueue").add({ ...payload, queuedAt: Date.now() });
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function dbGetQueue() {
  return dbGetAll("pendingQueue");
}

export async function dbClearQueueItem(qid) {
  return dbDelete("pendingQueue", qid);
}

export async function dbSetMeta(key, value) {
  return dbPut("meta", { id: key, value });
}

export async function dbGetMeta(key) {
  const r = await dbGet("meta", key);
  return r ? r.value : null;
}
