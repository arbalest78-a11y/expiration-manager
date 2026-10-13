from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageOps, ImageEnhance
import pytesseract
import re
import calendar
import os
import time


def parse_expiry_date(text):
    """OCR文字列から日付（YYYY-MM-DD）を抽出する。既存の判定を維持。"""
    text = text.strip().replace(" ", "")

    patterns = [
        # 2026.09.20
        (
            r"(20\d{2})[./-](\d{1,2})[./-](\d{1,2})",
            False,
        ),
        # 26.09.20
        # 前後にOCRの余計な数字があっても、
        # 途中の「26.09.20」を拾えるようにする
        (
            r"(\d{2})[./-](\d{1,2})[./-](\d{1,2})",
            True,
        ),
        # 2609.20
        (
            r"(\d{2})(\d{2})[./-](\d{1,2})",
            True,
        ),
    ]

    for pattern, short_year in patterns:
        match = re.search(pattern, text)

        if not match:
            continue

        year = int(match.group(1))

        if short_year:
            year += 2000

        month = int(match.group(2))
        day = int(match.group(3))

        if not 1 <= month <= 12:
            continue

        max_day = calendar.monthrange(year, month)[1]

        if not 1 <= day <= max_day:
            continue

        return f"{year:04d}-{month:02d}-{day:02d}"

    return None


def parse_expiry_month(text):
    """年月表記から YYYY-MM を抽出する。日付がある表記は対象外。

    例: 2027.05/BB, 2027.05, 2027.5, 26.12
    末尾の区切り記号は、OCRがBBを落とす場合への暫定対応。
    欠けた年月日を誤って年月扱いする可能性があるため、必ず確認を要する。
    """
    text = text.strip().replace(" ", "").upper()

    match = re.search(
        r"(?<!\d)(20\d{2}|\d{2})[./-](0?[1-9]|1[0-2])(?:[./-]?BB|[./-])?$",
        text,
    )
    if not match:
        return None

    year = int(match.group(1))
    if year < 100:
        year += 2000
    month = int(match.group(2))
    return f"{year:04d}-{month:02d}"


app = Flask(__name__)
CORS(app)

# Windows ではローカルの Tesseract を使用。Render では PATH の tesseract を利用。
if os.name == "nt":
    pytesseract.pytesseract.tesseract_cmd = (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    )


@app.route("/ocr", methods=["POST"])
def ocr():
    if "image" not in request.files:
        return jsonify({"error": "画像がありません"}), 400

    image_file = request.files["image"]
    start_time = time.perf_counter()
    print("受信した画像:", image_file.filename)

    try:
        image = Image.open(image_file.stream)
        width, height = image.size

        # ガイド内で既に切り抜かれた画像を受け取り、3倍に拡大する
        image = image.resize((width * 3, height * 3))
        image = ImageOps.grayscale(image)
        image = ImageOps.autocontrast(image)
        image = ImageEnhance.Contrast(image).enhance(2.0)
        image = ImageEnhance.Sharpness(image).enhance(2.0)
        image = ImageOps.expand(image, border=20, fill=255)

        width, height = image.size
        image_variants = [
            (
                "trim-medium",
                image.crop(
                    (
                        int(width * 0.08),
                        int(height * 0.18),
                        int(width * 0.92),
                        int(height * 0.82),
                    )
                ),
            ),
        ]
        psm_modes = [7, 8, 10, 13]
        date_counts = {}
        month_counts = {}
        ocr_results = []

        for variant_name, variant_image in image_variants:
            variant_image = ImageOps.expand(variant_image, border=20, fill=255)

            for psm in psm_modes:
                ocr_start = time.perf_counter()
                recognized_text = pytesseract.image_to_string(
                    variant_image,
                    lang="eng",
                    config=(
                        f"--psm {psm} "
                        "-c tessedit_char_whitelist=0123456789./-B"
                    ),
                ).strip()
                ocr_elapsed = time.perf_counter() - ocr_start

                print(
                    f"OCR処理時間 [{variant_name} / psm {psm}]: "
                    f"{ocr_elapsed:.2f}秒",
                    flush=True,
                )
                print(f"OCR [{variant_name} / psm {psm}]:", repr(recognized_text))

                if recognized_text:
                    ocr_results.append(recognized_text)

                # 必ず年月日を先に解析。年月日が見つかった場合は年月候補に数えない
                expiry_candidate = parse_expiry_date(recognized_text)
                if expiry_candidate:
                    date_counts[expiry_candidate] = (
                        date_counts.get(expiry_candidate, 0) + 1
                    )
                    continue

                month_candidate = parse_expiry_month(recognized_text)
                if month_candidate:
                    month_counts[month_candidate] = (
                        month_counts.get(month_candidate, 0) + 1
                    )

        expiry = None
        expiry_month = None
        expiry_precision = None
        needs_confirmation = False

        if date_counts:
            expiry = max(date_counts, key=date_counts.get)
            expiry_precision = "day"
        elif month_counts:
            expiry_month = max(month_counts, key=month_counts.get)
            expiry_precision = "month"
            needs_confirmation = True

        print("日付候補:", date_counts)
        print("年月候補:", month_counts)
        print("採用した賞味期限:", expiry)
        print("年月のみの候補:", expiry_month)
        print(
            f"OCR全体の処理時間: {time.perf_counter() - start_time:.2f}秒",
            flush=True,
        )

        # expiry は従来通り YYYY-MM-DD または null のみ。
        # 日のない日付を勝手に1日/末日として登録しない。
        return jsonify(
            {
                "name": "",
                "expiry": expiry,
                "expiry_month": expiry_month,
                "expiry_precision": expiry_precision,
                "needs_confirmation": needs_confirmation,
                "text": ocr_results[-1] if ocr_results else "",
                "ocr_texts": ocr_results,
            }
        )

    except Exception as error:
        print("OCRエラー:", error)
        return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
