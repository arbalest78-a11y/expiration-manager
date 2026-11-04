        w, h = roi_enhanced.size
        right_cut = roi_enhanced.crop((0, 0, max(1, int(w * 0.77)), h))
        variants = [
            ("original", enlarged, 13, "eng"),
            ("roi-original", roi_enlarged, 13, "eng"),
            ("roi-contrast", roi_enhanced, 8, "eng"),
            ("text-band-dots", text_band, 13, "eng"),
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
