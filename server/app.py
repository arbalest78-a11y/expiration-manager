from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageOps, ImageEnhance
import pytesseract
import re
import calendar
import os
import time
from datetime import date


def normalize_ocr_text(text):
    """OCRで誤読しやすい数字と区切り記号の表記を統一。"""
    replacements = str.maketrans("０１２３４５６７８９．，／－", "0123456789.,/-")
    text = text.translate(replacements).replace("。", ".")
    # 印字されたピリオドがカンマとして認識されることがある
    return re.sub(r"(?<=\d),(?=\d)", ".", text)


# 賞味期限のOCR候補として採用する期間。必要に応じて変更可能。
MAX_FUTURE_YEARS = 10


def is_plausible_expiry(value, month_only=False):
    """OCRで認識した期限が当日～10年後の範囲内か確認する。

    期限切れの食品を登録したい場合は、フォームから手動入力できる。
    """
    try:
        if month_only:
            year, month = map(int, value.split("-"))
            candidate = date(year, month, calendar.monthrange(year, month)[1])
        else:
            candidate = date.fromisoformat(value)
    except (ValueError, TypeError):
        return False

    today = date.today()
    latest_year = today.year + MAX_FUTURE_YEARS
    latest_day = min(today.day, calendar.monthrange(latest_year, today.month)[1])
    latest = date(latest_year, today.month, latest_day)
    return today <= candidate <= latest


def parse_expiry_date(text):
    """OCR文字列から完全な日付（YYYY-MM-DD）を抽出。"""
    # 前後の別の数字を日付と連結しないよう、空白・改行は残す。
    text = normalize_ocr_text(text).strip()
    patterns = [
        (r"(?<!\d)(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?![A-Za-z0-9])", False),
        (r"(?<!\d)(20\d{2})年(\d{1,2})月(\d{1,2})日?(?![A-Za-z0-9])", False),
        (r"(?<!\d)(\d{2})[./-](\d{1,2})[./-](\d{1,2})(?![A-Za-z0-9])", True),
        (r"(?<!\d)(\d{2})(\d{2})[./-](\d{1,2})(?![A-Za-z0-9])", True),
    ]
    for pattern, short_year in patterns:
        for match in re.finditer(pattern, text):
            year = int(match.group(1)) + (2000 if short_year else 0)
            month = int(match.group(2))
            day = int(match.group(3))
            if not (1 <= month <= 12):
                continue
            if not (1 <= day <= calendar.monthrange(year, month)[1]):
                continue
            return f"{year:04d}-{month:02d}-{day:02d}"
    return None


def parse_expiry_month(text):
    """年月の候補を抽出。日付を認識できない場合も、必ず入力前に人が確認する。"""
    text = re.sub(r"\s+", "", normalize_ocr_text(text)).upper()
    text = re.sub(r"^[|｜]+", "", text)

    # 「2027.03.99」など年月日らしい文字列を年月だけに格下げしない。
    # 日の部分が不正でも、月末日として誤入力させないため。
    if re.search(r"(?<!\d)(?:20\d{2}|\d{2})[./-](?:0?[1-9]|1[0-2])[./-](?=.)", text):
        return None
    if re.search(r"(?<!\d)20\d{2}年(?:0?[1-9]|1[0-2])月(?=\d)", text):
        return None

    # 例: FE2027E4N（「年」「月」が英字に誤認識）
    ocr_month = re.fullmatch(r"(?:FE)?(20\d{2})E(0?[1-9]|1[0-2])N", text)
    if ocr_month:
        return f"{int(ocr_month.group(1)):04d}-{int(ocr_month.group(2)):02d}"

    # 例: 2026.09.／2026,09／余計な印字2026.09.20
    # 文字列全体ではなく、境界がある年月部分を抽出する
    normal = re.search(
        r"(?<!\d)(20\d{2}|\d{2})[./年-](0?[1-9]|1[0-2])(?!\d)",
        text,
    )
    if normal:
        year_str, month_str = normal.groups()
    else:
        # 年/月の漢字が数字になってしまった過去のケース（誤検出防止のため全体一致）
        ocr_text = text[1:] if text.startswith("B") else text
        patterns = [
            r"(20\d{2})(0[1-9]|1[0-2])[019]?",
            r"(20\d{2})8(0[1-9]|1[0-2])1?",
            r"(20\d{2})8([1-9])5",
        ]
        match = next(
            (m for pattern in patterns if (m := re.fullmatch(pattern, ocr_text))),
            None,
        )
        if not match:
            return None
        year_str, month_str = match.groups()

    year = int(year_str)
    if year < 100:
        year += 2000
    return f"{year:04d}-{int(month_str):02d}"


