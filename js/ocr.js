// OCRで読み取った文字から日付を探す
function findDate(text) {
  // 全角数字を半角数字に変換
  const normalizedText = text.replace(/[０-９]/g, function (char) {
    return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
  });

  // 2026/09/10、2026.09.10、2026年09月10日 など
  const longYearMatch = normalizedText.match(
    /(20\d{2})\D{0,3}(0?[1-9]|1[0-2])\D{0,3}(0?[1-9]|[12]\d|3[01])/
  );

  if (longYearMatch) {
    return formatDate(
      Number(longYearMatch[1]),
      Number(longYearMatch[2]),
      Number(longYearMatch[3])
    );
  }

  // 26/09/10、26.09.10 など
  const shortYearMatch = normalizedText.match(
    /(\d{2})\D{0,3}(0?[1-9]|1[0-2])\D{0,3}(0?[1-9]|[12]\d|3[01])/
  );

  if (shortYearMatch) {
    return formatDate(
      2000 + Number(shortYearMatch[1]),
      Number(shortYearMatch[2]),
      Number(shortYearMatch[3])
    );
  }

  return null;
}

// input type="date" に入れられる形式へ変換
function formatDate(year, month, day) {
  const date = new Date(year, month - 1, day);

  // 2月31日など、存在しない日付を除外
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

// 画像から賞味期限を読み取る
export async function readExpiryDate(file, onProgress) {
  const worker = await window.Tesseract.createWorker("eng", 1, {
    logger: function (message) {
      if (onProgress) {
        onProgress(message);
      }
    }
  });

  try {
    const result = await worker.recognize(file);

    console.log("OCR結果:", result.data.text);

    return {
      text: result.data.text,
      date: findDate(result.data.text)
    };
  } finally {
    await worker.terminate();
  }
}