/* ==========================================================
 * cnTmall.js — port of CN_Tmall_FINAL.ipynb
 * 5x5cm labels, 2-up on a 10x5cm no-gap roll page.
 * Template (BAGS / ADAPTERS / STRAPS) is chosen per-row from the
 * "Cat" column. Origin split (CN/VN) comes from master's 原产地
 * column directly (NOT overridden by the filter file, unlike CN Retail).
 * Filter file only decides WHICH rows get a label (match by EAN or SKU).
 * ========================================================== */
(function () {
  const U = VASUtils;

  const COL_EAN = "EAN";
  const COL_SKU_PRIMARY = "货号2";
  const COL_SKU_FALLBACK = "货号";
  const COL_ORIGIN = "原产地";
  const COL_CAT = "Cat";
  const STD_SOURCE_COL = "安全类别";
  const PRICE_FIELD = "零售價格";

  const BASE_FIELDS_BAGS = ["品名", "品牌", "货号", "EAN", "品类", "颜色", "材质", "合格（检验）标识", "产品标准", "进口商", "地址", "联系电话", "原产地"];
  const BASE_FIELDS_ADAPTERS = ["品名", "品牌", "货号", "EAN", "颜色", "材质", "合格（检验）标识", "执行标准", "进口商", "地址", "联系电话", "原产地"];
  const BASE_FIELDS_STRAPS = ["品名", "品牌", "货号", "EAN", "规格", "颜色", "材质", "合格（检验）标识", "安全类别", "进口商", "地址", "联系电话", "原产地"];

  function templateFields(includePrice) {
    const out = { BAGS: [...BASE_FIELDS_BAGS], ADAPTERS: [...BASE_FIELDS_ADAPTERS], STRAPS: [...BASE_FIELDS_STRAPS] };
    if (includePrice) for (const k of Object.keys(out)) out[k].push(PRICE_FIELD);
    return out;
  }

  function chooseMatchSKU(row, cmap) {
    const primary = U.normalizeSKU(U.getByHeader(row, cmap, COL_SKU_PRIMARY));
    if (primary) return primary;
    return U.normalizeSKU(U.getByHeader(row, cmap, COL_SKU_FALLBACK));
  }
  function chooseDisplaySKU(row, cmap) {
    const s = U.cleanText(U.getByHeader(row, cmap, COL_SKU_FALLBACK));
    if (s) return s;
    return U.cleanText(U.getByHeader(row, cmap, COL_SKU_PRIMARY));
  }

  function classifyTemplate(row, cmap) {
    const cat = U.cleanText(U.getByHeader(row, cmap, COL_CAT));
    const low = cat.toLowerCase();
    if (!cat) return "STRAPS";
    if (low.includes("bags") || low.includes("1 piece/bag")) return "BAGS";
    if (low.includes("adapters")) return "ADAPTERS";
    return "STRAPS";
  }

  function classifyOrigin(row, cmap) {
    const raw = U.getByHeader(row, cmap, COL_ORIGIN);
    return U.classifyOriginGroupCN(raw); // {group: 'CN'|'VN'|null, raw}
  }

  function loadFilterSets(workbook, log) {
    const eanSet = new Set();
    const skuSet = new Set();
    for (const sheetName of workbook.SheetNames) {
      const rows = U.sheetToRows(workbook, sheetName);
      if (!rows.length) continue;
      const header = rows[0];
      let eanCol = -1, skuCol = -1;
      header.forEach((h, i) => {
        const n = U.normalizeHeaderExact(h);
        if (eanCol === -1 && (n.includes("EAN") || n.includes("BARCODE"))) eanCol = i;
        if (skuCol === -1 && (n.includes("SKU") || n.includes("ITEM CODE") || n.includes("货号") || n.includes("ITEMCODE"))) skuCol = i;
      });
      if (eanCol === -1 && skuCol === -1) continue;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (eanCol >= 0) { const e = U.normalizeEAN(row[eanCol]); if (e) eanSet.add(e); }
        if (skuCol >= 0) { const s = U.normalizeSKU(row[skuCol]); if (s) skuSet.add(s); }
      }
    }
    log(`[INFO] Filter unique EAN: ${eanSet.size}, unique SKU: ${skuSet.size}`);
    return { eanSet, skuSet };
  }

  function buildFieldValue(fieldName, row, cmap, includePrice) {
    if (fieldName === "EAN") return U.normalizeEAN(U.getByHeader(row, cmap, COL_EAN));
    if (fieldName === "货号") return chooseDisplaySKU(row, cmap);
    if (fieldName === "产品标准" || fieldName === "执行标准") return U.cleanText(U.getByHeader(row, cmap, STD_SOURCE_COL));
    if (fieldName === PRICE_FIELD) return U.formatCNYPrice(U.getByHeader(row, cmap, PRICE_FIELD), "symbol");
    return U.cleanText(U.getByHeader(row, cmap, fieldName));
  }

  async function generate({ masterRows, filterWorkbook, settings, log }) {
    if (!masterRows || masterRows.length < 2) throw new Error("Master data trống hoặc chưa chọn đúng sheet.");
    const header = masterRows[0];
    const cmap = U.buildColMapExact(header);
    for (const req of [COL_EAN, COL_ORIGIN]) {
      if (!(U.normalizeHeaderExact(req) in cmap)) throw new Error(`Master thiếu cột bắt buộc "${req}".`);
    }

    const { eanSet, skuSet } = loadFilterSets(filterWorkbook, log);
    const includePrice = !!settings.includePrice;
    const fields = templateFields(includePrice);
    const fontSize = settings.fontSize || 6;

    const buckets = { CN: [], VN: [] };
    let matched = 0, unmatchedOrigin = 0, notInFilter = 0;

    for (let i = 1; i < masterRows.length; i++) {
      const row = masterRows[i];
      const rowEan = U.normalizeEAN(U.getByHeader(row, cmap, COL_EAN));
      const rowSku = chooseMatchSKU(row, cmap);
      const eanMatch = rowEan && eanSet.has(rowEan);
      const skuMatch = rowSku && skuSet.has(rowSku);
      if (!eanMatch && !skuMatch) { notInFilter++; continue; }

      const { group } = classifyOrigin(row, cmap);
      if (!group) { unmatchedOrigin++; continue; }

      const ean = U.normalizeEAN(U.getByHeader(row, cmap, COL_EAN));
      if (U.isNaValue(ean)) continue;

      const template = classifyTemplate(row, cmap);
      const rowFields = {};
      for (const f of fields[template]) rowFields[f] = buildFieldValue(f, row, cmap, includePrice);

      buckets[group].push({ template, fields: rowFields, sku: chooseDisplaySKU(row, cmap), ean });
      matched++;
    }

    log(`[INFO] Matched rows: ${matched} | Not in filter: ${notInFilter} | Unknown origin (skipped): ${unmatchedOrigin}`);
    log(`[INFO] CN=${buckets.CN.length} VN=${buckets.VN.length}`);

    const files = [];
    for (const bucket of ["CN", "VN"]) {
      const labels = buckets[bucket];
      if (!labels.length) continue;
      const { pdfDoc, font, boldOffsetPt } = await VASPdf.createDoc("cnTmall");
      for (const label of labels) {
        const page = pdfDoc.addPage([U.mm(100), U.mm(50)]);
        const rows = fields[label.template].map(f => ({ key: f, value: label.fields[f] || "" }));
        for (const slotX of [0, 50]) {
          VASPdf.drawBorderedKVTable({
            page, font, x: slotX + 0.8, y: 0.8, w: 50 - 2 * 0.8, h: 50 - 2 * 0.8,
            rows, leftColRatio: 0.24, fontSize, lineHeightFactor: 1.0,
            innerPadX: 0.45, cellPadY: 0.10, borderWidth: 0.4, boldOffsetPt,
          });
        }
      }
      const bytes = await pdfDoc.save();
      files.push({ name: `${bucket}_TMALL_Labels_10x5cm_NoGap.pdf`, blob: new Blob([bytes], { type: "application/pdf" }), count: labels.length });
    }

    const summaryRows = [["bucket", "template", "sku", "ean"]];
    for (const bucket of ["CN", "VN"]) for (const l of buckets[bucket]) summaryRows.push([bucket, l.template, l.sku, l.ean]);
    const csv = summaryRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    files.push({ name: "CN_Tmall_Labels_Summary.csv", blob: new Blob([csv], { type: "text/csv;charset=utf-8" }), count: summaryRows.length - 1 });

    return { files, stats: { matched, notInFilter, unmatchedOrigin } };
  }

  window.VASMarkets = window.VASMarkets || {};
  window.VASMarkets.cnTmall = {
    id: "cnTmall",
    label: "CN Tmall",
    defaultSettings: { fontSize: 6, includePrice: false },
    optionFields: [
      { key: "fontSize", label: "Cỡ chữ (pt)", type: "number", min: 4, max: 10, step: 0.5 },
      { key: "includePrice", label: "In thêm giá bán lẻ (零售價格)", type: "checkbox" },
    ],
    generate,
  };
})();
