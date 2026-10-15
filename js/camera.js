
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

const expiryGuide = document.getElementById('expiryGuide')
const focusButton = document.getElementById('focusButton')
const focusStatus = document.getElementById('focusStatus')
const zoomControl = document.getElementById('zoomControl')
const zoomSlider = document.getElementById('zoomSlider')
const zoomValue = document.getElementById('zoomValue')

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

  const x1 = Math.max(
    0,
    (guideRect.left - videoRect.left + hiddenX) / scale
  )
  const y1 = Math.max(
    0,
    (guideRect.top - videoRect.top + hiddenY) / scale
  )
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

          resolve(
            new File(
              [blob],
              'expiry-guide.jpg',
              { type: 'image/jpeg' }
            )
          )
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

export function setupCamera ({ onCaptureStart, onCapture }) {

  // ピント合わせ
  focusButton.addEventListener('click', async function () {
    const track = cameraStream?.getVideoTracks()[0]

    if (!track || track.readyState !== 'live') {
      focusStatus.textContent = 'カメラが起動していません。'
      return
    }

    const capabilities =
      typeof track.getCapabilities === 'function'
        ? track.getCapabilities()
        : {}

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

      if (
        videoTrack &&
        typeof videoTrack.getCapabilities === 'function'
      ) {
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
            advanced: [
              { focusMode: 'continuous' }
            ]
          })

          const settings = videoTrack.getSettings()

          console.log('カメラ settings:', settings)

          focusModeText =
            settings.focusMode || '取得できません'
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
                advanced: [
                  { zoom: value }
                ]
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
        focusStatus.textContent =
          '手動ピント合わせの対応状況を確認できません。'
      }

      cameraVideo.srcObject = cameraStream
      cameraArea.hidden = false

      ocrStatus.textContent =
        'フォーカス: ' + focusModeText +
        ' / ズーム: ' + zoomModeText

      // JANコード読み取り開始
      await barcodeScanner.start(cameraStream)

    } catch (error) {
      console.error(error)
      ocrStatus.textContent = 'カメラを起動できませんでした。'
    }
  })

  // =====================================
  // 撮影処理
  // =====================================

  captureButton.addEventListener('click', async function () {
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
      const selectedImage = cameraCanvas.toDataURL(
        'image/jpeg',
        0.9
      )

      // OCR用の切り抜き画像
      const ocrFile = await createGuideOcrFile(
        cameraCanvas,
        videoRect,
        guideRect
      )

      // script.jsへ撮影結果を渡す
      onCapture(selectedImage, ocrFile)

      ocrButton.disabled = false
      ocrStatus.textContent =
        '撮影しました。赤い枠内の賞味期限を読み取れます。'

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
}
