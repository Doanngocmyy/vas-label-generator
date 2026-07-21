# VAS Label Generator — CN / CN Tmall / KR / SG

Web app tạo tem COO (Country of Origin) cho 4 luồng: **CN Retail**, **CN Tmall**, **KR** (2 chế độ), **SG**. Chạy 100% trong trình duyệt (SheetJS đọc Excel, pdf-lib tạo PDF) — Master Label Data và EAN list **không được gửi lên bất kỳ server nào**, kể cả khi site được publish public trên GitHub Pages.

## Cấu trúc thư mục

```
vas-label-site/
├── index.html              # giao diện chính
├── css/style.css
├── js/
│   ├── utils.js             # các hàm chuẩn hoá EAN/SKU/origin/giá (port từ Python)
│   ├── storage.js           # lưu master đã khoá (localStorage) + font riêng (IndexedDB)
│   ├── pdfkit-labels.js     # vẽ PDF (pdf-lib) — bảng key/value, tem xoay 90°
│   ├── app.js                # UI: upload, popup chọn sheet, tuỳ chọn, generate
│   └── markets/
│       ├── cnRetail.js       # port CN_COO_SimHei_FULL.py
│       ├── cnTmall.js        # port CN_Tmall_FINAL.ipynb (BAGS/ADAPTERS/STRAPS)
│       ├── kr.js              # port KR_COO_5PT_V2 + KR_Latest (2 chế độ)
│       └── sg.js              # port SG_COO_UP_6PT.ipynb
├── fonts/
│   └── default-cjk.ttf       # font mặc định (xem mục Font bên dưới)
└── reference/                 # code Python gốc, giữ để đối chiếu (không cần cho site chạy)
```

## Cách hoạt động

1. **Master Label Data**: upload file Excel, chọn đúng sheet ở popup hiện ra (vì file thường có nhiều sheet). Sau khi chọn, master được "khoá" — lưu trong trình duyệt (localStorage), lần sau không cần upload lại, chỉ cần chọn "Không đổi — dùng bản đã khoá".
2. **EAN / Filter List**: upload mỗi lần tạo tem (không lưu lại, vì đây là danh sách request thay đổi liên tục).
3. **Font**: khoá cứng theo NHÓM thị trường, không còn font mặc định — **CN Retail / CN Tmall** luôn dùng font **SimHei Bold** đã khoá, **SG / KR** luôn dùng font **Calibri** đã khoá (áp faux-bold nhẹ tự động, vì Calibri thường không có sẵn weight Bold thật trong file .ttf). Mỗi nhóm có 1 ô upload `.ttf`/`.ttc`/`.otf` riêng ở panel Font, lưu lại trong trình duyệt (IndexedDB). **Generate labels bị khoá (disabled) cho market nào mà nhóm font của nó chưa được upload & khoá** — không thể lỡ tay tạo tem bằng font sai/font mặc định nữa.
4. **Cỡ chữ**: chỉnh được theo từng loại tem (mặc định 6pt, giống bản gốc).
5. Nhấn **Generate labels** → tải các file PDF (chia CN/VN/OTHER hoặc CN/VN tuỳ luồng) + 1 file CSV tổng hợp.

## Về font

Font bị **khoá cứng theo nhóm thị trường** (`js/utils.js` → `VASUtils.FONT_GROUPS`), không có font mặc định bundle sẵn nữa:

- **CN Retail + CN Tmall** ("cn" group) → phải upload & khoá font **SimHei Bold**.
- **SG + KR** ("intl" group) → phải upload & khoá font **Calibri**. Nếu file Calibri bạn có chỉ là weight Regular (không có Bold thật), app tự vẽ đè chữ lệch nhẹ (faux-bold ~0.14pt) để chữ trông hơi đậm hơn, theo yêu cầu "ưu tiên hơi đậm". CN group cũng dùng kỹ thuật này nhưng với offset lớn hơn (~0.30pt) để đảm bảo luôn đậm dù file SimHei bạn upload có đúng là weight Bold hay không.

Mỗi nhóm được khoá độc lập trong IndexedDB (key `customFont.cn` / `customFont.intl`). Cho tới khi upload, panel Font hiển thị trạng thái lỗi màu đỏ và nút **Generate labels** bị disable cho các market thuộc nhóm đó — không có đường lùi về font mặc định.

