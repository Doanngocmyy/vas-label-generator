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

  // Fonts are locked PER MARKET GROUP now (not one shared font for
  // everything): "cn" = CN Retail + CN Tmall (SimHei Bold), "intl" = SG + KR
  // (Calibri). groupId must be one of VASUtils.FONT_GROUPS' keys.
  async function saveCustomFont(groupId, name, arrayBuffer) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ name, bytes: arrayBuffer, savedAt: Date.now() }, `customFont.${groupId}`);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getCustomFont(groupId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(`customFont.${groupId}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearCustomFont(groupId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(`customFont.${groupId}`);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // One-time upgrade: sites built before the per-group font split stored a
  // single font under the plain "customFont" key and used it everywhere.
  // If that legacy key still exists and the "cn" group hasn't been locked
  // yet, carry it over as a starting point for the CN group (closest to the
  // original SimHei/SimSun use case) so nobody silently loses their upload.
  // The "intl" (SG/KR — Calibri) slot is intentionally left for a fresh
  // upload since the legacy font was very unlikely to already be Calibri.
  async function migrateLegacyFontIfNeeded() {
    try {
      const db = await openDB();
      const legacy = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get("customFont");
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (!legacy) return;
      const cnExisting = await getCustomFont("cn");
      if (!cnExisting) {
        await saveCustomFont("cn", legacy.name, legacy.bytes);
      }
    } catch (e) {
      console.warn("Legacy font migration skipped:", e);
    }
  }

  return {
    saveLockedMaster, getLockedMaster, clearLockedMaster,
    saveMarketSettings, getMarketSettings,
    saveCustomFont, getCustomFont, clearCustomFont, migrateLegacyFontIfNeeded,
  };
})();
