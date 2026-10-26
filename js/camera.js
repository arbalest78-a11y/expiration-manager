import {
  startCameraButton,
  cameraArea,
  cameraVideo,
  captureButton,
  stopCameraButton,
  cameraCanvas,
  ocrButton,
  ocrStatus
} from './dom.js'

import { requestOcr } from './ocr-api.js'
import { getVideoConstraints, selectAutofocusCamera } from './camera-af.js'

const expiryGuide = document.getElementById('expiryGuide')
const focusButton = document.getElementById('focusButton')
const focusStatus = document.getElementById('focusStatus')
const zoomControl = document.getElementById('zoomControl')
const zoomSlider = document.getElementById('zoomSlider')
const zoomValue = document.getElementById('zoomValue')
const autoScanStatus = document.getElementById('autoScanStatus')
const cameraSelectRow = document.getElementById('cameraSelectRow')
const cameraSelect = document.getElementById('cameraSelect')

const AUTO_OCR_ENABLED = false

let cameraStream = null
let selectedCameraId = ''

function getGuideCropCoordinates (
  sourceWidth,
  sourceHeight,
  videoRect,
  guideRect
) {
  if (!sourceWidth || !sourceHeight || !videoRect.width || !videoRect.height) {
    throw new Error('カメラ映像のサイズを取得できません。')
  }
  // object-fit: cover の中央トリミングとガイド枠の座標を一致させる。
  const scale = Math.max(
    videoRect.width / sourceWidth,
    videoRect.height / sourceHeight
  )
  const hiddenX = (sourceWidth * scale - videoRect.width) / 2
  const hiddenY = (sourceHeight * scale - videoRect.height) / 2
  const x1 = Math.max(0, (guideRect.left - videoRect.left + hiddenX) / scale)
  const y1 = Math.max(0, (guideRect.top - videoRect.top + hiddenY) / scale)
  const x2 = Math.min(
    sourceWidth,
    (guideRect.right - videoRect.left + hiddenX) / scale
  )
  const y2 = Math.min(
    sourceHeight,
    (guideRect.bottom - videoRect.top + hiddenY) / scale
  )
  if (x2 <= x1 || y2 <= y1) {
    throw new Error('ガイド枠の切り抜き範囲を計算できません。')
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function cropGuideFromCanvas (sourceCanvas) {
  const area = getGuideCropCoordinates(
    sourceCanvas.width,
    sourceCanvas.height,
    cameraVideo.getBoundingClientRect(),
    expiryGuide.getBoundingClientRect()
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(area.width))
  canvas.height = Math.max(1, Math.round(area.height))
  canvas
    .getContext('2d')
    .drawImage(
      sourceCanvas,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      canvas.width,
      canvas.height
    )
  return canvas
}

function canvasToOcrFile (canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error('OCR画像を生成できませんでした。'))
          return
        }
        resolve(new File([blob], 'expiry-guide.jpg', { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.95
    )
  })
}

