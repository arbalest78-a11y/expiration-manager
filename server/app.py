from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageOps, ImageEnhance
import pytesseract
import re
import calendar

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

        image = image.crop(
            (
                int(width * 0.25),  # 左
                int(height * 0.25),  # 上
                int(width * 0.75),  # 右
                int(height * 0.60),  # 下
            )
        )

        # 小さい文字を読みやすくするため3倍に拡大
        width, height = image.size

        image = image.resize((width * 3, height * 3))

        # グレースケール化
        image = ImageOps.grayscale(image)

        # コントラストを強調
        image = ImageOps.autocontrast(image)

        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.0)
        # 白黒をはっきりさせる
        # image = image.point(lambda x: 0 if x < 140 else 255)

        # 加工後の画像を確認用に保存
        # image.save("ocr_debug.png")

        # OCR
        text = pytesseract.image_to_string(image, lang="jpn+eng", config="--psm 11")

        # 日付用：数字だけを読み取る
        date_text = pytesseract.image_to_string(
            image, lang="eng", config="--psm 11 -c tessedit_char_whitelist=0123456789"
        )

        print("日付OCR結果:")
        print(date_text)

        #print("OCR結果:")
        #print(text)

        # 賞味期限らしい日付を探す
        expiry = None

        # まず「年月日」を探す
        full_date_pattern = (
            r"(20\d{2})" r"[年./-]" r"(\d{1,2})" r"[月./-]" r"(\d{1,2})" r"日?"
        )

        match = re.search(full_date_pattern, text)

        if match:
            year = int(match.group(1))
            month = int(match.group(2))
            day = int(match.group(3))

            expiry = f"{year:04d}-{month:02d}-{day:02d}"

        else:
            # 「2026年11月」のような年月だけの表記を探す
            year_month_pattern = r"(20\d{2})" r"\s*年\s*" r"(\d{1,2})" r"\s*月"

            match = re.search(year_month_pattern, text)

            if match:
                year = int(match.group(1))
                month = int(match.group(2))

                # その月の末日を取得
                day = calendar.monthrange(year, month)[1]

                expiry = f"{year:04d}-{month:02d}-{day:02d}"

        return jsonify({"name": "", "expiry": expiry, "text": text})

    except Exception as error:
        print("OCRエラー:", error)

        return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
