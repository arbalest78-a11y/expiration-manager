// JANコードの読み取り。カメラ切替・対応端末でのピント調整に対応。
export function setupBarcodeScanner({ onStart, onDetected }) {
  const startButton = document.getElementById('startBarcodeButton')
  const stopButton = document.getElementById('stopBarcodeButton')
  const area = document.getElementById('barcodeArea')
  const video = document.getElementById('barcodeVideo')
  const status = document.getElementById('barcodeStatus')
  const cameraSelectRow = document.getElementById('barcodeCameraSelectRow')
  const cameraSelect = document.getElementById('barcodeCameraSelect')
  const focusButton = document.getElementById('barcodeFocusButton')
  const focusStatus = document.getElementById('barcodeFocusStatus')

  let scanControls = null
  let session = 0
  let selectedCameraId = ''
  let guidanceTimer = null

  function clearGuidanceTimer() {
    if (guidanceTimer !== null) {
      clearTimeout(guidanceTimer)
      guidanceTimer = null
    }
  }

  function stop() {
    clearGuidanceTimer()
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
    focusButton.hidden = true
    focusButton.disabled = true
    focusStatus.hidden = true
    cameraSelectRow.hidden = true
  }

  async function updateCameraChoices(currentSession) {
    if (!navigator.mediaDevices.enumerateDevices) return
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter(device => device.kind === 'videoinput' && device.deviceId)
      if (currentSession !== session) return

      cameraSelect.innerHTML = ''
      const auto = document.createElement('option')
      auto.value = ''
      auto.textContent = '自動（背面カメラ）'
      cameraSelect.appendChild(auto)

      devices.forEach((device, index) => {
        const option = document.createElement('option')
        option.value = device.deviceId
        option.textContent = device.label || `カメラ ${index + 1}`
        cameraSelect.appendChild(option)
      })

      cameraSelectRow.hidden = devices.length <= 1
      const activeId = video.srcObject?.getVideoTracks()[0]?.getSettings?.().deviceId || ''
      if (selectedCameraId && devices.some(device => device.deviceId === selectedCameraId)) {
        cameraSelect.value = selectedCameraId
      } else if (activeId && devices.some(device => device.deviceId === activeId)) {
        // 実際に使われているカメラを表示する
        cameraSelect.value = activeId
      } else {
        cameraSelect.value = ''
      }
    } catch (error) {
      console.warn('JANカメラ一覧の取得に失敗:', error)
      if (currentSession === session) cameraSelectRow.hidden = true
    }
  }

  async function setupFocus(currentSession) {
    const track = video.srcObject?.getVideoTracks()[0]
    if (!track || currentSession !== session) return

    let modes = []
    try {
      const capabilities = track.getCapabilities?.() || {}
      modes = Array.isArray(capabilities.focusMode) ? capabilities.focusMode : []
    } catch (error) {
      console.warn('JANカメラのAF情報を取得できません:', error)
    }

    if (modes.includes('continuous')) {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
      } catch (error) {
        console.warn('JANカメラの連続AFを設定できません:', error)
      }
    }
    if (currentSession !== session) return

    const canSingleFocus = modes.includes('single-shot')
    focusButton.hidden = !canSingleFocus
    focusButton.disabled = !canSingleFocus
    focusStatus.hidden = false
    focusStatus.textContent = canSingleFocus
      ? 'ぼやける場合は「ピントを合わせる」を押してください。'
      : '手動ピント調整はこのカメラでは使えません。距離を変えるかカメラを切り替えてください。'
  }

  async function start() {
    stop()
    status.textContent = '読み取りボタンを押しました。カメラと読み取り機能を確認しています…'
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
      const constraints = {
        audio: false,
        video: selectedCameraId
          ? { deviceId: { exact: selectedCameraId } }
          : { facingMode: { ideal: 'environment' } }
      }
      const controls = await reader.decodeFromConstraints(
        constraints,
        video,
        (result, error, controls) => {
          if (currentSession !== session || !result) return
          const raw = result.getText().trim()
          const code = /^\d{12}$/.test(raw) ? `0${raw}` : raw
          clearGuidanceTimer()
          if (!/^(?:\d{8}|\d{13})$/.test(code)) {
            status.textContent = `文字は認識しましたが、JANコードではありません（${raw}）。8桁または13桁のバーコードを映してください。`
            return
          }

          controls.stop()
          stop()
          status.textContent = `JANコード ${code} を読み取りました。商品を検索します。`
          onDetected(code)
        }
      )

      if (currentSession !== session) {
        controls.stop()
        return
      }
      scanControls = controls
      status.textContent = 'カメラの起動に成功しました。JANコードを赤枠内に水平に映してください。読み取り処理を実行中です。'
      guidanceTimer = setTimeout(() => {
        if (currentSession === session && video.srcObject) {
          status.textContent = '読み取り処理は動作中ですが、まだJANコードを認識できていません。少し離して全体を映す・明るくする・カメラを切り替える、の順で試してください。'
        }
      }, 8000)
      await updateCameraChoices(currentSession)
      await setupFocus(currentSession)
    } catch (error) {
      if (currentSession !== session) return
      stop()
      status.textContent = error.name === 'NotAllowedError'
        ? 'カメラへのアクセスを許可してください。'
        : `カメラを起動できませんでした：${error.message}`
    }
  }

  startButton.addEventListener('click', start)

  cameraSelect.addEventListener('change', function () {
    selectedCameraId = cameraSelect.value
    start()
  })

  focusButton.addEventListener('click', async function () {
    const track = video.srcObject?.getVideoTracks()[0]
    if (!track) return
    focusButton.disabled = true
    focusStatus.textContent = 'ピントを合わせています…'
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] })
      focusStatus.textContent = 'ピント合わせを要求しました。読み取りを続けてください。'
    } catch (error) {
      focusStatus.textContent = 'ピント調整に失敗しました。距離を変えて試してください。'
      console.warn('JANカメラのピント調整に失敗:', error)
    } finally {
      focusButton.disabled = !video.srcObject
    }
  })

  stopButton.addEventListener('click', function () {
    stop()
    status.textContent = '読み取りを中止しました。'
  })

  return { stop }
}