def parse_expiry_month_fuzzy(text):
    """年月専用の広い切り抜きから「年→8」の誤認識を候補として抽出する。

    例: 202681 1 A+ -> 2026-11
    曖昧な1桁月は誤判定しやすいため、この補正では扱わない。
    この候補を返しても、ブラウザでユーザーの確認が必要。
    """
    normalized = re.sub(r"\s+", "", normalize_ocr_text(text)).upper()
    match = re.search(r"(?<!\d)(20\d{2})8(0[1-9]|1[0-2])(?=\D|$)", normalized)
    if not match:
        return None
    return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}"


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
        image = Image.open(image_file.stream).convert("RGB")
        original_width, original_height = image.size

        # 画像全体は従来通りの前処理を行う
        enlarged = image.resize(
            (original_width * 3, original_height * 3), Image.Resampling.LANCZOS
        )
        gray = ImageOps.autocontrast(ImageOps.grayscale(enlarged))
        soft = ImageEnhance.Contrast(gray).enhance(1.3)
        soft = ImageEnhance.Sharpness(soft).enhance(1.2)

        width, height = soft.size
        center = soft.crop(
            (
                int(width * 0.08),
                int(height * 0.18),
                int(width * 0.92),
                int(height * 0.82),
            )
        )

        # ドット印字は拡大・強調で逆に読みにくくなる場合があるため、
        # 元画像の左寄り中央帯（年月部分）も別途OCRにかける。
        # ※年月は確定日付ではないので、フロント側での確認が必須。
        original_gray = ImageOps.grayscale(image)
        # 年月部分を広めに切り抜く
        year_month_area = original_gray.crop(
            (
                int(original_width * 0.10),
                int(original_height * 0.25),
                int(original_width * 0.95),
                int(original_height * 0.75),
            )
        )

        # 年月の印字全体を確認するための広い切り抜き
        year_month_wide = original_gray.crop(
            (
                int(original_width * 0.05),
                int(original_height * 0.05),
                int(original_width * 0.95),
                int(original_height * 0.90),
            )
        )

        # 日付用の画像処理を追加（比較用）
        date_image = ImageOps.grayscale(image)
        date_image = date_image.resize(
            (original_width * 3, original_height * 3),
            Image.Resampling.LANCZOS,
        )
        date_image = ImageOps.autocontrast(date_image)
        date_image = ImageEnhance.Contrast(date_image).enhance(1.5)

        # OCR実行パターン（6回から4回に変更）
        image_variants = [
            (
                "date-enhanced",
                date_image,
                (7,),
                "eng",
                " -c tessedit_char_whitelist=0123456789./-",
            ),
            ("trim-medium", center, (8,), "jpn+eng", ""),
            (
                "yearmonth-left",
                year_month_area,
                (8,),
                "eng",
                " -c tessedit_char_whitelist=0123456789.,/-",
            ),
            ("yearmonth-wide", year_month_wide, (8,), "jpn+eng", ""),
        ]

        date_counts = {}
        month_counts = {}
        ocr_results = []

        for variant_name, variant_image, psm_modes, language, options in image_variants:
            border = 8 if variant_name in ("yearmonth-left", "yearmonth-wide") else 20
            variant_image = ImageOps.expand(variant_image, border=border, fill=255)

            for psm in psm_modes:
                ocr_start = time.perf_counter()
                recognized_text = pytesseract.image_to_string(
                    variant_image, lang=language, config=f"--psm {psm}{options}"
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

                # 必ず年月日を先に解析。失敗時のみ年月候補として扱う
                expiry_candidate = parse_expiry_date(recognized_text)
                if expiry_candidate:
                    if is_plausible_expiry(expiry_candidate):
                        date_counts[expiry_candidate] = (
                            date_counts.get(expiry_candidate, 0) + 1
                        )
                    else:
                        print("範囲外の日付候補を除外:", expiry_candidate, flush=True)
                    # 範囲外でも、年月候補に格下げせず次の認識結果へ。
                    continue

                month_candidate = parse_expiry_month(recognized_text)
                # 年/月の漢字が「8」等に化けた場合の限定的な救済策。
                # ほかの画像領域には適用しない。
                if not month_candidate and variant_name == "yearmonth-wide":
                    month_candidate = parse_expiry_month_fuzzy(recognized_text)
                    if month_candidate:
                        print("年月の要確認候補 [wide]:", month_candidate, flush=True)
                if month_candidate:
                    if is_plausible_expiry(month_candidate, month_only=True):
                        month_counts[month_candidate] = (
                            month_counts.get(month_candidate, 0) + 1
                        )
                    else:
                        print("範囲外の年月候補を除外:", month_candidate, flush=True)

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
