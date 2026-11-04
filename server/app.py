from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageOps
import pytesseract
import re
import calendar
import os
import time
from datetime import date
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
import json


def normalize_ocr_text(text):
    """OCRで誤読しやすい数字と区切り記号の表記を統一。"""
    replacements = str.maketrans("０１２３４５６７８９．，／－", "0123456789.,/-")
    text = text.translate(replacements).replace("。", ".")
    # 印字されたピリオドがカンマとして認識されることがある
    return re.sub(r"(?<=\d),\s*(?=\d)", ".", text)


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


def _date_from_parts(year_text, month_text, day_text):
    """年月日の数字をカレンダー上の妥当な日付に変換する。"""
    try:
        year = int(year_text)
        if year < 100:
            year += 2000
        candidate = date(year, int(month_text), int(day_text)).isoformat()
    except ValueError:
        return None
    return candidate if is_plausible_expiry(candidate) else None


def extract_date_candidates(text):
    """(確実に区切れた年月日, 末尾推測の年月日) を返す。

    '27.05.25+E' は区切れた日付候補。
    '27,05, 2546' は末尾の製造記号を数字と誤読した可能性があるため
    推測候補にだけ入れる。推測は必ず人間が実物の印字を確認する。
    """
    text = normalize_ocr_text(text).upper()
    exact = set()
    inferred = set()

    # 2桁/4桁の年と、月および2桁の日。曖昧な1桁の日は誤切り出しを避ける。
    # 日本語の「年/月/日」にも対応する。
    pattern = r"(?<![A-Z0-9])(20\d{2}|\d{2})[-./年](0?[1-9]|1[0-2])[-./月](\d{2})(\d{0,3})(?=$|[^0-9])"
    for match in re.finditer(pattern, text):
        candidate = _date_from_parts(match.group(1), match.group(2), match.group(3))
        if not candidate:
            continue
        if match.group(4):
            inferred.add(candidate)
        else:
            exact.add(candidate)

    # 月日を二桁で連結した例: 2705.25
    for match in re.finditer(r"(?<![0-9])(\d{2})(0[1-9]|1[0-2])[.\/-](\d{2})(?![0-9])",text):
        candidate = _date_from_parts(*match.groups())
        if candidate:
            exact.add(candidate)

    return exact, inferred


def parse_expiry_date(text):
    """互換性のため残す厳格な日付抽出。"""
    exact, _ = extract_date_candidates(text)
    return sorted(exact)[0] if len(exact) == 1 else None


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


@app.route("/product/<jan_code>", methods=["GET"])
def get_product(jan_code):
    # JANコードの形式確認
    if not jan_code.isdigit() or len(jan_code) not in (8, 13):
        return jsonify({"error": "JANコードは8桁または13桁で入力してください"}), 400

    params = urlencode({"fields": "product_name,brands,image_front_url"})
    url = f"https://world.openfoodfacts.org/api/v2/product/" f"{jan_code}?{params}"

    headers = {"User-Agent": os.environ["OFF_USER_AGENT"]}

    try:
        req = Request(url, headers=headers)

        with urlopen(req, timeout=10) as response:
            data = json.load(response)

        if data.get("status") != 1:
            return jsonify({"error": "商品が見つかりませんでした"}), 404

        product = data.get("product", {})

        return jsonify(
            {
                "jan_code": jan_code,
                "name": product.get("product_name", ""),
                "brand": product.get("brands", ""),
                "image_url": product.get("image_front_url", ""),
            }
        )

    except (HTTPError, URLError, TimeoutError) as error:
        print("商品検索APIエラー:", error)
        return jsonify({"error": "商品情報の取得に失敗しました"}), 502


