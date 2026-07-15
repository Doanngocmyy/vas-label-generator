/* ==========================================================
 * pdfkit-labels.js — pdf-lib drawing helpers shared by all market
 * modules. Ports the reportlab drawing logic from the Python scripts.
 * ========================================================== */
const VASPdf = (() => {
  const { PDFDocument, rgb, degrees } = PDFLib;
  const mm = VASUtils.mm;

  let cachedFontBytes = null;
  let cachedFontLabel = null;
  async function loadFontBytes() {
    if (cachedFontBytes) return cachedFontBytes;
    // 1) A user-uploaded custom font (SimHei/SimSun...) always wins if locked.
    try {
      const custom = await VASStorage.getCustomFont();
      if (custom && custom.bytes) {
        cachedFontBytes = custom.bytes;
        cachedFontLabel = custom.name || "custom";
        return cachedFontBytes;
      }
    } catch (e) { /* IndexedDB unavailable, fall through to default */ }
    // 2) Bundled default (Noto Sans SC, open license, trimmed to GB2312 +
    // Latin/Vietnamese + currency symbols, layout tables stripped).
    const res = await fetch("fonts/default-cjk.ttf");
    if (!res.ok) throw new Error("Không tải được font mặc định fonts/default-cjk.ttf");
    cachedFontBytes = await res.arrayBuffer();
    cachedFontLabel = "Noto Sans SC (default)";
    return cachedFontBytes;
  }
  function resetFontCache() { cachedFontBytes = null; cachedFontLabel = null; }
  function currentFontLabel() { return cachedFontLabel; }

  async function createDoc() {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const fontBytes = await loadFontBytes();
    // IMPORTANT: subset:true corrupts glyphs with large CJK fonts under the
    // pdf-lib/fontkit combo used here (verified experimentally: characters
    // silently drop or overlap once more than a couple of glyphs get reused
    // across multiple drawText calls). We embed the full font instead —
    // costs roughly 1-2MB per output PDF but renders correctly every time.
    const font = await pdfDoc.embedFont(fontBytes, { subset: false });
    return { pdfDoc, font };
  }

  // ---- generic wrap using a pdf-lib font -------------------------------
  function wrapText(text, font, fontSize, maxWidth) {
    const cjk = VASUtils.containsCJK(text);
    return VASUtils.wrapByWidth(text, font, fontSize, maxWidth, cjk);
  }

  /* ----------------------------------------------------------------
   * drawBorderedKVTable — CN Retail / CN Tmall style label.
   * Non-rotated. 2-column key/value table, row heights proportional
   * to wrapped line count (mirrors measure_layout() in the Python code).
   * opts: { page, font, x, y, w, h, rows:[{key,value}], leftColRatio,
   *         fontSize, lineHeightFactor, innerPadX, cellPadY, borderWidth }
   * -------------------------------------------------------------- */
  function drawBorderedKVTable(opts) {
    const {
      page, font, x, y, w, h, rows,
      leftColRatio = 0.25, fontSize = 6, lineHeightFactor = 1.0,
      innerPadX = 0.35, cellPadY = 0.10, borderWidth = 0.28,
    } = opts;

    const leftW = w * leftColRatio;
    const rightW = w - leftW;
    const lineHeight = fontSize * lineHeightFactor;

    // measure
    const measured = rows.map(({ key, value }) => {
      const keyLines = wrapText(key, font, fontSize, mm(leftW) - 2 * mm(innerPadX));
      const valueLines = wrapText(value, font, fontSize, mm(rightW) - 2 * mm(innerPadX));
      const lineCount = Math.max(keyLines.length, valueLines.length);
      const rowH = lineCount * lineHeight + 2 * cellPadY + 0.10; // mm, approx
      return { keyLines, valueLines, rowH };
    });

    const rawHeights = measured.map(r => Math.max(r.rowH, fontSize + 2 * cellPadY + 0.10));
    const rawTotal = rawHeights.reduce((a, b) => a + b, 0) || 1;
    const rowHeightsMm = rawHeights.map(rh => (rh * h) / rawTotal);

    const tableX = mm(x), tableY = mm(y), tableW = mm(w), tableH = mm(h);
    page.drawRectangle({ x: tableX, y: tableY, width: tableW, height: tableH, borderWidth, borderColor: rgb(0, 0, 0) });
    const splitX = tableX + mm(leftW);
    page.drawLine({ start: { x: splitX, y: tableY }, end: { x: splitX, y: tableY + tableH }, thickness: borderWidth, color: rgb(0, 0, 0) });

    let currentTop = tableY + tableH;
    measured.forEach((row, idx) => {
      const rowHpt = mm(rowHeightsMm[idx]);
      let rowBottom = currentTop - rowHpt;
      if (idx === measured.length - 1) rowBottom = tableY;
      if (idx < measured.length - 1) {
        page.drawLine({ start: { x: tableX, y: rowBottom }, end: { x: tableX + tableW, y: rowBottom }, thickness: borderWidth, color: rgb(0, 0, 0) });
      }
      drawCellLines(page, font, row.keyLines, fontSize, lineHeight, tableX, rowBottom, mm(leftW), rowHpt, mm(innerPadX), mm(cellPadY));
      drawCellLines(page, font, row.valueLines, fontSize, lineHeight, splitX, rowBottom, tableW - mm(leftW), rowHpt, mm(innerPadX), mm(cellPadY));
      currentTop = rowBottom;
    });
  }

  function drawCellLines(page, font, lines, fontSize, lineHeight, x0, y0, w0, h0, padX, padY) {
    let yy = y0 + h0 - padY - fontSize;
    for (const line of lines) {
      if (yy < y0) break;
      page.drawText(line, { x: x0 + padX, y: yy, size: fontSize, font, color: rgb(0, 0, 0) });
      yy -= lineHeight;
    }
  }

  /* ----------------------------------------------------------------
   * KR label — a 40x30mm horizontal 5-row key/value label, rotated 90°
   * as a rigid group into a 30x40mm slot (matches
   * draw_one_label + draw_one_label_rotated_for_roll in KR scripts).
   * rows: [{key, value}], rowRatios: array summing to 1 (5 entries)
   * -------------------------------------------------------------- */
  function rotate90(pivotX, pivotY, lx, ly) {
    // 90 deg CCW group rotation (matches reportlab canvas.rotate(90))
    return { x: pivotX - ly, y: pivotY + lx };
  }

  function drawKRLabelRotated(opts) {
    const {
      page, font, slotX, slotY, slotW, slotH,
      rawLabelW, rawLabelH, rows, rowRatios,
      leftColRatio = 0.35, fontSize = 6, lineHeightFactor = 1.0,
      outerMarginX = 2.0, outerMarginY = 1.8, innerPadX = 0.35, innerPadY = 0.25,
      borderWidth = 0.30, innerBorderWidth = 0.25,
    } = opts;

    // Pivot = translate(slotX + slotW, slotY) then rotate(90), matches Python.
    const pivotX = mm(slotX + slotW);
    const pivotY = mm(slotY);

    const tableW = rawLabelW - 2 * outerMarginX;
    const tableH = rawLabelH - 2 * outerMarginY;
    const tableLX = outerMarginX; // local x of table within the (unrotated) 40x30 label
    const tableLY = outerMarginY;
    const leftW = tableW * leftColRatio;
    const rightW = tableW - leftW;
    const lineHeight = fontSize * lineHeightFactor;

    const P = (lx, ly) => rotate90(pivotX, pivotY, mm(lx), mm(ly));

    drawRotatedRectAsLines(page, P, tableLX, tableLY, tableW, tableH, borderWidth);
    const dv1 = P(tableLX + leftW, tableLY);
    const dv2 = P(tableLX + leftW, tableLY + tableH);
    page.drawLine({ start: dv1, end: dv2, thickness: innerBorderWidth, color: rgb(0, 0, 0) });

    const rowHs = rowRatios.map(r => tableH * r);
    let currentTopLocal = tableLY + tableH;
    rows.forEach(({ key, value }, idx) => {
      const rowH = rowHs[idx];
      const rowBottomLocal = currentTopLocal - rowH;
      if (idx < rows.length - 1) {
        const l1 = P(tableLX, rowBottomLocal);
        const l2 = P(tableLX + tableW, rowBottomLocal);
        page.drawLine({ start: l1, end: l2, thickness: innerBorderWidth, color: rgb(0, 0, 0) });
      }
      drawRotatedWrappedCell(page, font, P, key, fontSize, lineHeight, tableLX, rowBottomLocal, leftW, rowH, innerPadX, innerPadY);
      drawRotatedWrappedCell(page, font, P, value, fontSize, lineHeight, tableLX + leftW, rowBottomLocal, rightW, rowH, innerPadX, innerPadY);
      currentTopLocal = rowBottomLocal;
    });
  }

  function drawRotatedRectAsLines(page, P, lx, ly, w, h, thickness) {
    const p1 = P(lx, ly), p2 = P(lx + w, ly), p3 = P(lx + w, ly + h), p4 = P(lx, ly + h);
    const opt = { thickness, color: rgb(0, 0, 0) };
    page.drawLine({ start: p1, end: p2, ...opt });
    page.drawLine({ start: p2, end: p3, ...opt });
    page.drawLine({ start: p3, end: p4, ...opt });
    page.drawLine({ start: p4, end: p1, ...opt });
  }

  function drawRotatedWrappedCell(page, font, P, text, fontSize, lineHeight, lx, ly, w, h, padX, padY) {
    const maxWidthPt = mm(w) - 2 * mm(padX);
    const lines = wrapText(text, font, fontSize, maxWidthPt);
    const maxLines = Math.max(1, Math.floor((mm(h) - 2 * mm(padY)) / lineHeight));
    const shown = lines.slice(0, maxLines);
    const totalTextH = shown.length * lineHeight;
    // vertical-centered like draw_wrapped_text in KR python (all in mm here)
    let yLocalMm = ly + h / 2 + (totalTextH / (72 / 25.4)) / 2 - fontSize / (72 / 25.4);
    for (const line of shown) {
      const pt = P(lx + padX, yLocalMm);
      page.drawText(line, { x: pt.x, y: pt.y, size: fontSize, font, color: rgb(0, 0, 0), rotate: degrees(90) });
      yLocalMm -= lineHeight / (72 / 25.4);
    }
  }

  /* ----------------------------------------------------------------
   * SG label — vertical 30x40mm label. Grid drawn UNROTATED, but each
   * header/value cell's TEXT is individually rotated 90° in place
   * (matches draw_rotated_value in SG script).
   * -------------------------------------------------------------- */
  function drawSGLabel(opts) {
    const {
      page, font, slotX, slotY, slotW, slotH,
      headers, values, colRatios, headerH,
      outerMarginX = 1.35, outerMarginY = 1.35,
      fontSize = 6, innerPadX = 0.30, innerPadY = 0.30, borderWidth = 0.25,
    } = opts;

    const tableX = slotX + outerMarginX;
    const tableY = slotY + outerMarginY;
    const tableW = slotW - 2 * outerMarginX;
    const tableH = slotH - 2 * outerMarginY;
    const valueH = tableH - headerH;

    page.drawRectangle({ x: mm(tableX), y: mm(tableY), width: mm(tableW), height: mm(tableH), borderWidth, borderColor: rgb(0, 0, 0) });
    const headerTopY = tableY + headerH;
    page.drawLine({ start: { x: mm(tableX), y: mm(headerTopY) }, end: { x: mm(tableX + tableW), y: mm(headerTopY) }, thickness: borderWidth, color: rgb(0, 0, 0) });

    const colWs = colRatios.map(r => tableW * r);
    const colXs = [tableX];
    for (const cw of colWs) colXs.push(colXs[colXs.length - 1] + cw);
    for (let i = 1; i < colXs.length - 1; i++) {
      page.drawLine({ start: { x: mm(colXs[i]), y: mm(tableY) }, end: { x: mm(colXs[i]), y: mm(tableY + tableH) }, thickness: borderWidth, color: rgb(0, 0, 0) });
    }

    for (let i = 0; i < headers.length; i++) {
      drawRotatedCellInPlace(page, font, headers[i], fontSize, colXs[i], tableY, colWs[i], headerH, innerPadX, innerPadY);
      drawRotatedCellInPlace(page, font, values[i], fontSize, colXs[i], headerTopY, colWs[i], valueH, innerPadX, innerPadY);
    }
  }

  // Rotates text 90 deg CCW in place around each cell's own center, matching
  // draw_rotated_value() in the SG script.
  function drawRotatedCellInPlace(page, font, text, fontSize, x, y, w, h, padX, padY) {
    const textAreaW = h - 2 * padY; // after rotation, available width = original height
    const textAreaH = w - 2 * padX;
    const lineHeight = fontSize / (72 / 25.4);
    const lines = wrapText(text, font, fontSize, mm(textAreaW));
    const maxLines = Math.max(1, Math.floor(textAreaH / lineHeight));
    const shown = lines.slice(0, maxLines);

    const cx = mm(x + w / 2), cy = mm(y + h / 2);
    const startXLocal = -mm(textAreaW) / 2;
    let startYLocal = mm(textAreaH) / 2 - fontSize;

    for (const line of shown) {
      // Local point (startXLocal, startYLocal) rotated 90 CCW around (cx,cy).
      const wx = cx - startYLocal;
      const wy = cy + startXLocal;
      page.drawText(line, { x: wx, y: wy, size: fontSize, font, color: rgb(0, 0, 0), rotate: degrees(90) });
      startYLocal -= mm(lineHeight);
    }
  }

  return {
    createDoc, wrapText, drawBorderedKVTable, drawKRLabelRotated, drawSGLabel,
    rotate90, mm, resetFontCache, currentFontLabel,
  };
})();
