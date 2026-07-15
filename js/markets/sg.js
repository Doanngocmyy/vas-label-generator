/* ==========================================================
 * sg.js — port of SG_COO_UP_6PT.ipynb
 * Vertical 3x4cm labels, 3-up on a 9x4cm no-gap roll page.
 * EAN/CO filter file is mandatory: CO for printing + splitting
 * always comes from the filter file, never the master.
 * Output split into one PDF per CO value (CN / VN / other).
 * ========================================================== */
(function () {
  const U = VASUtils;

  const MASTER_FIELD_ALIASES = {
    "EAN": ["EAN"],
    "Item Code": ["Item Code"],
    "Item Description": ["Item Description"],
    "Currency": ["Currency"],
    "RRP (SGD)": ["RRP (SGD)", "RRP SGD", "RRP"],
    "CO": ["CO"],
  };
  const REQUIRED = ["EAN", "Item Code", "Item Description", "Currency", "RRP (SGD)", "CO"];

  const FILTER_EAN_ALIASES = ["EAN", "Barcode", "Bar Code", "GTIN"];
  const FILTER_SKU_ALIASES = ["SKU", "Item Code", "Product Code", "Product_code", "ItemCode"];
  const FILTER_CO_ALIASES = ["CO", "C/O", "Origin", "Country of Origin", "Manufacturer Country", "Made In"];

  const COL_RATIOS_RAW = [0.18, 0.18, 0.33, 0.18, 0.13];
  const COL_SUM = COL_RATIOS_RAW.reduce((a, b) => a + b, 0);
  const COL_RATIOS = COL_RATIOS_RAW.map(r => r / COL_SUM);
  const HEADER_H = 7.2;

  function loadFilter(workbook, log) {
    const sheetName = workbook.SheetNames[0];
    const rows = U.sheetToRows(workbook, sheetName);
    if (!rows.length) throw new Error("File EAN list trống.");
    const header = rows[0];
    const eanCol = U.findColByAlias(header, FILTER_EAN_ALIASES);
    const skuCol = U.findColByAlias(header, FILTER_SKU_ALIASES);
    const coCol = U.findColByAlias(header, FILTER_CO_ALIASES);
    if (eanCol === -1) throw new Error("File EAN list phải có cột EAN.");
    if (coCol === -1) throw new Error("File EAN list phải có cột CO / Origin.");

    const byEan = new Map(); // ean -> {sku, ean, co}
    const order = [];
    const conflicts = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const ean = U.normalizeEAN(row[eanCol]);
      if (!ean) continue;
      const sku = skuCol >= 0 ? U.cleanText(row[skuCol]) : "";
      const co = U.canonicalCO(row[coCol]);
      if (byEan.has(ean)) {
        if (byEan.get(ean).co !== co) conflicts.push(ean);
        continue; // keep first, matches Python's drop_duplicates(keep='first')
      }
      byEan.set(ean, { sku, ean, co });
      order.push(ean);
    }
    if (conflicts.length) {
      log(`[WARN] EAN list có ${conflicts.length} EAN bị trùng nhưng CO khác nhau (giữ dòng đầu tiên): ${conflicts.slice(0, 10).join(", ")}${conflicts.length > 10 ? "..." : ""}`);
    }
    if (!byEan.size) throw new Error("Không đọc được EAN nào từ file EAN list.");
    log(`[INFO] EAN list rows: ${byEan.size}`);
    return { byEan, order };
  }

  function loadMaster(rows, log) {
    const detected = U.detectHeaderRow(rows, MASTER_FIELD_ALIASES, REQUIRED, 20);
    const missing = REQUIRED.filter(f => !(f in detected.colMap));
    if (detected.headerRowIndex === -1 || missing.length) {
      throw new Error(`Sheet master không có đủ header bắt buộc: ${REQUIRED.join(", ")}. Thiếu: ${missing.join(", ")}`);
    }
    log(`[INFO] Header row detected at row ${detected.headerRowIndex + 1}`);
    const byEan = new Map();
    for (let r = detected.headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      const get = (f) => row[detected.colMap[f]];
      const ean = U.normalizeEAN(get("EAN"));
      const itemCode = U.cleanText(get("Item Code"));
      const desc = U.cleanText(get("Item Description"));
      const currency = U.cleanText(get("Currency"));
      const rrp = U.preserveExactPriceText(get("RRP (SGD)"));
      const masterCo = U.cleanText(get("CO"));
      if (!(itemCode || ean || desc || currency || masterCo || rrp)) continue;
      if (!byEan.has(ean)) byEan.set(ean, { itemCode, ean, desc, currency, rrp, masterCo });
    }
    return byEan;
  }

  async function generate({ masterRows, filterWorkbook, settings, log }) {
    if (!masterRows || masterRows.length < 2) throw new Error("Master data trống hoặc chưa chọn đúng sheet.");
    if (!filterWorkbook) throw new Error("SG bắt buộc phải có file EAN/CO list.");
    const fontSize = settings.fontSize || 6;

    const { byEan: filterByEan, order } = loadFilter(filterWorkbook, log);
    const masterByEan = loadMaster(masterRows, log);

    const merged = [];
    const missing = [];
    for (const ean of order) {
      const f = filterByEan.get(ean);
      const m = masterByEan.get(ean);
      if (!m) { missing.push(ean); continue; }
      merged.push({ ean, sku: f.sku, itemCode: m.itemCode, desc: m.desc, currency: m.currency, rrp: m.rrp, co: f.co, masterCo: m.masterCo });
    }
    if (missing.length) log(`[WARN] ${missing.length} EAN trong filter không tìm thấy trong master: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "..." : ""}`);
    log(`[INFO] Found: ${merged.length} / Missing: ${missing.length}`);
    if (!merged.length) throw new Error("Không có dữ liệu để tạo tem.");

    const byCo = new Map();
    for (const rec of merged) {
      const suffix = U.coFileCode(rec.co);
      if (!byCo.has(suffix)) byCo.set(suffix, []);
      byCo.get(suffix).push(rec);
    }

    const files = [];
    const PAGE_W = 90, PAGE_H = 40, SLOT_W = 30, SLOT_H = 40;
    for (const [suffix, recs] of byCo.entries()) {
      const { pdfDoc, font } = await VASPdf.createDoc();
      for (const rec of recs) {
        const page = pdfDoc.addPage([U.mm(PAGE_W), U.mm(PAGE_H)]);
        const headers = ["EAN", "Item\nCode", "Item\nDesc.", "RRP\n(SGD)", "CO"];
        const values = [
          rec.ean, rec.itemCode, rec.desc,
          rec.rrp ? `SGD ${rec.rrp}` : "",
          rec.co,
        ];
        for (let i = 0; i < 3; i++) {
          VASPdf.drawSGLabel({
            page, font, slotX: i * SLOT_W, slotY: 0, slotW: SLOT_W, slotH: SLOT_H,
            headers, values, colRatios: COL_RATIOS, headerH: HEADER_H,
            outerMarginX: 1.35, outerMarginY: 1.35, fontSize, innerPadX: 0.30, innerPadY: 0.30, borderWidth: 0.25,
          });
        }
      }
      const bytes = await pdfDoc.save();
      files.push({ name: `SG_Label_5Fields_3UP_NOGAP_9x4CM_FIXED_6PT_${suffix}.pdf`, blob: new Blob([bytes], { type: "application/pdf" }), count: recs.length });
    }

    const summaryRows = [["CO", "EAN", "SKU", "Item Code", "Description", "RRP"]];
    for (const rec of merged) summaryRows.push([rec.co, rec.ean, rec.sku, rec.itemCode, rec.desc, rec.rrp]);
    const csv = summaryRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    files.push({ name: "SG_Label_Output_Summary.csv", blob: new Blob([csv], { type: "text/csv;charset=utf-8" }), count: summaryRows.length - 1 });

    return { files, stats: { found: merged.length, missing: missing.length } };
  }

  window.VASMarkets = window.VASMarkets || {};
  window.VASMarkets.sg = {
    id: "sg",
    label: "SG",
    defaultSettings: { fontSize: 6 },
    optionFields: [
      { key: "fontSize", label: "Cỡ chữ (pt)", type: "number", min: 4, max: 10, step: 0.5 },
    ],
    generate,
  };
})();
