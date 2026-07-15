/* ==========================================================
 * storage.js — browser-only persistence ("lock" master data,
 * custom font, and per-market settings). Nothing ever leaves
 * the browser: localStorage for JSON, IndexedDB for the font blob.
 * ========================================================== */
const VASStorage = (() => {
  const LS_PREFIX = "vasLabel.";
  const DB_NAME = "vasLabelFonts";
  const STORE = "fonts";

  // ---- localStorage (master rows + settings, JSON) ----------------------
  function setJSON(key, value) {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error("localStorage write failed", e);
      return false;
    }
  }
  function getJSON(key, fallback = null) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function remove(key) {
    localStorage.removeItem(LS_PREFIX + key);
  }

  function saveLockedMaster(marketId, payload) {
    // payload: { fileName, sheetName, headerRowIndex, colMap, rows, savedAt }
    return setJSON(`master.${marketId}`, payload);
  }
  function getLockedMaster(marketId) {
    return getJSON(`master.${marketId}`, null);
  }
  function clearLockedMaster(marketId) {
    remove(`master.${marketId}`);
  }

  function saveMarketSettings(marketId, settings) {
    return setJSON(`settings.${marketId}`, settings);
  }
  function getMarketSettings(marketId) {
    return getJSON(`settings.${marketId}`, {});
  }

  // ---- IndexedDB (custom font binary) ------------------------------------
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveCustomFont(name, arrayBuffer) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ name, bytes: arrayBuffer, savedAt: Date.now() }, "customFont");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getCustomFont() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("customFont");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearCustomFont() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete("customFont");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    saveLockedMaster, getLockedMaster, clearLockedMaster,
    saveMarketSettings, getMarketSettings,
    saveCustomFont, getCustomFont, clearCustomFont,
  };
})();
