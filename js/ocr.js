// =========================
// OCRで読み取った文字から日付を探す
// =========================

function findDate(text) {
  const normalizedText = text
    // 全角数字 → 半角数字
    .replace(/[０-９]/g, function (char) {
      return String.fromCharCode(
        char.charCodeAt(0) - 0xFEE0
      );
    })

    // 全角記号などを統一
    .replace(/[．。]/g, ".")
    .replace(/[／]/g, "/")
    .replace(/[－ー−]/g, "-")

    // OCRでよくある数字の誤認識を補正
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1");

  console.log("OCR補正前:", text);
  console.log("OCR補正後:", normalizedText);

  // =========================
  // ① YYYY/MM/DD
  //    YYYY.MM.DD
  //    YYYY-MM-DD
  //    YYYY年MM月DD日
  // =========================

  const fullDateMatch = normalizedText.match(
    /(20\d{2})\s*[./\-年]\s*(0?[1-9]|1[0-2])\s*[./\-月]\s*(0?[1-9]|[12]\d|3[01])\s*日?/
  );

  if (fullDateMatch) {
    const year = Number(fullDateMatch[1]);
    const month = Number(fullDateMatch[2]);
    const day = Number(fullDateMatch[3]);

    const date = formatDate(year, month, day);

    if (date) {
      return date;
    }
  }

  // =========================
  // ② YYYY/MM
  //    YYYY.MM
  //    YYYY-MM
  //    YYYY年MM月
  //
  // 日がない場合は月末にする
  // 例：2027.07 → 2027-07-31
  // =========================

  const yearMonthMatch = normalizedText.match(
    /(20\d{2})\s*[./\-年]\s*(0?[1-9]|1[0-2])\s*月?/
  );

  if (yearMonthMatch) {
    const year = Number(yearMonthMatch[1]);
    const month = Number(yearMonthMatch[2]);

    return formatYearMonth(year, month);
  }

  // =========================
  // ③ YY/MM/DD
  //    YY.MM.DD
  //    YY-MM-DD
  // =========================

  const shortDateMatch = normalizedText.match(
    /(?:^|\s)(\d{2})\s*[./\-]\s*(0?[1-9]|1[0-2])\s*[./\-]\s*(0?[1-9]|[12]\d|3[01])(?:\s|$)/
  );

  if (shortDateMatch) {
    const year = 2000 + Number(shortDateMatch[1]);
    const month = Number(shortDateMatch[2]);
    const day = Number(shortDateMatch[3]);

    const date = formatDate(year, month, day);

    if (date) {
      return date;
    }
  }

  return null;
}


// =========================
// YYYY-MM-DD形式に変換
// =========================

function formatDate(year, month, day) {
  const date = new Date(
    year,
    month - 1,
    day
  );

  // 存在しない日付を除外
  // 例：2027/02/31
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return (
    String(year).padStart(4, "0") +
    "-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}


// =========================
// 年月だけの場合は月末日にする
// =========================

function formatYearMonth(year, month) {

  // 翌月の0日 = 今月の最終日
  const lastDay = new Date(
    year,
    month,
    0
  ).getDate();

  return formatDate(
    year,
    month,
    lastDay
  );
}


// =========================
// 画像から賞味期限を読み取る
// =========================

export async function readExpiryDate(
  file,
  onProgress
) {

  const worker =
    await window.Tesseract.createWorker(
      "eng",
      1,
      {
        logger: function (message) {
          if (onProgress) {
            onProgress(message);
          }
        }
      }
    );

  try {

    // 日付に必要な文字を中心にOCR
    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789./-年月日 ",
      tessedit_pageseg_mode:
        window.Tesseract.PSM.SPARSE_TEXT
    });

    const result =
      await worker.recognize(file);

    console.log(
      "OCR結果:",
      result.data.text
    );

    const date =
      findDate(result.data.text);

    console.log(
      "検出した賞味期限:",
      date
    );

    return {
      text: result.data.text,
      date: date
    };

  } finally {

    await worker.terminate();

  }
}
