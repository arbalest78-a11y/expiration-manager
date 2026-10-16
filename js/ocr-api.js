// Render の OCR API。自動スキャン時には signal で不要な通信を中断できる。
export async function requestOcr (file, { signal } = {}) {
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch('https://expiration-manager.onrender.com/ocr', {
    method: 'POST',
    body: formData,
    signal
  })

  if (!response.ok) {
    throw new Error(`OCRサーバーとの通信に失敗しました（HTTP ${response.status}）。`)
  }

  return response.json()
}
