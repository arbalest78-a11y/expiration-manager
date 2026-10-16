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

import { createBarcodeScanner } from './barcode.js'
import { requestOcr } from './ocr-api.js'

const expiryGuide = document.getElementById('expiryGuide')
const focusButton = document.getElementById('focusButton')
const focusStatus = document.getElementById('focusStatus')
const zoomControl = document.getElementById('zoomControl')
const zoomSlider = document.getElementById('zoomSlider')
const zoomValue = document.getElementById('zoomValue')
const autoScanStatus = document.getElementById('autoScanStatus')

let cameraStream = null
const barcodeScanner = createBarcodeScanner(cameraVideo, ocrStatus)

// =====================================
// ガイド枠の座標計算
// =====================================

function getGuideCropCoordinates (
  sourceWidth,
  sourceHeight,
  videoRect,
  guideRect
) {
  if (!sourceWidth || !sourceHeight || !videoRect.width || !videoRect.height) {
    throw new Error('カメラ映像のサイズを取得できません。')
  }

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

  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1
  }
}

// =====================================
// OCR用の切り抜き画像作成
// =====================================

function createGuideOcrFile (sourceCanvas, videoRect, guideRect) {
  return new Promise(function (resolve, reject) {
    try {
      const area = getGuideCropCoordinates(
        sourceCanvas.width,
        sourceCanvas.height,
        videoRect,
        guideRect
      )

      const outputCanvas = document.createElement('canvas')

      outputCanvas.width = Math.max(1, Math.round(area.width))
      outputCanvas.height = Math.max(1, Math.round(area.height))

      const context = outputCanvas.getContext('2d')

      context.drawImage(
        sourceCanvas,
        area.x,
        area.y,
        area.width,
        area.height,
        0,
        0,
        outputCanvas.width,
        outputCanvas.height
      )

      outputCanvas.toBlob(
        function (blob) {
          if (!blob) {
            reject(new Error('OCR用画像の切り抜きに失敗しました。'))
            return
          }

          resolve(new File([blob], 'expiry-guide.jpg', { type: 'image/jpeg' }))
        },
        'image/jpeg',
        0.95
      )
    } catch (error) {
      reject(error)
    }
  })
}

// =====================================
// カメラ機能の初期設定
// =====================================

