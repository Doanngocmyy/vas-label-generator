/* ==========================================================
 * kr.js — port of KR_COO_5PT_V2-Update.ipynb ("Qty mode") and
 * KR_Latest.ipynb ("EAN-list mode"). Both share the same 4x3cm
 * label, rotated 90° into a 9x4cm roll page, 3 labels/page.
 * ========================================================== */
(function () {
  const U = VASUtils;

  const FIELD_ALIASES_BASE = {
    "Item Code": ["sku code", "sku", "item code", "product code", "item"],
    "Description": ["description", "item description", "product description", "product name"],
    "EAN": ["ean", "barcode", "bar code"],
    "Currency": ["currency", "curr"],
    "Price": ["price per pcs", "price per piece", "unit price", "price", "rrp", "retail price"],
    "CO": ["vendor check by kec", "manufacturer country", "country of origin", "origin", "co", "coo", "made in"],
  };
  const FIELD_ALIASES_QTY = { "Qty Label Request": ["qty label request", "quantity label request", "label request", "qty request", "label qty", "qty label", "quantity", "qty"], ...FIELD_ALIASES_BASE };

  const FILTER_SKU_ALIASES = ["sku", "sku code", "item code", "product code", "item"];
  const FILTER_EAN_ALIASES = ["ean", "barcode", "bar code"];
  const FILTER_CO_ALIASES = ["co", "coo", "origin", "country of origin", "manufacturer country", "made in"];

  const ROW_RATIOS_RAW = [0.18, 0.40, 0.14, 0.14, 0.14];
  const ROW_SUM = ROW_RATIOS_RAW.reduce((a, b) => a + b, 0);
  const ROW_RATIOS = ROW_RATIOS_RAW.map(r => r / ROW_SUM);
  const LABEL_ROWS = [["Item Code", "Item Code"], ["Item\nDescription", "Description"], ["RRP", "RRP"], ["EAN", "EAN"], ["CO", "CO"]];

  function formatRRP(price) {
    const priceText = U.preserveExactPriceText(price);
    if (!priceText) return "";
    if (priceText.includes("₩")) return priceText;
    return `₩ ${priceText}`;
  }

  function parseQty(v) {
    const s = U.cleanText(v).replace(/,/g, "");
    if (!s) return 0;
    const n = parseInt(parseFloat(s));
    return Number.isNaN(n) ? 0 : n;
  }

  function loadFilter(workbook, log) {
    // First sheet only (matches pd.read_excel default sheet_name=0).
    const sheetName = workbook.SheetNames[0];
    const rows = U.sheetToRows(workbook, sheetName);
    if (!rows.length) throw new Error("File EAN list trống.");
    const header = rows[0];
    const skuCol = U.findColByAlias(header, FILTER_SKU_ALIASES);
    const eanCol = U.findColByAlias(header, FILTER_EAN_ALIASES);
    const coCol = U.findColByAlias(header, FILTER_CO_ALIASES);
    if (skuCol === -1) throw new Error(`EAN List cần có cột SKU. Cột hiện có: ${header.join(", ")}`);

    const requestedSkus = [];
    const eanBySku = new Map();
    const coBySku = new Map();
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const sku = U.normalizeSKU(row[skuCol]);
      if (!sku) continue;
      requestedSkus.push(sku);
      if (eanCol >= 0) { const e = U.normalizeEAN(row[eanCol]); if (e) eanBySku.set(sku, e); }
      if (coCol >= 0) { const c = U.formatCOEnglish(row[coCol]); if (c && c !== "to be confirm") coBySku.set(sku, c); }
    }
    const uniqueSkus = U.uniqueKeepOrder(requestedSkus);
    log(`[INFO] EAN list SKU: ${uniqueSkus.length}`);
    return { requestedSkus: uniqueSkus, eanBySku, coBySku };
  }

  function loadMasterRecords({ rows, mode, targetSkus, eanBySku, coBySku, log }) {
    const aliases = mode === "qty" ? FIELD_ALIASES_QTY : FIELD_ALIASES_BASE;
    const required = mode === "qty" ? ["Qty Label Request", "Item Code"] : ["Item Code"];
    const detected = U.detectHeaderRow(rows, aliases, required, 30);
    if (detected.headerRowIndex === -1 || required.some(f => !(f in detected.colMap))) {
      throw new Error(`Không tìm thấy đủ cột lõi trong Master (cần tối thiểu: ${required.join(", ")}). Kiểm tra lại sheet đã chọn.`);
    }
    log(`[INFO] Header row detected at row ${detected.headerRowIndex + 1}, fields: ${JSON.stringify(detected.colMap)}`);

    const records = [];
    for (let r = detected.headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      const get = (field) => (field in detected.colMap ? row[detected.colMap[field]] : "");
      const itemCode = U.cleanText(get("Item Code"));
      const skuKey = U.normalizeSKU(itemCode);
      if (targetSkus && !targetSkus.has(skuKey)) continue;

      let ean = U.normalizeEAN(get("EAN"));
      if (eanBySku.has(skuKey)) ean = eanBySku.get(skuKey);
      const desc = U.cleanText(get("Description"));
      const price = U.preserveExactPriceText(get("Price"));
      const rrp = formatRRP(price);
      let co = U.formatCOEnglish(get("CO"));
      if (coBySku.has(skuKey)) co = coBySku.get(skuKey);

      if (!itemCode && !ean && !desc) continue;

      let pageRequest;
      if (mode === "qty") {
        const qty = parseQty(get("Qty Label Request"));
        if (qty <= 0) continue;
        pageRequest = Math.ceil(qty / 3);
      } else {
        pageRequest = 1;
      }
      records.push({ itemCode, skuKey, ean, desc, rrp, co, pageRequest });
    }
    return records;
  }

  async function generate({ masterRows, filterWorkbook, settings, log }) {
    if (!masterRows || masterRows.length < 2) throw new Error("Master data trống hoặc chưa chọn đúng sheet.");
    const mode = settings.mode === "eanList" ? "eanList" : "qty";
    const fontSize = settings.fontSize || 6;

    let targetSkus = null, eanBySku = new Map(), coBySku = new Map(), requestedSkus = [];
    const useFilter = mode === "eanList" || !!settings.useEanFilter;
    if (useFilter) {
      if (!filterWorkbook) throw new Error(`Mode "${mode === "eanList" ? "EAN List" : "Qty + filter"}" bắt buộc phải có file EAN/filter.`);
      const f = loadFilter(filterWorkbook, log);
      requestedSkus = f.requestedSkus;
      eanBySku = f.eanBySku;
      coBySku = f.coBySku;
      targetSkus = new Set(requestedSkus);
    }

    let records = loadMasterRecords({ rows: masterRows, mode, targetSkus, eanBySku, coBySku, log });

    if (mode === "eanList") {
      const order = new Map(requestedSkus.map((s, i) => [s, i]));
      records.sort((a, b) => (order.get(a.skuKey) ?? 1e9) - (order.get(b.skuKey) ?? 1e9));
      const foundSet = new Set(records.map(r => r.skuKey));
      const missing = requestedSkus.filter(s => !foundSet.has(s));
      if (missing.length) log(`[WARN] ${missing.length} SKU trong EAN list không tìm thấy trong master: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "..." : ""}`);
    }

    log(`[INFO] Total label rows: ${records.length}`);
    if (!records.length) throw new Error("Không có dữ liệu để tạo tem (kiểm tra lại Master / EAN list / sheet).");

    const { pdfDoc, font } = await VASPdf.createDoc();
    const PAGE_W = 90, PAGE_H = 40, SLOT_W = 30, SLOT_H = 40, RAW_W = 40, RAW_H = 30;
    let totalPages = 0;
    for (const rec of records) {
      for (let p = 0; p < rec.pageRequest; p++) {
        const page = pdfDoc.addPage([U.mm(PAGE_W), U.mm(PAGE_H)]);
        const rowsForLabel = LABEL_ROWS.map(([hdr, key]) => ({ key: hdr, value: rec[{ "Item Code": "itemCode", "Description": "desc", "RRP": "rrp", "EAN": "ean", "CO": "co" }[key]] || "" }));
        for (let i = 0; i < 3; i++) {
          const slotX = i * SLOT_W;
          VASPdf.drawKRLabelRotated({
            page, font, slotX, slotY: 0, slotW: SLOT_W, slotH: SLOT_H,
            rawLabelW: RAW_W, rawLabelH: RAW_H, rows: rowsForLabel, rowRatios: ROW_RATIOS,
            leftColRatio: 0.35, fontSize, lineHeightFactor: 1.0,
            outerMarginX: 2.0, outerMarginY: 1.8, innerPadX: 0.35, innerPadY: 0.25,
            borderWidth: 0.30, innerBorderWidth: 0.25,
          });
        }
        totalPages++;
      }
    }
    log(`[INFO] Total PDF pages: ${totalPages} (x3 labels = ${totalPages * 3})`);
    const bytes = await pdfDoc.save();
    const files = [{
      name: mode === "qty" ? "KR_Label_9x4cm_ROLL_3UP_ROTATED_NOGAP_6PT.pdf" : "KR_Label_FILTERED_BY_EAN_9x4cm_ROLL_3UP_ROTATED_NOGAP_6PT.pdf",
      blob: new Blob([bytes], { type: "application/pdf" }), count: records.length,
    }];

    const summaryRows = [["Item Code", "Page Request", "EAN", "Description", "RRP", "CO"]];
    for (const r of records) summaryRows.push([r.itemCode, r.pageRequest, r.ean, r.desc, r.rrp, r.co]);
    const csv = summaryRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    files.push({ name: "KR_Label_Summary.csv", blob: new Blob([csv], { type: "text/csv;charset=utf-8" }), count: summaryRows.length - 1 });

    return { files, stats: { records: records.length, pages: totalPages } };
  }

  window.VASMarkets = window.VASMarkets || {};
  window.VASMarkets.kr = {
    id: "kr",
    label: "KR",
    defaultSettings: { fontSize: 6, mode: "qty", useEanFilter: false },
    optionFields: [
      { key: "mode", label: "Chế độ", type: "select", options: [
        { value: "qty", label: "Theo Qty Label Request (làm tròn lên /3 trang)" },
        { value: "eanList", label: "Theo EAN List (bắt buộc) — 1 SKU = 1 trang = 3 tem" },
      ] },
      { key: "useEanFilter", label: "Dùng EAN list để lọc/ghi đè CO (chỉ áp dụng ở chế độ Qty)", type: "checkbox" },
      { key: "fontSize", label: "Cỡ chữ (pt)", type: "number", min: 4, max: 10, step: 0.5 },
    ],
    generate,
  };
})();
