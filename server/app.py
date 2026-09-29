from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageOps, ImageEnhance
import pytesseract
import re
import calendar


def parse_expiry_date(text):
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


app = Flask(__name__)
CORS(app)

# Tesseract本体の場所を指定
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


@app.route("/ocr", methods=["POST"])
def ocr():
    if "image" not in request.files:
        return jsonify({"error": "画像がありません"}), 400

    image_file = request.files["image"]

    print("受信した画像:", image_file.filename)

    try:
        # 画像を読み込む
        image = Image.open(image_file.stream)

        # 画像中央付近の賞味期限部分を切り出す
        width, height = image.size

        # image = image.crop(
        #     (
        #         int(width * 0.25),
        #         int(height * 0.25),
        #         int(width * 0.75),
        #         int(height * 0.60),
        #     )
        # )

        # 小さい文字を読みやすくするため3倍に拡大
        width, height = image.size

        image = image.resize((width * 3, height * 3))

        # グレースケール化
        image = ImageOps.grayscale(image)

        # コントラストを強調
        image = ImageOps.autocontrast(image)

        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.0)

        # 文字をくっきりさせる
        sharpener = ImageEnhance.Sharpness(image)
        image = sharpener.enhance(2.0)

        # 白黒をはっきりさせる
        # image = image.point(lambda x: 0 if x < 110 else 255)

        # 周囲に白い余白を追加
        image = ImageOps.expand(image, border=20, fill=255)

        # 加工後の画像を確認用に保存
        # image.save("ocr_debug.png")
        
        # =========================
        # 複数パターンでOCRを試す
        # =========================

        width, height = image.size

        image_variants = [
            ("full", image),

            # 少しだけ周囲を除く
            (
                "trim-small",
                image.crop(
                    (
                        int(width * 0.05),
                        int(height * 0.10),
                        int(width * 0.95),
                        int(height * 0.90),
                    )
                ),
            ),

            # 周囲の背景をもう少し除く
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
        ocr_results = []

        for variant_name, variant_image in image_variants:

            # OCRしやすいように白い余白を追加
            variant_image = ImageOps.expand(
                variant_image,
                border=20,
                fill=255,
            )

            for psm in psm_modes:

                text = pytesseract.image_to_string(
                    variant_image,
                    lang="eng",
                    config=(
                        f"--psm {psm} "
                        "-c tessedit_char_whitelist=0123456789./-"
                    ),
                ).strip()

                print(
                    f"OCR [{variant_name} / psm {psm}]:",
                    repr(text),
                )

                if text:
                    ocr_results.append(text)

                expiry_candidate = parse_expiry_date(text)

                if expiry_candidate:
                    date_counts[expiry_candidate] = (
                        date_counts.get(expiry_candidate, 0) + 1
                    )


        # 一番多く認識された日付を採用
        expiry = None

        if date_counts:
            expiry = max(
                date_counts,
                key=date_counts.get,
            )


        print("日付候補:", date_counts)
        print("採用した賞味期限:", expiry)

        return jsonify({"name": "", "expiry": expiry, "text": text})

    except Exception as error:
        print("OCRエラー:", error)

        return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