// ラプラシアン分散：数値が高いほど輪郭が多く、比較的鮮明な傾向。
// 文字が無い画像でも点数が高い場合があるため、この値だけで日付の正しさは決めない。
function calculateSharpness (canvas) {
  const scale = Math.min(1, 400 / canvas.width, 200 / canvas.height)
  const w = Math.max(3, Math.floor(canvas.width * scale))
  const h = Math.max(3, Math.floor(canvas.height * scale))
  const reduced = document.createElement('canvas')
  reduced.width = w
  reduced.height = h
  const context = reduced.getContext('2d', { willReadFrequently: true })
  context.drawImage(canvas, 0, 0, w, h)
  const pixels = context.getImageData(0, 0, w, h).data
  const gray = new Float32Array(w * h)
  for (let i = 0; i < gray.length; i++) {
    const j = 4 * i
    gray[i] = pixels[j] * 0.299 + pixels[j + 1] * 0.587 + pixels[j + 2] * 0.114
  }
  let sum = 0
  let sumSquares = 0
  let count = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const value =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
      sum += value
      sumSquares += value * value
      count++
    }
  }
  return count ? Math.max(0, sumSquares / count - (sum / count) ** 2) : 0
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function setupCamera ({ onCaptureStart, onCapture, onAutoResult }) {
  let scanSession = 0
  let startupSession = 0
  let scanTimer = null
  let inFlightController = null
  let starting = false
  let networkErrors = 0
  let blurRetries = 0

  const setAutoStatus = text => {
    autoScanStatus.textContent = text
  }

  function cancelAutoScan () {
    scanSession++
    if (scanTimer !== null) clearTimeout(scanTimer)
    scanTimer = null
    if (inFlightController) {
      inFlightController.abort()
      inFlightController = null
    }
  }

  function scheduleAutoScan (session, delayMs) {
    if (session !== scanSession || !cameraStream) return
    scanTimer = setTimeout(() => {
      scanTimer = null
      void scanFrame(session)
    }, delayMs)
  }

  function showOcrDebugImage (file) {
    let img = document.getElementById('ocrDebugImage')
    if (!img) {
      const caption = document.createElement('p')
      caption.textContent = 'OCRに送った画像（確認用）'
      caption.id = 'ocrDebugCaption'
      img = document.createElement('img')
      img.id = 'ocrDebugImage'
      img.style.display = 'block'
      img.style.width = '100%'
      img.style.maxWidth = '320px'
      img.style.marginTop = '6px'
      ocrStatus.after(caption, img)
    }
    const url = URL.createObjectURL(file)
    img.onload = () => URL.revokeObjectURL(url)
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }

  function captureCandidate () {
    if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) return null
    const fullCanvas = document.createElement('canvas')
    fullCanvas.width = cameraVideo.videoWidth
    fullCanvas.height = cameraVideo.videoHeight
    fullCanvas
      .getContext('2d')
      .drawImage(cameraVideo, 0, 0, fullCanvas.width, fullCanvas.height)
    const ocrCanvas = cropGuideFromCanvas(fullCanvas)
    return { fullCanvas, ocrCanvas, score: calculateSharpness(ocrCanvas) }
  }

  async function findBestFrame (session) {
    let best = null
    // 約0.6秒の間に3枚比較。OCRサーバーには最良の1枚だけ送る。
    for (let i = 0; i < 3; i++) {
      if (session !== scanSession || !cameraStream) return null
      const candidate = captureCandidate()
      if (candidate && (!best || candidate.score > best.score)) best = candidate
      if (i < 2) await delay(300)
    }
    return best
  }

  async function scanFrame (session) {
    if (session !== scanSession || !cameraStream) return
    if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
      setAutoStatus('カメラ映像の準備中です…')
      scheduleAutoScan(session, 800)
      return
    }

    try {
      const best = await findBestFrame(session)
      if (session !== scanSession || !cameraStream || !best) return
      console.log('OCR候補画像の鮮明さ:', best.score.toFixed(1))

      // 非常にぼやけているフレームは少し待つ。ただし誤判定に備えて
      // 2回の待機後はOCRを行い、完全にスキャン不能になるのを防ぐ。
      if (best.score < 12 && blurRetries < 2) {
        blurRetries++
        setAutoStatus(
          '文字がぼやけています。少し離して明るい場所で固定してください。'
        )
        scheduleAutoScan(session, 1500)
        return
      }
      blurRetries = 0

      const ocrFile = await canvasToOcrFile(best.ocrCanvas)
      if (session !== scanSession || !cameraStream) return
      showOcrDebugImage(ocrFile)
      setAutoStatus('鮮明な画像を選択しました。OCRサーバーで解析しています…')
      ocrStatus.textContent = '赤枠内を読み取り中です…'

      const controller = new AbortController()
      inFlightController = controller
      let result
      try {
        result = await requestOcr(ocrFile, { signal: controller.signal })
      } finally {
        if (inFlightController === controller) inFlightController = null
      }
      if (session !== scanSession || !cameraStream) return
      networkErrors = 0
      console.log('自動OCR結果:', result)

      if (result.expiry || result.expiry_month) {
        const decision = onAutoResult(result)
        if (decision === 'accepted') {
          onCapture(best.fullCanvas.toDataURL('image/jpeg', 0.85), ocrFile)
          stopCamera()
          return
        }
        if (decision === 'rejected') {
          stopCamera()
          return
        }
      }
      setAutoStatus(
        '賞味期限を認識できませんでした。位置を調整して自動で再試行します。'
      )
      ocrStatus.textContent = '認識できませんでした。次のフレームを試します。'
      scheduleAutoScan(session, 3500)
    } catch (error) {
      if (session !== scanSession || !cameraStream) return
      if (error.name === 'AbortError') return
      console.error('自動OCRエラー:', error)
      networkErrors++
      if (networkErrors >= 3) {
        stopCamera()

        setAutoStatus(
          '通信が3回連続で失敗しました。' +
            '通信環境を確認して、再度カメラを起動してください。'
        )

        return
      }
      setAutoStatus('通信に失敗しました。8秒後に再試行します。')
      scheduleAutoScan(session, 8000)
    }
  }

  async function updateCameraChoices () {
    if (!navigator.mediaDevices.enumerateDevices) return
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        device => device.kind === 'videoinput' && device.deviceId
      )
      cameraSelect.innerHTML = ''
      const auto = document.createElement('option')
      auto.value = ''
      auto.textContent = '自動（背面カメラ）'
      cameraSelect.appendChild(auto)
      devices.forEach((device, i) => {
        const option = document.createElement('option')
        option.value = device.deviceId
        option.textContent = device.label || `カメラ ${i + 1}`
        cameraSelect.appendChild(option)
      })
      cameraSelectRow.hidden = devices.length <= 1
      const active =
        cameraStream?.getVideoTracks()[0]?.getSettings()?.deviceId || ''
      cameraSelect.value = devices.some(d => d.deviceId === active)
        ? active
        : ''
      if (devices.length > 1) {
        console.log(
          '選べるカメラ:',
          devices.map(d => d.label || '(名前なし)')
        )
      }
    } catch (error) {
      console.warn('カメラ一覧の取得に失敗:', error)
      cameraSelectRow.hidden = true
    }
  }

  function stopCamera () {
    startupSession++
    cancelAutoScan()
    starting = false
    startCameraButton.disabled = false
    focusButton.hidden = true
    focusButton.disabled = true
    focusStatus.hidden = true
    zoomControl.hidden = true
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop())
      cameraStream = null
    }
    cameraVideo.srcObject = null
    cameraArea.hidden = true
    setAutoStatus('自動読み取りを停止しました。')
  }

  async function startCamera () {
    if (starting || cameraStream) return
    if (!navigator.mediaDevices?.getUserMedia) {
      ocrStatus.textContent =
        'このブラウザではカメラを利用できません。HTTPSで開いてください。'
      return
    }
    const myStartup = ++startupSession
    starting = true
    startCameraButton.disabled = true
    networkErrors = 0
    blurRetries = 0
    onCaptureStart()
    ocrButton.disabled = true
    setAutoStatus('カメラを準備中です…')
    focusButton.hidden = true
    focusStatus.hidden = true

    try {
      let stream = await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(selectedCameraId),
        audio: false
      })

      if (myStartup !== startupSession) {
        stream.getTracks().forEach(track => track.stop())
        return
      }

      // 自動選択の場合だけAF対応カメラを探す
      if (!selectedCameraId) {
        stream = await selectAutofocusCamera(stream, {
          isCurrent: () => myStartup === startupSession,
          setAutoStatus
        })
        if (!stream) return
      }

      if (myStartup !== startupSession) {
        stream.getTracks().forEach(track => track.stop())
        return
      }

      cameraStream = stream
      cameraVideo.srcObject = stream
      cameraArea.hidden = false
      try {
        await cameraVideo.play()
      } catch (error) {
        console.warn('自動再生の確認:', error)
      }
      if (myStartup !== startupSession) return

      const track = stream.getVideoTracks()[0]
      const settings = track?.getSettings?.() || {}
      const capabilities = track?.getCapabilities?.() || {}
      console.log('映像設定:', {
        width: settings.width,
        height: settings.height,
        focusMode: settings.focusMode
      })
      ocrStatus.textContent = `カメラ映像: ${settings.width || '?'}×${
        settings.height || '?'
      } / ピントは端末側の自動調整を使用`

      const focusModes = Array.isArray(capabilities.focusMode)
        ? capabilities.focusMode
        : []

      console.log('ピント対応モード:', focusModes)
      console.log('カメラの対応機能:', capabilities)

      // 連続オートフォーカスの設定
      let focusMessage = ''

      if (focusModes.includes('continuous')) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' }]
          })

          const appliedMode = track.getSettings().focusMode

          focusMessage =
            appliedMode === 'continuous'
              ? '連続AF：設定済み'
              : appliedMode
              ? `連続AF：要求済み（現在：${appliedMode}）`
              : '連続AF：要求済み（反映状態不明）'
        } catch (error) {
          console.warn('オートフォーカス設定エラー:', error)
          focusMessage = '連続AF：設定失敗'
        }
      } else {
        focusMessage = focusModes.length
          ? '連続AF：非対応'
          : 'AF対応情報を取得できません'
      }

      if (myStartup !== startupSession) return

      // 単発AFへの対応状況を確認
      const singleShotAvailable = focusModes.includes('single-shot')

      // 対応状況を画面に表示する
      focusStatus.hidden = false

      focusStatus.textContent = singleShotAvailable
        ? `${focusMessage}。ぼやける場合はピントボタンを押してください。`
        : `${focusMessage}。少し距離を離すか、別の背面カメラを試してください。`

      // 単発AF対応端末のみボタンを表示
      focusButton.hidden = !singleShotAvailable
      focusButton.disabled = !singleShotAvailable

      if (capabilities.zoom) {
        const zoom = capabilities.zoom
        const currentZoom = track.getSettings().zoom || zoom.min
        zoomSlider.min = zoom.min
        zoomSlider.max = zoom.max
        zoomSlider.step = zoom.step || 0.1
        zoomSlider.value = currentZoom
        zoomValue.textContent = currentZoom
        zoomControl.hidden = false
        zoomSlider.oninput = async () => {
          const value = Number(zoomSlider.value)
          zoomValue.textContent = value
          try {
            await track.applyConstraints({ advanced: [{ zoom: value }] })
          } catch (error) {
            console.warn('ズーム変更不可:', error)
          }
        }
      } else {
        zoomControl.hidden = true
      }

      await updateCameraChoices()
      if (myStartup !== startupSession) return

      // ZXingによるJANコード認識は並行実行する。完了を待つとOCR開始が遅れる。

      if (AUTO_OCR_ENABLED) {
        const session = ++scanSession
        setAutoStatus(
          '約4秒後に自動読み取りを開始します。文字を赤枠に合わせてください。'
        )
        scheduleAutoScan(session, 4000)
      } else {
        setAutoStatus('自動OCRは一時停止中です。手動で撮影してください。')
      }
    } catch (error) {
      if (myStartup !== startupSession) return
      console.error('カメラ起動エラー:', error)
      stopCamera()
      ocrStatus.textContent =
        'カメラを起動できませんでした。別のカメラを選ぶか、許可設定を確認してください。'
    } finally {
      if (myStartup === startupSession) {
        starting = false
        startCameraButton.disabled = !!cameraStream
      }
    }
  }

  startCameraButton.addEventListener('click', () => {
    void startCamera()
  })
  cameraSelect.addEventListener('change', () => {
    const newId = cameraSelect.value
    const active = !!cameraStream
    stopCamera()
    selectedCameraId = newId
    if (active) void startCamera()
  })

  focusButton.addEventListener('click', async () => {
    const track = cameraStream?.getVideoTracks()[0]

    if (!track || track.readyState !== 'live') return

    const modes = track.getCapabilities?.().focusMode || []

    if (!Array.isArray(modes) || !modes.includes('single-shot')) {
      focusStatus.textContent = 'このカメラでは単発AFを利用できません。'
      return
    }

    focusButton.disabled = true
    focusStatus.textContent = 'ピント合わせを要求しています…'

    try {
      // 必要に応じて連続AFへ戻す
      if (
        track.getSettings().focusMode === 'single-shot' &&
        modes.includes('continuous')
      ) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' }]
        })
      }

      // 単発AFを要求
      await track.applyConstraints({
        advanced: [{ focusMode: 'single-shot' }]
      })

      if (cameraStream?.getVideoTracks()[0] !== track) return

      const appliedMode = track.getSettings().focusMode

      focusStatus.textContent =
        appliedMode === 'single-shot'
          ? '単発AFを設定しました。文字が鮮明になったか確認してください。'
          : '単発AFを要求しました。反映状態は未確認です。'
    } catch (error) {
      console.warn('手動ピント合わせエラー:', error)

      if (cameraStream?.getVideoTracks()[0] === track) {
        focusStatus.textContent =
          'ピント合わせに失敗しました。距離やカメラを変えてください。'
      }
    } finally {
      if (
        cameraStream?.getVideoTracks()[0] === track &&
        track.readyState === 'live'
      ) {
        focusButton.disabled = false
      }
    }
  })

  captureButton.addEventListener('click', async () => {
    if (!cameraStream || !cameraVideo.videoWidth) {
      ocrStatus.textContent = 'カメラの準備ができていません。'
      return
    }
    cancelAutoScan()
    captureButton.disabled = true
    ocrButton.disabled = true
    onCaptureStart()
    try {
      const candidate = captureCandidate()
      if (!candidate) return
      const ocrFile = await canvasToOcrFile(candidate.ocrCanvas)
      if (!cameraStream) return
      showOcrDebugImage(ocrFile)
      onCapture(candidate.fullCanvas.toDataURL('image/jpeg', 0.9), ocrFile)
      ocrButton.disabled = false
      ocrStatus.textContent =
        '手動撮影しました。「画像から読み取る」で確認できます。'
    } catch (error) {
      console.error('手動撮影エラー:', error)
      ocrStatus.textContent = '撮影に失敗しました。'
    } finally {
      captureButton.disabled = false
      stopCamera()
    }
  })

  stopCameraButton.addEventListener('click', stopCamera)
  return { stop: stopCamera }
}
