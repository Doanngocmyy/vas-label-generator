/* ==========================================================
 * utils.js — shared helpers ported from the Python VAS scripts
 * (normalize EAN/SKU, header alias matching, xlsx reading, etc.)
 * ========================================================== */
const VASUtils = (() => {

  const NA_TOKENS = new Set(["#N/A", "#NA", "N/A", "NA", "#VALUE!", "#REF!", "NONE", "NULL", "NAN"]);

  function cleanText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number" && Number.isNaN(v)) return "";
    let s = String(v).trim();
    if (s.toLowerCase() === "nan" || s.toLowerCase() === "none" || s.toLowerCase() === "nat") return "";
    s = s.replace(/_x000D_/g, " ").replace(/\r/g, " ").replace(/\n/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function isNaValue(v) {
    const s = cleanText(v);
    return s === "" || NA_TOKENS.has(s.toUpperCase());
  }

  // Exact header normalizer (matches Python's normalize_header_name):
  // collapse whitespace, trim, uppercase. Used for CN Retail / CN Tmall
  // where master columns are matched by EXACT header text, not aliases.
  function normalizeHeaderExact(v) {
    return cleanText(v).toUpperCase();
  }

  function buildColMapExact(headerRow) {
    const map = {};
    (headerRow || []).forEach((h, i) => {
      const norm = normalizeHeaderExact(h);
      if (norm && !(norm in map)) map[norm] = i;
    });
    return map;
  }

  function getByHeader(row, colMapExact, headerName) {
    const idx = colMapExact[normalizeHeaderExact(headerName)];
    if (idx === undefined) return "";
    const v = row[idx];
    return v === undefined ? "" : v;
  }

  function normalizeHeader(s) {
    s = cleanText(s).toLowerCase();
    s = s.replace(/[\s_\-]+/g, " ");
    return s.trim();
  }

  // Strict alnum-only header normalizer (used by SG-style matching)
  function normalizeHeaderStrict(s) {
    s = cleanText(s).toLowerCase().replace(/ /g, " ");
    s = s.replace(/[^a-z0-9一-鿿]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function stripDecimalZero(s) {
    s = s.trim();
    if (/^\d+\.0+$/.test(s)) return s.split(".")[0];
    return s;
  }

  function normalizeEAN(v) {
    if (v === null || v === undefined) return "";
    let s = cleanText(v);
    if (!s || NA_TOKENS.has(s.toUpperCase())) return "";
    s = s.replace(/,/g, "").replace(/\s+/g, "");
    s = stripDecimalZero(s);
    if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) {
      try {
        s = Number(s).toFixed(0);
      } catch (e) { /* ignore */ }
    }
    if (/^\d+\.\d+$/.test(s)) {
      s = String(Math.round(Number(s)));
    }
    return s.replace(/\D/g, "");
  }

  function normalizeSKU(v) {
    const s = cleanText(v);
    if (!s) return "";
    return s.replace(/\s+/g, " ").trim().toUpperCase();
  }

  // ---- Origin helpers -------------------------------------------------

  // CN retail / CN Tmall: label text in Simplified Chinese
  function formatOriginCN(v) {
    const s = cleanText(v);
    if (!s) return "";
    const x = s.replace(/[.\s\-_]+/g, " ").trim().toUpperCase();
    if (x === "VN" || x === "VIETNAM" || x === "VIET NAM" || x.includes("VIET")) return "越南";
    if (x === "CN" || x === "CHINA" || x === "PRC" || x === "P R C" || s === "中国" || x.includes("CHINA")) return "中国";
    return s;
  }
  function originBucketCN(originLabelText) {
    if (originLabelText === "中国") return "CN";
    if (originLabelText === "越南") return "VN";
    return "OTHER";
  }

  // KR: English label text
  function formatCOEnglish(v) {
    const s = cleanText(v);
    if (!s) return "to be confirm";
    const upper = s.toUpperCase().replace(/\./g, "").trim();
    if (["VN", "VIET NAM", "VIETNAM"].includes(upper)) return "Vietnam";
    if (["CN", "CHINA", "PRC"].includes(upper)) return "China";
    return s;
  }

  // SG: CN / VN / other short codes
  function coFileCode(co) {
    const s = normalizeHeaderStrict(co);
    if (["china", "cn", "prc", "made in china"].includes(s)) return "CN";
    if (["vietnam", "viet nam", "vn", "made in vietnam", "made in viet nam"].includes(s)) return "VN";
    const out = cleanText(co).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
    return out || "UNKNOWN_CO";
  }
  function canonicalCO(co) {
    const s = normalizeHeaderStrict(co);
    if (["china", "cn", "prc", "made in china"].includes(s)) return "CN";
    if (["vietnam", "viet nam", "vn", "made in vietnam", "made in viet nam"].includes(s)) return "VN";
    return cleanText(co);
  }

  // CN Tmall: classify origin group from a raw master field (中国/越南 or English)
  function classifyOriginGroupCN(raw) {
    raw = cleanText(raw);
    const normalized = raw.replace(/[\s._/\-]+/g, "").toUpperCase();
    const cnTokens = new Set(["CN", "CHINA", "PRC", "PEOPLESREPUBLICOFCHINA", "中国", "中國", "中国制造", "MADEINCHINA"]);
    const vnTokens = new Set(["VN", "VIETNAM", "越南", "越南制造", "MADEINVIETNAM"]);
    if (cnTokens.has(normalized) || raw.includes("中国") || raw.includes("中國")) return { group: "CN", raw };
    if (vnTokens.has(normalized) || raw.includes("越南")) return { group: "VN", raw };
    const upperRaw = raw.toUpperCase();
    if (upperRaw.includes("CHINA") || upperRaw.includes("P.R.C")) return { group: "CN", raw };
    if (normalized.includes("VIETNAM") || upperRaw.includes("VIET NAM")) return { group: "VN", raw };
    return { group: null, raw };
  }

  // ---- Price helpers ----------------------------------------------------

  function preserveExactPriceText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") {
      if (Number.isNaN(v)) return "";
      return Number.isInteger(v) ? String(v) : String(v);
    }
    let s = String(v).trim().replace(/\r|\n/g, " ").replace(/\s+/g, " ");
    if (s.endsWith(".0")) s = s.slice(0, -2);
    return s;
  }

  function formatCNYPrice(v, mode) {
    const CNY = "￥"; // ￥
    let s = cleanText(v);
    if (!s) return "";
    s = s.replace(/¥/g, CNY).trim();
    const sUpper = s.toUpperCase();
    let numPart;
    if (s.startsWith(CNY)) numPart = s.slice(CNY.length).trim();
    else if (sUpper.startsWith("CNY")) numPart = s.slice(3).trim();
    else numPart = s;
    const prefix = mode === "text" ? "CNY " : CNY;
    const raw = numPart.replace(/,/g, "");
    if (/^[+-]?\d+(\.\d+)?$/.test(raw)) {
      let normalized = String(parseFloat(raw));
      return `${prefix}${normalized}`;
    }
    return numPart ? `${prefix}${numPart}` : "";
  }

  function formatRRP(price, currencySymbol) {
    const priceText = preserveExactPriceText(price);
    if (!priceText) return "";
    if (priceText.includes(currencySymbol)) return priceText;
    return `${currencySymbol} ${priceText}`;
  }

  // ---- header / column alias detection ----------------------------------

  function findColByAlias(headerRow, aliases) {
    const normAliases = aliases.map(normalizeHeader);
    for (let i = 0; i < headerRow.length; i++) {
      const norm = normalizeHeader(headerRow[i]);
      if (norm && normAliases.includes(norm)) return i;
    }
    for (let i = 0; i < headerRow.length; i++) {
      const norm = normalizeHeader(headerRow[i]);
      if (!norm) continue;
      for (const a of normAliases) {
        if (norm.includes(a)) return i;
      }
    }
    return -1;
  }

  function uniqueKeepOrder(items) {
    const seen = new Set();
    const out = [];
    for (const x of items) {
      if (x && !seen.has(x)) { seen.add(x); out.push(x); }
    }
    return out;
  }

  // ---- XLSX helpers (SheetJS) --------------------------------------------

  async function readWorkbookFromFile(file) {
    const buf = await file.arrayBuffer();
    return XLSX.read(buf, { type: "array", cellDates: false });
  }

  // Returns array-of-arrays for a given sheet (raw, no header assumption).
  function sheetToRows(workbook, sheetName) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  }

  // Scan the first `maxScan` rows of `rows` (array-of-arrays) looking for the
  // row that best matches the given field alias map. Returns
  // { headerRowIndex, colMap: { fieldName: colIndex } , score }
  function detectHeaderRow(rows, fieldAliases, requiredFields, maxScan = 30) {
    let best = { headerRowIndex: -1, colMap: {}, score: -1 };
    const scanLimit = Math.min(rows.length, maxScan);
    for (let r = 0; r < scanLimit; r++) {
      const row = rows[r] || [];
      const colMap = {};
      for (let c = 0; c < row.length; c++) {
        const norm = normalizeHeader(row[c]);
        if (!norm) continue;
        for (const [field, aliases] of Object.entries(fieldAliases)) {
          if (field in colMap) continue;
          for (const alias of aliases) {
            if (normalizeHeader(alias) === norm) { colMap[field] = c; break; }
          }
        }
      }
      // second pass: substring match for fields not yet found
      for (let c = 0; c < row.length; c++) {
        const norm = normalizeHeader(row[c]);
        if (!norm) continue;
        for (const [field, aliases] of Object.entries(fieldAliases)) {
          if (field in colMap) continue;
          for (const alias of aliases) {
            if (norm.includes(normalizeHeader(alias))) { colMap[field] = c; break; }
          }
        }
      }
      const score = Object.keys(colMap).length + requiredFields.filter(f => f in colMap).length * 10;
      if (score > best.score) best = { headerRowIndex: r, colMap, score };
    }
    return best;
  }

  // ---- text wrap / measure for PDF (uses a pdf-lib font's widthOfTextAtSize) --

  function wrapByWidth(text, font, fontSize, maxWidth, cjkCharByChar = false) {
    text = cleanText(text);
    if (!text) return [""];
    const widthOf = (s) => font.widthOfTextAtSize(s, fontSize);

    let tokens;
    if (cjkCharByChar) {
      tokens = Array.from(text);
    } else {
      tokens = text.split(/(\s+)/).filter(t => t !== "");
    }

    const lines = [];
    let current = "";
    for (const token of tokens) {
      const trial = current + (cjkCharByChar ? "" : (current && !current.endsWith(" ") && !token.startsWith(" ") ? "" : "")) + token;
      const candidate = cjkCharByChar ? (current + token) : (current ? current + token : token);
      if (widthOf(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current.trim()) {
        lines.push(current.trim());
        current = token.trim();
        if (widthOf(current) <= maxWidth) continue;
      }
      // token itself too long -> char by char
      let buf = "";
      for (const ch of Array.from(current || token)) {
        const t2 = buf + ch;
        if (widthOf(t2) <= maxWidth) buf = t2;
        else { if (buf) lines.push(buf); buf = ch; }
      }
      current = buf;
    }
    if (current.trim()) lines.push(current.trim());
    return lines.length ? lines : [""];
  }

  // ---- Market -> locked font-group mapping ------------------------------
  // CN Retail + CN Tmall always render with the locked "SimHei Bold" font;
  // KR + SG always render with the locked "Calibri" font (faux slight-bold
  // applied). No market ever falls back to a default bundled font anymore —
  // see panel 3 in index.html / storage.js / pdfkit-labels.js.
  const FONT_GROUPS = {
    cn: {
      id: "cn",
      groupLabel: "CN Retail / CN Tmall",
      fontName: "SimHei Bold",
      boldOffsetPt: 0.30, // full faux-bold stroke thickening
    },
    intl: {
      id: "intl",
      groupLabel: "SG / KR",
      fontName: "Calibri",
      boldOffsetPt: 0.14, // slight faux-bold, per yêu cầu "prefer slight bold"
    },
  };
  function fontGroupForMarket(marketId) {
    return (marketId === "cnRetail" || marketId === "cnTmall") ? "cn" : "intl";
  }

  function containsCJK(text) {
    return /[一-鿿]/.test(cleanText(text));
  }

  // mm <-> pt conversion (pdf-lib works in points)
  const MM_TO_PT = 72 / 25.4;
  function mm(v) { return v * MM_TO_PT; }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return {
    NA_TOKENS, cleanText, isNaValue, normalizeHeader, normalizeHeaderStrict,
    normalizeHeaderExact, buildColMapExact, getByHeader,
    normalizeEAN, normalizeSKU, formatOriginCN, originBucketCN, formatCOEnglish,
    coFileCode, canonicalCO, classifyOriginGroupCN, preserveExactPriceText,
    formatCNYPrice, formatRRP, findColByAlias, uniqueKeepOrder,
    readWorkbookFromFile, sheetToRows, detectHeaderRow,
    wrapByWidth, containsCJK, mm, downloadBlob,
    FONT_GROUPS, fontGroupForMarket,
  };
})();
