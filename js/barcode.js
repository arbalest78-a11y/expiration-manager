
export function setupBarcodeScanner({ onStart, onDetected }) {
  const startButton = document.getElementById('startBarcodeButton')
  const stopButton = document.getElementById('stopBarcodeButton')
  const area = document.getElementById('barcodeArea')
  const video = document.getElementById('barcodeVideo')
  const status = document.getElementById('barcodeStatus')
  let scanControls = null
  let session = 0

  function stop() {
    session += 1
    if (scanControls) {
      scanControls.stop()
      scanControls = null
    }
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop())
      video.srcObject = null
    }
    area.hidden = true
    startButton.disabled = false
  }

  startButton.addEventListener('click', async function () {
    stop()
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'カメラの利用にはHTTPS接続が必要です。'
      return
    }
    if (!window.ZXingBrowser?.BrowserMultiFormatOneDReader) {
      status.textContent = 'バーコード読み取りライブラリを読み込めませんでした。'
      return
    }

    onStart()
    const currentSession = ++session
    startButton.disabled = true
    area.hidden = false
    status.textContent = 'カメラを起動しています…'

    try {
      const reader = new window.ZXingBrowser.BrowserMultiFormatOneDReader()
      const controls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        video,
        (result, error, controls) => {
          if (currentSession !== session || !result) return
          const raw = result.getText().trim()
          const code = /^\d{12}$/.test(raw) ? `0${raw}` : raw
          if (!/^(?:\d{8}|\d{13})$/.test(code)) return

          controls.stop()
          stop()
          status.textContent = `JANコード ${code} を読み取りました。商品を検索します。`
          onDetected(code)
        }
      )

      if (currentSession !== session) {
        controls.stop()
      } else {
        scanControls = controls
        status.textContent = '赤枠にバーコードを合わせてください。'
      }
    } catch (error) {
      if (currentSession !== session) return
      stop()
      status.textContent = error.name === 'NotAllowedError'
        ? 'カメラへのアクセスを許可してください。'
        : `カメラを起動できませんでした：${error.message}`
    }
  })

  stopButton.addEventListener('click', function () {
    stop()
    status.textContent = '読み取りを中止しました。'
  })

  return { stop }
}