@app.route("/ocr", methods=["POST"])
def ocr():
    """複数条件で読み、矛盾も返す。最終的な日付入力はブラウザで人が承認する。"""
    if "image" not in request.files:
        return jsonify({"error": "画像がありません"}), 400

    image_file = request.files["image"]
    started = time.perf_counter()
    print("受信した画像:", image_file.filename, flush=True)

    try:
        # EXIFで回転している写真にも対応する
        image = ImageOps.exif_transpose(Image.open(image_file.stream)).convert("RGB")
        if min(image.size) < 40:
            return jsonify({"error": "画像が小さすぎます。近づいて撮影してください"}), 400
        if image.width * image.height > 16_000_000:
            return jsonify({"error": "画像が大きすぎます。撮影範囲を小さくしてください"}), 400

        # 画像が大きい場合はOCR用に縮小してメモリ使用量を抑える。
        # 元画像自体は保存せず、このリクエスト内だけで利用する。
        gray = ImageOps.grayscale(image)
        del image
        max_side = 1800
        if max(gray.size) > max_side:
            gray.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

        # カメラガイド内の画像は上下に容器の縁が写る場合がある。
        # 印字の周辺を切り出すパターンも用意し、元の全体画像と比較する。
        roi = gray.crop((int(gray.width * 0.06), int(gray.height * 0.04),
                         int(gray.width * 0.95), int(gray.height * 0.82)))
        # 画像を拡大してドット印字を読み取りやすくする。
        # 元画像の画素が存在しないものを推測で補うことはできない点に注意。
        # 小さい画像だけ拡大する。元から大きい画像の2倍拡大は避ける。
        longest_side = max(gray.size)
        scale = 3 if longest_side < 700 else (2 if longest_side < 1200 else 1)
        enlarged = gray.resize((gray.width * scale, gray.height * scale), Image.Resampling.LANCZOS)
        enhanced = ImageOps.autocontrast(enlarged)
        roi_enlarged = roi.resize((roi.width * scale, roi.height * scale), Image.Resampling.LANCZOS)
        roi_enhanced = ImageOps.autocontrast(roi_enlarged)
        # 二値化も追加で試す。ドット印字では白黒化が逆効果のこともあるため、
        # 元画像・グレー画像と独立した候補として扱う。
        histogram = roi_enhanced.histogram()
        pixels = sum(histogram)
        sum_all = sum(i * count for i, count in enumerate(histogram))
        weight_bg = 0
        sum_bg = 0
        best_score = -1
        threshold = 128
        for intensity, count in enumerate(histogram):
            weight_bg += count
            if not weight_bg or weight_bg == pixels:
                continue
            sum_bg += intensity * count
            weight_fg = pixels - weight_bg
            mean_bg = sum_bg / weight_bg
            mean_fg = (sum_all - sum_bg) / weight_fg
            score = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
            if score > best_score:
                best_score = score
                threshold = intensity
        roi_binary = roi_enhanced.point(lambda p: 255 if p > threshold else 0)

        # 処理負荷を抑えるため、特徴の異なる5パターンに絞る。
        # 製造記号が日付の末尾につく場合に備え、右端切り落としも1回試す。
        w, h = roi_enhanced.size
        right_cut = roi_enhanced.crop((0, 0, max(1, int(w * 0.77)), h))
        variants = [
            ("original", enlarged, 13, "eng"),
            ("roi-original", roi_enlarged, 13, "eng"),
            ("roi-contrast", roi_enhanced, 8, "eng"),
            ("roi-binary", roi_binary, 13, "eng"),
            ("right-0.77", right_cut, 13, "eng"),
        ]

        exact_counts = {}
        inferred_counts = {}
        month_counts = {}
        raw_texts = []
        # 全passが同じTesseractのため独立した複数OCRエンジンの合意ではない。
        for variant_name, variant_image, psm, language in variants:
            white_border = ImageOps.expand(variant_image, border=18, fill=255)
            t0 = time.perf_counter()
            try:
                recognized_text = pytesseract.image_to_string(
                    white_border,
                    lang=language,
                    config=(f"--psm {psm} "
                            "-c tessedit_char_whitelist=0123456789./-+E年月日 "
                            "-c load_system_dawg=0 -c load_freq_dawg=0"),
                    timeout=12,
                ).strip()
            except (RuntimeError, pytesseract.TesseractError) as error:
                print(f"OCR [{variant_name}] 失敗:", error, flush=True)
                continue
            print(f"OCR [{variant_name} / psm {psm}]: {recognized_text!r} "
                  f"({time.perf_counter()-t0:.2f}秒)", flush=True)
            if recognized_text:
                raw_texts.append(recognized_text)

            exact, inferred = extract_date_candidates(recognized_text)
            for candidate in exact:
                exact_counts[candidate] = exact_counts.get(candidate, 0) + 1
            for candidate in inferred:
                inferred_counts[candidate] = inferred_counts.get(candidate, 0) + 1

            # 日付らしい3つ目の数字があれば、年月のみへの格下げはしない
            if exact or inferred:
                continue
            month = parse_expiry_month(recognized_text)
            if month and is_plausible_expiry(month, month_only=True):
                month_counts[month] = month_counts.get(month, 0) + 1

        # 英数のみでまったく読み取れない場合だけ従来の日本語モデルを追加。
        if not (exact_counts or inferred_counts or month_counts):
            for variant_name, variant_image in (("jpn-original", enhanced),):
                try:
                    recognized_text = pytesseract.image_to_string(
                        ImageOps.expand(variant_image, border=18, fill=255),
                        lang="jpn+eng", config="--psm 8", timeout=12,
                    ).strip()
                except (RuntimeError, pytesseract.TesseractError) as error:
                    print("OCR日本語フォールバック失敗:", error, flush=True)
                    continue
                print(f"OCR [{variant_name}]: {recognized_text!r}", flush=True)
                if recognized_text:
                    raw_texts.append(recognized_text)
                exact, inferred = extract_date_candidates(recognized_text)
                for candidate in exact:
                    exact_counts[candidate] = exact_counts.get(candidate, 0) + 1
                for candidate in inferred:
                    inferred_counts[candidate] = inferred_counts.get(candidate, 0) + 1
                if not (exact or inferred):
                    month = parse_expiry_month(recognized_text)
                    if month and is_plausible_expiry(month, month_only=True):
                        month_counts[month] = month_counts.get(month, 0) + 1

        # その日の証拠の種類と支持回数で並べる。推測を確定扱いしない。
        all_days = sorted(set(exact_counts) | set(inferred_counts),
                          key=lambda k: (-(exact_counts.get(k, 0) + inferred_counts.get(k, 0)),
                                         -exact_counts.get(k, 0), k))
        suggested_date = None
        exact_date = None
        month_date = None
        warning = ""
        certainty = "none"
        if all_days:
            winner = all_days[0]
            conflicts = len(all_days) > 1
            if exact_counts.get(winner, 0) >= 2 and not conflicts:
                exact_date = winner
                certainty = "review_required"
            else:
                suggested_date = winner
                certainty = "uncertain"
            if conflicts:
                warning = "複数の異なる日付を認識しました。必ず実物を確認してください。"
            elif exact_counts.get(winner, 0) == 0:
                warning = "末尾の文字を補正した推定値です。実物との照合が必要です。"
        elif len(month_counts) == 1:
            # 3つ目の日付要素を認識していない場合のみ「年月のみ」を提示する。
            month_date = next(iter(month_counts))
            certainty = "month_only"
        elif len(month_counts) > 1:
            warning = "年月候補が複数あります。手動で入力してください。"

        print("日付確定形の候補:", exact_counts, flush=True)
        print("日付末尾補正候補:", inferred_counts, flush=True)
        print("年月候補:", month_counts, flush=True)
        print("提案した日付:", exact_date or suggested_date, flush=True)
        print(f"処理時間: {time.perf_counter()-started:.2f}秒", flush=True)

        return jsonify({
            "name": "",
            "expiry": exact_date,
            "expiry_suggestion": suggested_date,
            "expiry_month": month_date,
            "expiry_precision": "day" if all_days else ("month" if month_date else None),
            "needs_confirmation": True,
            "expiry_confidence": certainty,
            "expiry_warning": warning,
            "date_candidates": all_days[:5],
            "text": raw_texts[-1] if raw_texts else "",
            "ocr_texts": raw_texts,
        })
    except Exception as error:
        print("OCRエラー:", error, flush=True)
        return jsonify({"error": "OCR処理でエラーが発生しました"}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
