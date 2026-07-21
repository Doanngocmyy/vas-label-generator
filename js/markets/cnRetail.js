/* ==========================================================
 * cnRetail.js — port of CN_COO_SimHei_FULL.py
 * 5x5cm labels, 2-up on a 10x5cm no-gap roll page.
 * Master matched by SKU (货号2 -> fallback 货号) OR EAN.
 * Origin/CO always comes from the EAN/filter file, never master.
 * Output split into CN / VN / OTHER PDFs.
 * ========================================================== */
(function () {
  const U = VASUtils;

  const FIELDS = [
    "品名", "品牌", "货号", "EAN", "品类", "颜色", "材质",
    "合格（检验）标识", "安全类别", "进口商", "地址", "联系电话", "原产地", "零售價格",
  ];
  const COL_EAN = "EAN";
  const COL_SKU_PRIMARY = "货号2";
  const COL_SKU_FALLBACK = "货号";
  const COL_PRICE = "零售價格";
  const COL_ORIGIN = "原产地";

  const FILTER_SKU_ALIASES = ["SKU", "ITEM CODE", "ITEMCODE", "货号", "貨號", "产品编号", "PRODUCT CODE"];
  const FILTER_EAN_ALIASES = ["EAN", "BARCODE", "BAR CODE", "条码", "條碼"];
  const FILTER_CO_ALIASES = ["CO", "COO", "ORIGIN", "COUNTRY OF ORIGIN", "MADE IN", "原产地", "產地", "COUNTRY"];

  function chooseMatchSKU(row, cmap) {
    const primary = U.normalizeSKU(U.getByHeader(row, cmap, COL_SKU_PRIMARY));
    if (primary) return primary;
    return U.normalizeSKU(U.getByHeader(row, cmap, COL_SKU_FALLBACK));
  }
  function chooseDisplaySKU(row, cmap) {
    const display = U.cleanText(U.getByHeader(row, cmap, COL_SKU_FALLBACK));
    if (display) return display;
    return U.cleanText(U.getByHeader(row, cmap, COL_SKU_PRIMARY));
  }

  function loadFilterEntries(workbook, log) {
    // Reads every sheet, row 0 = header, matches Python's concat-all-sheets.
    const entries = [];
    const seen = new Set();
    for (const sheetName of workbook.SheetNames) {
      const rows = U.sheetToRows(workbook, sheetName);
      if (!rows.length) continue;
      const header = rows[0];
      const eanCol = U.findColByAlias(header, FILTER_EAN_ALIASES);
      const skuCol = U.findColByAlias(header, FILTER_SKU_ALIASES);
      const coCol = U.findColByAlias(header, FILTER_CO_ALIASES);
      if (eanCol === -1 && skuCol === -1) continue;
      if (coCol === -1) {
        log(`[WARN] Sheet "${sheetName}" trong EAN list không có cột CO/Origin — bỏ qua sheet này.`);
        continue;
      }
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const sku = skuCol >= 0 ? U.normalizeSKU(row[skuCol]) : "";
        const ean = eanCol >= 0 ? U.normalizeEAN(row[eanCol]) : "";
        const rawCo = coCol >= 0 ? row[coCol] : "";
        const originText = U.formatOriginCN(rawCo);
        if (!sku && !ean) continue;
        if (!originText) {
          log(`[WARN] Sheet "${sheetName}" dòng ${r + 1} thiếu CO/Origin. SKU=${sku} EAN=${ean} — bỏ qua dòng này.`);
          continue;
        }
        const key = `${sku}|${ean}|${originText}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ sku, ean, origin: originText, bucket: U.originBucketCN(originText), rawCo: U.cleanText(rawCo), sheetName, rowNum: r + 1 });
      }
    }
    return entries;
  }

  async function generate({ masterRows, filterWorkbook, settings, log }) {
    if (!masterRows || masterRows.length < 2) throw new Error("Master data trống hoặc chưa chọn đúng sheet.");
    const header = masterRows[0];
    const cmap = U.buildColMapExact(header);
    if (!(U.normalizeHeaderExact(COL_EAN) in cmap)) {
      throw new Error(`Master thiếu cột bắt buộc "${COL_EAN}". Cột hiện có: ${header.join(", ")}`);
    }

    const bySku = new Map();
    const byEan = new Map();
    for (let i = 1; i < masterRows.length; i++) {
      const row = masterRows[i];
      const sku = chooseMatchSKU(row, cmap);
      const ean = U.normalizeEAN(U.getByHeader(row, cmap, COL_EAN));
      if (sku && !bySku.has(sku)) bySku.set(sku, row);
      if (ean && !byEan.has(ean)) byEan.set(ean, row);
    }
    log(`[INFO] Master rows: ${masterRows.length - 1}`);

    const filterEntries = loadFilterEntries(filterWorkbook, log);
    log(`[INFO] Filter request rows: ${filterEntries.length}`);

    const bucketLabels = { CN: [], VN: [], OTHER: [] };
    let unmatched = 0, skipped = 0;

    for (const entry of filterEntries) {
      let row = null, matchBy = "";
      if (entry.sku && bySku.has(entry.sku)) { row = bySku.get(entry.sku); matchBy = "SKU"; }
      else if (entry.ean && byEan.has(entry.ean)) { row = byEan.get(entry.ean); matchBy = "EAN"; }
      if (!row) { unmatched++; continue; }

      const eanDisplay = U.normalizeEAN(entry.ean) || U.normalizeEAN(U.getByHeader(row, cmap, COL_EAN));
      if (U.isNaValue(eanDisplay)) { skipped++; continue; }
      if (U.isNaValue(entry.origin)) { skipped++; continue; }

      const fields = {};
      for (const f of FIELDS) {
        if (f === "EAN") fields[f] = eanDisplay;
        else if (f === "货号") fields[f] = chooseDisplaySKU(row, cmap);
        else if (f === COL_ORIGIN) fields[f] = entry.origin;
        else if (f === COL_PRICE) fields[f] = U.formatCNYPrice(U.getByHeader(row, cmap, COL_PRICE), "symbol");
        else fields[f] = U.cleanText(U.getByHeader(row, cmap, f));
      }
      bucketLabels[entry.bucket].push({ fields, sku: fields["货号"], ean: eanDisplay, origin: entry.origin, matchBy });
    }

    log(`[INFO] Matched: CN=${bucketLabels.CN.length} VN=${bucketLabels.VN.length} OTHER=${bucketLabels.OTHER.length} | Unmatched=${unmatched} | Skipped=${skipped}`);

    const files = [];
    const fontSize = settings.fontSize || 6;
    for (const bucket of ["CN", "VN", "OTHER"]) {
      const labels = bucketLabels[bucket];
      if (!labels.length) continue;
      const { pdfDoc, font, boldOffsetPt } = await VASPdf.createDoc("cnRetail");
      for (const label of labels) {
        const page = pdfDoc.addPage([U.mm(100), U.mm(50)]);
        const rows = FIELDS.map(f => ({ key: f, value: label.fields[f] || "" }));
        for (const slotX of [0, 50]) {
          VASPdf.drawBorderedKVTable({
            page, font, x: slotX + 1.2, y: 1.2, w: 50 - 2 * 1.2, h: 50 - 2 * 1.2,
            rows, leftColRatio: 0.25, fontSize, lineHeightFactor: 1.0,
            innerPadX: 0.35, cellPadY: 0.10, borderWidth: 0.28, boldOffsetPt,
          });
        }
      }
      const bytes = await pdfDoc.save();
      files.push({ name: `CN_Labels_ORIGIN_${bucket}_2UP_10x5.pdf`, blob: new Blob([bytes], { type: "application/pdf" }), count: labels.length });
    }

    const summaryRows = [["bucket", "sku", "ean", "origin", "match_by"]];
    for (const bucket of ["CN", "VN", "OTHER"]) {
      for (const l of bucketLabels[bucket]) summaryRows.push([bucket, l.sku, l.ean, l.origin, l.matchBy]);
    }
    const csv = summaryRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    files.push({ name: "CN_Retail_Labels_Summary.csv", blob: new Blob([csv], { type: "text/csv;charset=utf-8" }), count: summaryRows.length - 1 });

    return { files, stats: { matched: filterEntries.length - unmatched, unmatched, skipped } };
  }

  window.VASMarkets = window.VASMarkets || {};
  window.VASMarkets.cnRetail = {
    id: "cnRetail",
    label: "CN Retail",
    defaultSettings: { fontSize: 6 },
    optionFields: [
      { key: "fontSize", label: "Cỡ chữ (pt)", type: "number", min: 4, max: 10, step: 0.5 },
    ],
    generate,
  };
})();