export function setupCamera ({ onCaptureStart, onCapture, onAutoResult }) {
  // 自動OCR: サーバーに同時リクエストを送らない。停止時は結果を無視する。
  let scanSession = 0
  let scanTimer = null
  let networkErrors = 0

  function setAutoStatus (message) {
    autoScanStatus.textContent = message
  }

  function cancelAutoScan () {
    scanSession += 1
    if (scanTimer !== null) clearTimeout(scanTimer)
    scanTimer = null
  }

  function scheduleAutoScan (session, delayMs) {
    if (session !== scanSession || !cameraStream) return
    scanTimer = setTimeout(function () {
      scanTimer = null
      void scanFrame(session)
    }, delayMs)
  }

  function displayDebugFile (file) {
    let debugImage = document.getElementById('ocrDebugImage')
    if (!debugImage) {
      debugImage = document.createElement('img')
      debugImage.id = 'ocrDebugImage'
      debugImage.style.maxWidth = '300px'
      debugImage.style.width = '100%'
      debugImage.style.display = 'block'
      debugImage.style.marginTop = '10px'
      ocrStatus.after(debugImage)
    }
    // 再試行した画像の確認用。blob URLは読み込み後に解放する。
    const imageUrl = URL.createObjectURL(file)
    debugImage.onload = function () { URL.revokeObjectURL(imageUrl) }
    debugImage.onerror = function () { URL.revokeObjectURL(imageUrl) }
    debugImage.src = imageUrl
  }

  async function scanFrame (session) {
    if (session !== scanSession || !cameraStream) return
    if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
      setAutoStatus('映像を準備しています…')
      scheduleAutoScan(session, 700)
      return
    }

    try {
      // 画面の赤枠と同じ範囲だけを画像として送る。
      const videoRect = cameraVideo.getBoundingClientRect()
      const guideRect = expiryGuide.getBoundingClientRect()
      cameraCanvas.width = cameraVideo.videoWidth
      cameraCanvas.height = cameraVideo.videoHeight
      cameraCanvas.getContext('2d').drawImage(
        cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height
      )
      const ocrFile = await createGuideOcrFile(cameraCanvas, videoRect, guideRect)
      if (session !== scanSession || !cameraStream) return

      displayDebugFile(ocrFile)
      setAutoStatus('賞味期限を自動読み取り中…（通信中）')
      ocrStatus.textContent = 'カメラの赤枠内を読み取っています…'
      // RenderではOCRに約20秒かかる場合があるため必ず応答を待つ。
      const result = await requestOcr(ocrFile)
      if (session !== scanSession || !cameraStream) return
      networkErrors = 0
      console.log('自動OCR結果:', result)

      if (result.expiry || result.expiry_month) {
        const decision = onAutoResult(result)
        if (decision === 'accepted') {
          // 認識したフレームを商品写真としても残す（保存は利用者が行う）。
          const selectedImage = cameraCanvas.toDataURL('image/jpeg', 0.9)
          onCapture(selectedImage, ocrFile)
          stopCamera()
          return
        }
        if (decision === 'rejected') {
          // 同じ誤候補の確認画面が繰り返し出ないように停止する。
          stopCamera()
          return
        }
      }

      setAutoStatus('まだ認識できません。赤枠に合わせたままお待ちください。')
      ocrStatus.textContent = '賞味期限を検出できませんでした。自動的に再試行します。'
      scheduleAutoScan(session, 3500)
    } catch (error) {
      if (session !== scanSession || !cameraStream) return
      console.error('自動OCRエラー:', error)
      networkErrors += 1
      if (networkErrors >= 3) {
        setAutoStatus('自動読み取りを中断しました。カメラを再起動するか手動で撮影してください。')
        ocrStatus.textContent = 'OCRサーバーへの通信に繰り返し失敗しました。'
        return
      }
      setAutoStatus('通信に失敗しました。少し待ってから再試行します。')
      scheduleAutoScan(session, 8000)
    }
  }

  // ピント合わせ
  focusButton.addEventListener('click', async function () {
    const track = cameraStream?.getVideoTracks()[0]

    if (!track || track.readyState !== 'live') {
      focusStatus.textContent = 'カメラが起動していません。'
      return
    }

    const capabilities =
      typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}

    const modes = Array.isArray(capabilities.focusMode)
      ? capabilities.focusMode
      : []

    if (!modes.includes('single-shot')) {
      focusButton.disabled = true
      focusStatus.textContent =
        'この端末のブラウザは手動ピント合わせに対応していません。'
      return
    }

    focusButton.disabled = true
    focusStatus.textContent = 'ピント合わせを要求しています...'

    try {
      if (
        track.getSettings().focusMode === 'single-shot' &&
        modes.includes('continuous')
      ) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' }]
        })
      }

      await track.applyConstraints({
        advanced: [{ focusMode: 'single-shot' }]
      })

      const appliedMode = track.getSettings().focusMode

      if (appliedMode && appliedMode !== 'single-shot') {
        focusStatus.textContent =
          'ピント設定が適用されたことを確認できませんでした。'
      } else {
        focusStatus.textContent =
          'ピント合わせを要求しました。文字が鮮明になったか確認してください。'
      }
    } catch (error) {
      console.error('手動フォーカスエラー:', error)
      focusStatus.textContent =
        'ピント合わせに失敗しました。少し距離を離して試してください。'
    } finally {
      if (track.readyState === 'live') {
        focusButton.disabled = false
      }
    }
  })

  // =====================================
  // カメラ起動
  // =====================================

  startCameraButton.addEventListener('click', async function () {
    if (cameraStream || startCameraButton.disabled) return
    startCameraButton.disabled = true
    networkErrors = 0
    onCaptureStart()
    ocrButton.disabled = true
    setAutoStatus('カメラを準備しています…')
    focusButton.disabled = true
    focusStatus.textContent = ''

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: 'environment'
          }
        },
        audio: false
      })

      const videoTrack = cameraStream.getVideoTracks()[0]

      let focusModeText = '取得できません'
      let zoomModeText = '非対応'

      if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
        const capabilities = videoTrack.getCapabilities()

        console.log('カメラ capabilities:', capabilities)

        const focusModes = Array.isArray(capabilities.focusMode)
          ? capabilities.focusMode
          : []

        focusButton.disabled = !focusModes.includes('single-shot')

        if (focusButton.disabled) {
          focusStatus.textContent =
            '手動ピント合わせ非対応（自動フォーカスは利用できる場合があります）。'
        } else {
          focusStatus.textContent =
            '文字がぼやけていたら「ピントを合わせる」を押してください。'
        }

        // 連続オートフォーカス
        if (
          Array.isArray(capabilities.focusMode) &&
          capabilities.focusMode.includes('continuous')
        ) {
          await videoTrack.applyConstraints({
            advanced: [{ focusMode: 'continuous' }]
          })

          const settings = videoTrack.getSettings()

          console.log('カメラ settings:', settings)

          focusModeText = settings.focusMode || '取得できません'
        } else {
          focusModeText = 'continuous 非対応'
        }

        // =====================================
        // ズーム設定
        // =====================================

        if (capabilities.zoom) {
          const zoom = capabilities.zoom
          const settings = videoTrack.getSettings()

          zoomModeText = zoom.min + ' ～ ' + zoom.max

          zoomSlider.min = zoom.min
          zoomSlider.max = zoom.max
          zoomSlider.step = zoom.step || 0.1
          zoomSlider.value = settings.zoom || zoom.min

          zoomValue.textContent = zoomSlider.value
          zoomControl.hidden = false

          zoomSlider.oninput = async function () {
            const value = Number(zoomSlider.value)

            zoomValue.textContent = value

            try {
              await videoTrack.applyConstraints({
                advanced: [{ zoom: value }]
              })
            } catch (error) {
              console.error('ズーム変更エラー:', error)
            }
          }

          console.log('ズーム capabilities:', zoom)
        } else {
          zoomControl.hidden = true
        }
      }

      if (focusStatus.textContent === '') {
        focusStatus.textContent = '手動ピント合わせの対応状況を確認できません。'
      }

      cameraVideo.srcObject = cameraStream
      cameraArea.hidden = false

      ocrStatus.textContent =
        'フォーカス: ' + focusModeText + ' / ズーム: ' + zoomModeText

      // JANコード読み取り開始。OCRとは別に継続して読み取る。
      await barcodeScanner.start(cameraStream)

      // 撮影ボタン不要。カメラのライブ映像から自動OCRを始める。
      const session = ++scanSession
      setAutoStatus('自動読み取りを開始しました。赤枠に文字を合わせてください。')
      scheduleAutoScan(session, 2500)
    } catch (error) {
      console.error(error)
      stopCamera()
      ocrStatus.textContent = 'カメラを起動できませんでした。'
    }
  })

  // =====================================
  // 撮影処理
  // =====================================

  captureButton.addEventListener('click', async function () {
    cancelAutoScan()
    setAutoStatus('手動撮影に切り替えました。')
    if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
      ocrStatus.textContent =
        'カメラの準備ができていません。少し待ってから撮影してください。'
      return
    }

    captureButton.disabled = true
    ocrButton.disabled = true

    onCaptureStart()

    ocrStatus.textContent = '撮影画像を準備しています...'

    try {
      const videoRect = cameraVideo.getBoundingClientRect()
      const guideRect = expiryGuide.getBoundingClientRect()

      cameraCanvas.width = cameraVideo.videoWidth
      cameraCanvas.height = cameraVideo.videoHeight

      const context = cameraCanvas.getContext('2d')

      context.drawImage(
        cameraVideo,
        0,
        0,
        cameraCanvas.width,
        cameraCanvas.height
      )

      // 商品保存用の画像
      const selectedImage = cameraCanvas.toDataURL('image/jpeg', 0.9)

      // OCR用の切り抜き画像
      const ocrFile = await createGuideOcrFile(
        cameraCanvas,
        videoRect,
        guideRect
      )

      // OCRへ送信する画像を確認する（デバッグ用）
      let debugImage = document.getElementById('ocrDebugImage')

      if (!debugImage) {
        debugImage = document.createElement('img')
        debugImage.id = 'ocrDebugImage'
        debugImage.style.maxWidth = '300px'
        debugImage.style.width = '100%'
        debugImage.style.display = 'block'
        debugImage.style.marginTop = '10px'
        ocrStatus.after(debugImage)
      }

      const reader = new FileReader()

      reader.onload = function () {
        debugImage.src = reader.result
      }

      reader.readAsDataURL(ocrFile)

      // script.jsへ撮影結果を渡す
      onCapture(selectedImage, ocrFile)

      ocrButton.disabled = false
      ocrStatus.textContent = '撮影しました。赤い枠内の賞味期限を読み取れます。'
    } catch (error) {
      console.error('ガイド枠の切り抜きエラー:', error)
      ocrStatus.textContent =
        '撮影画像の準備に失敗しました。もう一度撮影してください。'
    } finally {
      captureButton.disabled = false
      stopCamera()
    }
  })

  // カメラを閉じる
  stopCameraButton.addEventListener('click', function () {
    stopCamera()
  })

  // =====================================
  // カメラ停止
  // =====================================

  function stopCamera () {
    cancelAutoScan()
    startCameraButton.disabled = false
    setAutoStatus('自動読み取りを停止しました。')
    focusButton.disabled = true
    focusStatus.textContent = ''

    barcodeScanner.stop()

    if (cameraStream) {
      cameraStream.getTracks().forEach(function (track) {
        track.stop()
      })

      cameraStream = null
    }

    cameraVideo.srcObject = null
    cameraArea.hidden = true
  }

  return { stop: stopCamera }
}
