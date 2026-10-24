
// JANコードの読み取り（ZXingを使用）
// 読み取ったJANコードを商品名へ反映する機能はまだ未実装です。
export function createBarcodeScanner (cameraVideo, ocrStatus) {
  const janCodeReader = new ZXingBrowser.BrowserMultiFormatOneDReader()
  let barcodeControls = null
  let detectedJan = ''
  let scanId = 0

  async function start (cameraStream) {
    if (!cameraStream) return
    const currentScan = ++scanId
    detectedJan = ''

    try {
      const controls = await janCodeReader.decodeFromStream(
        cameraStream,
        cameraVideo,
        function (result) {
          if (!result || currentScan !== scanId) return

          const code = result.getText()
          if (!/^(?:\d{8}|\d{13})$/.test(code)) return
          if (detectedJan === code) return

          detectedJan = code
          console.log('JANコードを読み取りました:', detectedJan)
        }
      )

      if (currentScan !== scanId) {
        controls.stop()
        return
      }
      barcodeControls = controls
    } catch (error) {
      if (currentScan !== scanId) return
      console.error('JANコード読み取りエラー:', error)
      ocrStatus.textContent = 'JANコードの読み取りを開始できませんでした。'
    }
  }

  function stop () {
    scanId++
    if (barcodeControls) {
      barcodeControls.stop()
      barcodeControls = null
    }
  }

  return { start, stop }
}
