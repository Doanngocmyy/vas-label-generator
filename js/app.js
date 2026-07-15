/* ==========================================================
 * app.js — UI orchestration: market tabs, master upload + sheet
 * picker, EAN/filter upload, font upload, options, generate.
 * ========================================================== */
(function () {
  const U = VASUtils;

  const els = {
    tabs: document.getElementById("marketTabs"),
    masterUpdateToggle: document.getElementById("masterUpdateToggle"),
    masterFileRow: document.getElementById("masterFileRow"),
    masterFileInput: document.getElementById("masterFileInput"),
    masterClearBtn: document.getElementById("masterClearBtn"),
    masterStatus: document.getElementById("masterStatus"),
    filterFileInput: document.getElementById("filterFileInput"),
    filterStatus: document.getElementById("filterStatus"),
    fontUpdateToggle: document.getElementById("fontUpdateToggle"),
    fontFileRow: document.getElementById("fontFileRow"),
    fontFileInput: document.getElementById("fontFileInput"),
    fontClearBtn: document.getElementById("fontClearBtn"),
    fontStatus: document.getElementById("fontStatus"),
    marketOptions: document.getElementById("marketOptions"),
    generateBtn: document.getElementById("generateBtn"),
    genLog: document.getElementById("genLog"),
    resultFiles: document.getElementById("resultFiles"),
    sheetModalOverlay: document.getElementById("sheetModalOverlay"),
    sheetList: document.getElementById("sheetList"),
    sheetModalHint: document.getElementById("sheetModalHint"),
    sheetModalCancel: document.getElementById("sheetModalCancel"),
    sheetModalConfirm: document.getElementById("sheetModalConfirm"),
  };

  let currentMarketId = "cnRetail";
  let filterWorkbook = null;
  let filterFileName = "";
  let pendingWorkbook = null; // used while sheet-picker modal is open
  let pendingFileName = "";
  let selectedSheetName = null;

  function currentMarket() { return window.VASMarkets[currentMarketId]; }

  function log(msg) {
    const time = new Date().toLocaleTimeString();
    els.genLog.textContent += `[${time}] ${msg}\n`;
    els.genLog.scrollTop = els.genLog.scrollHeight;
  }
  function clearLog() { els.genLog.textContent = ""; }

  // ---------------- Market tabs ----------------
  els.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    currentMarketId = btn.dataset.market;
    [...els.tabs.children].forEach(b => b.classList.toggle("active", b === btn));
    refreshMasterStatus();
    renderMarketOptions();
    updateGenerateEnabled();
    els.resultFiles.innerHTML = "";
    clearLog();
  });

  // ---------------- Master: update toggle ----------------
  els.masterUpdateToggle.addEventListener("change", () => {
    const val = els.masterUpdateToggle.querySelector('input[name="masterUpdate"]:checked').value;
    els.masterFileRow.style.display = val === "yes" ? "flex" : "none";
  });
  els.masterFileRow.style.display = "none";

  els.masterFileInput.addEventListener("change", async () => {
    const file = els.masterFileInput.files[0];
    if (!file) return;
    try {
      const wb = await U.readWorkbookFromFile(file);
      pendingWorkbook = wb;
      pendingFileName = file.name;
      openSheetModal(wb, file.name);
    } catch (e) {
      setStatus(els.masterStatus, `Lỗi đọc file: ${e.message}`, "err");
    }
  });

  els.masterClearBtn.addEventListener("click", () => {
    VASStorage.clearLockedMaster(currentMarketId);
    refreshMasterStatus();
    updateGenerateEnabled();
  });

  function refreshMasterStatus() {
    const locked = VASStorage.getLockedMaster(currentMarketId);
    if (!locked) {
      setStatus(els.masterStatus, `Chưa có master data nào được khoá cho ${currentMarket().label}.`, "empty");
      return;
    }
    const savedDate = new Date(locked.savedAt).toLocaleString();
    setStatus(
      els.masterStatus,
      `Đã khoá: "${locked.fileName}" — sheet "${locked.sheetName}" (${locked.rows.length - 1} dòng dữ liệu).\nKhoá lúc: ${savedDate}`,
      "ok"
    );
  }

  // ---------------- Sheet picker modal ----------------
  function openSheetModal(workbook, fileName) {
    els.sheetModalHint.textContent = `File "${fileName}" có ${workbook.SheetNames.length} sheet. Chọn đúng sheet chứa Master Label Data cho ${currentMarket().label}.`;
    els.sheetList.innerHTML = "";
    selectedSheetName = null;
    els.sheetModalConfirm.disabled = true;

    workbook.SheetNames.forEach((name) => {
      const ws = workbook.Sheets[name];
      const ref = ws["!ref"] || "";
      let rowCount = 0, colCount = 0;
      if (ref) {
        try {
          const range = XLSX.utils.decode_range(ref);
          rowCount = range.e.r - range.s.r + 1;
          colCount = range.e.c - range.s.c + 1;
        } catch (e) { /* ignore */ }
      }
      const div = document.createElement("div");
      div.className = "sheet-option";
      div.innerHTML = `<div class="sheet-name">${escapeHtml(name)}</div><div class="sheet-meta">${rowCount} dòng × ${colCount} cột</div>`;
      div.addEventListener("click", () => {
        [...els.sheetList.children].forEach(c => c.classList.remove("selected"));
        div.classList.add("selected");
        selectedSheetName = name;
        els.sheetModalConfirm.disabled = false;
      });
      els.sheetList.appendChild(div);
    });

    els.sheetModalOverlay.classList.remove("hidden");
  }

  els.sheetModalCancel.addEventListener("click", () => {
    els.sheetModalOverlay.classList.add("hidden");
    els.masterFileInput.value = "";
  });

  els.sheetModalConfirm.addEventListener("click", () => {
    if (!selectedSheetName || !pendingWorkbook) return;
    const rows = U.sheetToRows(pendingWorkbook, selectedSheetName);
    VASStorage.saveLockedMaster(currentMarketId, {
      fileName: pendingFileName,
      sheetName: selectedSheetName,
      rows,
      savedAt: Date.now(),
    });
    els.sheetModalOverlay.classList.add("hidden");
    els.masterFileInput.value = "";
    // flip back to "no" (locked) after a successful lock, per the "update or not" UX
    els.masterUpdateToggle.querySelector('input[value="no"]').checked = true;
    els.masterFileRow.style.display = "none";
    refreshMasterStatus();
    updateGenerateEnabled();
  });

  // ---------------- Filter / EAN list ----------------
  els.filterFileInput.addEventListener("change", async () => {
    const file = els.filterFileInput.files[0];
    if (!file) { filterWorkbook = null; filterFileName = ""; refreshFilterStatus(); return; }
    try {
      filterWorkbook = await U.readWorkbookFromFile(file);
      filterFileName = file.name;
      refreshFilterStatus();
    } catch (e) {
      filterWorkbook = null;
      setStatus(els.filterStatus, `Lỗi đọc file: ${e.message}`, "err");
    }
  });

  function refreshFilterStatus() {
    if (!filterWorkbook) {
      setStatus(els.filterStatus, "Chưa upload file EAN/filter.", "empty");
      return;
    }
    setStatus(els.filterStatus, `Đã nạp: "${filterFileName}" (${filterWorkbook.SheetNames.length} sheet).`, "ok");
  }

  // ---------------- Font ----------------
  els.fontUpdateToggle.addEventListener("change", () => {
    const val = els.fontUpdateToggle.querySelector('input[name="fontUpdate"]:checked').value;
    els.fontFileRow.style.display = val === "yes" ? "flex" : "none";
  });
  els.fontFileRow.style.display = "none";

  els.fontFileInput.addEventListener("change", async () => {
    const file = els.fontFileInput.files[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      await VASStorage.saveCustomFont(file.name, buf);
      VASPdf.resetFontCache();
      els.fontUpdateToggle.querySelector('input[value="no"]').checked = true;
      els.fontFileRow.style.display = "none";
      els.fontFileInput.value = "";
      await refreshFontStatus();
    } catch (e) {
      setStatus(els.fontStatus, `Lỗi lưu font: ${e.message}`, "err");
    }
  });

  els.fontClearBtn.addEventListener("click", async () => {
    await VASStorage.clearCustomFont();
    VASPdf.resetFontCache();
    await refreshFontStatus();
  });

  async function refreshFontStatus() {
    try {
      const custom = await VASStorage.getCustomFont();
      if (custom) {
        setStatus(els.fontStatus, `Đang dùng font riêng đã khoá: "${custom.name}" (khoá lúc ${new Date(custom.savedAt).toLocaleString()}).`, "ok");
      } else {
        setStatus(els.fontStatus, "Đang dùng font mặc định: Noto Sans SC.", "empty");
      }
    } catch (e) {
      setStatus(els.fontStatus, "Đang dùng font mặc định: Noto Sans SC.", "empty");
    }
  }

  // ---------------- Market options ----------------
  function renderMarketOptions() {
    const market = currentMarket();
    const saved = VASStorage.getMarketSettings(market.id);
    const settings = { ...market.defaultSettings, ...saved };
    els.marketOptions.innerHTML = "";

    for (const field of market.optionFields) {
      const wrap = document.createElement("div");
      const label = document.createElement("label");

      if (field.type === "checkbox") {
        label.innerHTML = `<input type="checkbox" data-key="${field.key}" ${settings[field.key] ? "checked" : ""}> ${escapeHtml(field.label)}`;
      } else if (field.type === "select") {
        const opts = field.options.map(o => `<option value="${o.value}" ${settings[field.key] === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
        label.innerHTML = `${escapeHtml(field.label)} <select data-key="${field.key}">${opts}</select>`;
      } else if (field.type === "number") {
        label.innerHTML = `${escapeHtml(field.label)} <input type="number" data-key="${field.key}" value="${settings[field.key]}" min="${field.min ?? ""}" max="${field.max ?? ""}" step="${field.step ?? 1}" style="width:70px">`;
      } else {
        label.innerHTML = `${escapeHtml(field.label)} <input type="text" data-key="${field.key}" value="${settings[field.key] ?? ""}">`;
      }

      wrap.appendChild(label);
      els.marketOptions.appendChild(wrap);
    }

    els.marketOptions.querySelectorAll("[data-key]").forEach(input => {
      input.addEventListener("change", () => {
        const cur = { ...market.defaultSettings, ...VASStorage.getMarketSettings(market.id) };
        const key = input.dataset.key;
        let val;
        if (input.type === "checkbox") val = input.checked;
        else if (input.type === "number") val = parseFloat(input.value);
        else val = input.value;
        cur[key] = val;
        VASStorage.saveMarketSettings(market.id, cur);
      });
    });
  }

  // ---------------- Generate ----------------
  function updateGenerateEnabled() {
    const locked = VASStorage.getLockedMaster(currentMarketId);
    els.generateBtn.disabled = !locked;
  }

  els.generateBtn.addEventListener("click", async () => {
    clearLog();
    els.resultFiles.innerHTML = "";
    els.generateBtn.disabled = true;
    const market = currentMarket();
    try {
      const locked = VASStorage.getLockedMaster(currentMarketId);
      if (!locked) throw new Error("Chưa có master data đã khoá.");
      const settings = { ...market.defaultSettings, ...VASStorage.getMarketSettings(market.id) };
      log(`Bắt đầu tạo tem cho ${market.label}...`);
      log(`Master: "${locked.fileName}" / sheet "${locked.sheetName}"`);
      if (filterWorkbook) log(`Filter: "${filterFileName}"`); else log(`Filter: (không có)`);

      const result = await market.generate({
        masterRows: locked.rows,
        filterWorkbook,
        settings,
        log,
      });

      log(`HOÀN TẤT.`);
      renderResults(result.files);
    } catch (e) {
      console.error(e);
      log(`[ERROR] ${e.message}`);
    } finally {
      els.generateBtn.disabled = false;
    }
  });

  function renderResults(files) {
    els.resultFiles.innerHTML = "";
    for (const f of files) {
      const url = URL.createObjectURL(f.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.innerHTML = `⬇ ${escapeHtml(f.name)} <span class="count">(${f.count ?? ""})</span>`;
      els.resultFiles.appendChild(a);
    }
    if (!files.length) {
      els.resultFiles.innerHTML = `<div class="hint">Không có file nào được tạo (không có dòng nào khớp).</div>`;
    }
  }

  // ---------------- helpers ----------------
  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = "status-box " + { ok: "status-ok", warn: "status-warn", err: "status-err", empty: "status-empty" }[kind];
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------- init ----------------
  (async function init() {
    refreshMasterStatus();
    renderMarketOptions();
    await refreshFontStatus();
    updateGenerateEnabled();
  })();
})();
