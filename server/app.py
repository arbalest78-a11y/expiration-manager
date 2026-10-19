
        width, height = soft.size
        center = soft.crop(
            (int(width * 0.08), int(height * 0.18),
             int(width * 0.92), int(height * 0.82))
        )

        # ドット印字は拡大・強調で逆に読みにくくなる場合があるため、
        # 元画像の左寄り中央帯（年月部分）も別途OCRにかける。
        # ※年月は確定日付ではないので、フロント側での確認が必須。
        original_gray = ImageOps.grayscale(image)
        year_month_area = original_gray.crop(
            (int(original_width * 0.10), int(original_height * 0.25),
             int(original_width * 0.75), int(original_height * 0.75))
        )

        # ボトルの曲面印字では上下を狭く切ると文字が欠けやすい。
        # 広めの領域を元画像から切り出し、文字種の制限なしで1行OCRする。
        # 「2026年11月+C」など、右側に別の印字が続くケースも想定。
        year_month_wide = original_gray.crop(
            (int(original_width * 0.05), int(original_height * 0.05),
             int(original_width * 0.78), int(original_height * 0.90))
        )

        image_variants = [
            ("trim-medium", center, (7, 8), "jpn+eng", ""),
            ("trim-binary", center.point(lambda p: 0 if p < 150 else 255),
             (7, 8), "jpn+eng", ""),
            ("yearmonth-left", year_month_area, (8,), "eng",
             " -c tessedit_char_whitelist=0123456789.,/-"),
            ("yearmonth-wide", year_month_wide, (7,), "eng", ""),
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