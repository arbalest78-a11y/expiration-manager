// OCRサーバーへ画像を送る処理
// 現在はPython未導入のためテストデータを返す

// OCRサーバーへ画像を送る処理

export async function requestOcr(file) {
  const formData = new FormData();

  formData.append("image", file);

  const response = await fetch(
    "https://ffd3b2abc2ca16.lhr.life/ocr",
    {
      method: "POST",
      body: formData
    }
  );

  if (!response.ok) {
    throw new Error("OCRサーバーとの通信に失敗しました。");
  }

  const result = await response.json();

  return result;
}