**Quan trọng — đã tắt tính năng "subset" của pdf-lib**: pdf-lib (qua fontkit) có lỗi làm hỏng/rớt chữ khi bật `subset:true` với font tiếng Trung lớn (đã kiểm chứng bằng cách render thử nhiều lần). Vì vậy code nhúng nguyên font vào mỗi PDF — file PDF xuất ra sẽ nặng thêm khoảng 3-4MB. Đây là đánh đổi cần thiết để chữ hiển thị đúng 100%. Nếu sau này muốn tối ưu, cần một thư viện PDF khác có subset CJK ổn định hơn.

SimHei và Calibri đều là font Windows/Microsoft — không được phép tự phân phối lại trong repo public. Upload trực tiếp trong app (panel Font, 2 ô riêng cho CN và SG/KR) — không cần sửa code hay đụng vào repo. File `fonts/default-cjk.ttf` (Noto Sans SC) vẫn còn trong repo nhưng không còn được code dùng tới — giữ lại chỉ để tham khảo, có thể xoá an toàn nếu muốn dọn repo.

**Nâng cấp từ bản cũ (1 font dùng chung)**: nếu trình duyệt của bạn đã từng khoá 1 font chung theo cơ chế cũ, lần load đầu tiên sau khi cập nhật app sẽ tự copy font đó sang ô "CN" (gần với mục đích SimHei/SimSun ban đầu nhất). Ô "SG/KR — Calibri" vẫn cần upload mới vì font cũ gần như chắc chắn không phải Calibri.

## Publish lên GitHub Pages

Repo này là site tĩnh thuần HTML/CSS/JS — không cần build, không cần server.

1. Tạo repo mới trên GitHub (Public hoặc Private tuỳ nhu cầu — xem lưu ý bảo mật bên dưới).
2. Trong thư mục này:
   ```bash
   git init
   git add .
   git commit -m "VAS label generator"
   git branch -M main
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```
3. Vào repo trên GitHub → **Settings → Pages** → Source chọn nhánh `main`, thư mục `/ (root)` → Save.
4. Đợi 1-2 phút, site sẽ có tại `https://<user>.github.io/<repo>/`.

## Lưu ý bảo mật

Vì mọi thứ chạy client-side (không có backend), **master data và EAN list bạn upload không rời khỏi máy/trình duyệt của bạn** — kể cả khi site public. Điều này tự động giải quyết rủi ro lộ dữ liệu (giá bán lẻ, địa chỉ nhà nhập khẩu...) mà việc "khoá cứng data vào repo public" từng có.

Nếu sau này có nhu cầu chia sẻ 1 bộ master data CHUNG cho cả nhóm (không phải mỗi người tự upload), cần cân nhắc thêm — ví dụ dùng repo Private, hoặc một backend có xác thực — lúc đó nói mình biết để điều chỉnh kiến trúc.

## Giới hạn hiện tại / việc còn lại

- File Excel tổng hợp nhiều-sheet (Summary/Skip Log/Unmatched...) như bản Python gốc được **rút gọn thành 1 file CSV tóm tắt** đi kèm mỗi lần tạo tem, để tập trung vào phần quan trọng nhất là các PDF tem. Nếu cần bản Excel đầy đủ nhiều sheet như gốc, có thể bổ sung sau.
- Đã test kỹ bằng dữ liệu mẫu tự tạo (script test Node.js trong quá trình xây dựng) và render thử ở độ phân giải cao để soát chữ — nhưng **chưa test với file Master/EAN thật của bạn**. Lần đầu dùng, nên thử với 1 file nhỏ trước khi chạy cả lô lớn.
- 5 file gốc bạn upload (CN retail, CN Tmall, KR x2, SG) đều đã được port. Riêng CN Tmall: nếu template phân loại BAGS/ADAPTERS/STRAPS dựa vào cột "Cat" có giá trị khác với 3 từ khoá gốc ("bags", "1 piece/bag", "adapters"), tem sẽ mặc định về template STRAPS — giống hệt logic Python gốc.
