import { loadItems, saveItems, exportItems, importItems } from './storage.js'

import { filterAndSortItems } from './filter.js'

import { getSummaryCounts } from './summary.js'

import { createItemCard } from './card.js'

import {
  showImagePreview,
  clearImagePreview,
  openRegistrationForm,
  openEditFormUI,
  closeForm
} from './form.js'

import { requestOcr } from './ocr-api.js'

import {
  addButton,
  cancelButton,
  itemForm,
  itemList,
  displayCount,
  itemName,
  expiryDate,
  quantity,
  storage,
  memo,
  itemImage,
  removeImageButton,
  ocrButton,
  ocrStatus,
  startCameraButton,
  cameraArea,
  cameraVideo,
  captureButton,
  stopCameraButton,
  cameraCanvas,
  searchInput,
  sortSelect,
  storageFilter,
  clearFilterButton,
  expiredCount,
  dangerCount,
  warningCount,
  safeCount,
  summaryBoxes,
  exportButton,
  importButton,
  importFile
} from './dom.js'

import { readExpiryDate } from './ocr.js'

const expiryGuide = document.getElementById('expiryGuide')

const zoomControl = document.getElementById('zoomControl')
const zoomSlider = document.getElementById('zoomSlider')
const zoomValue = document.getElementById('zoomValue')

// =========================
// データ
// =========================

// 保存されている商品を読み込む
let items = loadItems()
let editingId = null
let selectedImage = ''
let expiryFilter = 'all'

let cameraStream = null
let ocrFile = null

let barcodeControls = null
let detectedJan = ''

const janCodeReader = new ZXingBrowser.BrowserMultiFormatOneDReader()

// =========================
// 初期表示
// =========================

renderItems()
updateSummary()

// =========================
// イベント
// =========================

// 商品名検索
searchInput.addEventListener('input', function () {
  renderItems()
})

// 並び替え
sortSelect.addEventListener('change', function () {
  renderItems()
})

// 収納場所で絞り込み
storageFilter.addEventListener('change', function () {
  renderItems()
})

// 絞り込みをすべて解除
clearFilterButton.addEventListener('click', function () {
  searchInput.value = ''
  storageFilter.value = 'all'
  expiryFilter = 'all'

  updateSummarySelection()
  renderItems()
})

// 賞味期限サマリーで絞り込み
summaryBoxes.forEach(function (box) {
  box.addEventListener('click', function () {
    const selectedFilter = box.dataset.expiryFilter

    // 同じものをもう一度押したら解除
    if (expiryFilter === selectedFilter) {
      expiryFilter = 'all'
    } else {
      expiryFilter = selectedFilter
    }

    updateSummarySelection()
    renderItems()
  })
})

// 商品写真を読み込む
itemImage.addEventListener('change', function () {
  const file = itemImage.files[0]

  if (!file) {
    ocrFile = null
    ocrButton.disabled = true
    return
  }

  // 端末の写真を選んだ場合は、その画像全体をOCRに送る
  ocrFile = file

  const reader = new FileReader()

  reader.addEventListener('load', function () {
    selectedImage = reader.result

    showImagePreview(selectedImage)

    // 写真を選択したらOCRボタンを使えるようにする
    ocrButton.disabled = false
    ocrStatus.textContent = ''
  })

  reader.readAsDataURL(file)
})

// =========================
// カメラの赤いガイド枠をOCR用の画像範囲に変換
// =========================

// カメラ映像は object-fit: cover で一部が画面からはみ出す。
// ガイド枠の画面上の位置を、撮影した元画像のピクセル座標に変換する。
function getGuideCropCoordinates (sourceWidth, sourceHeight, videoRect, guideRect) {
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
  const x2 = Math.min(sourceWidth, (guideRect.right - videoRect.left + hiddenX) / scale)
  const y2 = Math.min(sourceHeight, (guideRect.bottom - videoRect.top + hiddenY) / scale)

  if (x2 <= x1 || y2 <= y1) {
    throw new Error('ガイド枠の切り抜き範囲を計算できません。')
  }

  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

// 撮影画像のうち赤いガイド枠に重なっていた範囲だけをJPEGにする
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
        area.x, area.y, area.width, area.height,
        0, 0, outputCanvas.width, outputCanvas.height
      )

      outputCanvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error('OCR用画像の切り抜きに失敗しました。'))
          return
        }
        resolve(new File([blob], 'expiry-guide.jpg', { type: 'image/jpeg' }))
      }, 'image/jpeg', 0.95)
    } catch (error) {
      reject(error)
    }
  })
}

async function startJanScan () {
  if (!cameraStream) {
    return
  }

  detectedJan = ''

  try {
    barcodeControls = await janCodeReader.decodeFromStream(
      cameraStream,
      cameraVideo,
      function (result) {
        if (!result) {
          return
        }

        const code = result.getText()

        // JANコードは主に8桁または13桁
        if (!/^(?:\d{8}|\d{13})$/.test(code)) {
          return
        }

        // 同じコードを何度も処理しない
        if (detectedJan === code) {
          return
        }

        detectedJan = code

        console.log('JANコードを読み取りました:', detectedJan)

        // ocrStatus.textContent = 'JANコードを読み取りました：' + detectedJan
      }
    )
  } catch (error) {
    console.error('JANコード読み取りエラー:', error)

    ocrStatus.textContent = 'JANコードの読み取りを開始できませんでした。'
  }
}

// =========================
// カメラ
// =========================

// カメラを起動
startCameraButton.addEventListener('click', async function () {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: {
          ideal: 'environment'
        }
      },
      audio: false
    })

    // 使用中のカメラトラックを取得
    const videoTrack = cameraStream.getVideoTracks()[0]

    let focusModeText = '取得できません'
    let zoomModeText = '非対応'

    if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
      const capabilities = videoTrack.getCapabilities()

      console.log('カメラ capabilities:', capabilities)

      // 連続オートフォーカス確認
      if (
        Array.isArray(capabilities.focusMode) &&
        capabilities.focusMode.includes('continuous')
      ) {
        await videoTrack.applyConstraints({
          advanced: [
            {
              focusMode: 'continuous'
            }
          ]
        })

        const settings = videoTrack.getSettings()

        console.log('カメラ settings:', settings)

        focusModeText = settings.focusMode || '取得できません'
      } else {
        focusModeText = 'continuous 非対応'
      }

      // ズーム対応確認
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
                {
                  zoom: value
                }
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

    cameraVideo.srcObject = cameraStream
    cameraArea.hidden = false

    ocrStatus.textContent =
      'フォーカス: ' + focusModeText + ' / ズーム: ' + zoomModeText

    await startJanScan()
  } catch (error) {
    console.error(error)

    ocrStatus.textContent = 'カメラを起動できませんでした。'
  }
})

// 撮影：商品写真は全体を保存し、OCRにはガイド枠内だけを送る
captureButton.addEventListener('click', async function () {
  if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    ocrStatus.textContent = 'カメラの準備ができていません。少し待ってから撮影してください。'
    return
  }

  captureButton.disabled = true
  ocrButton.disabled = true
  ocrFile = null
  ocrStatus.textContent = '撮影画像を準備しています...'

  try {
    // カメラを閉じる前に、画面上の映像とガイド枠の位置を記録する
    const videoRect = cameraVideo.getBoundingClientRect()
    const guideRect = expiryGuide.getBoundingClientRect()

    cameraCanvas.width = cameraVideo.videoWidth
    cameraCanvas.height = cameraVideo.videoHeight
    const context = cameraCanvas.getContext('2d')
    context.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height)

    // 商品用の写真は従来どおり全体をプレビュー・保存する
    selectedImage = cameraCanvas.toDataURL('image/jpeg', 0.9)
    showImagePreview(selectedImage)

    // OCRに送るのは赤いガイド枠内を自動で切り抜いた画像
    ocrFile = await createGuideOcrFile(cameraCanvas, videoRect, guideRect)
    ocrButton.disabled = false
    ocrStatus.textContent = '撮影しました。赤い枠内の賞味期限を読み取れます。'
  } catch (error) {
    console.error('ガイド枠の切り抜きエラー:', error)
    ocrStatus.textContent = '撮影画像の準備に失敗しました。もう一度撮影してください。'
  } finally {
    captureButton.disabled = false
    stopCamera()
  }
})

// カメラを閉じる
stopCameraButton.addEventListener('click', function () {
  stopCamera()
})

// カメラ停止
function stopCamera () {
  if (barcodeControls) {
    barcodeControls.stop()
    barcodeControls = null
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach(function (track) {
      track.stop()
    })

    cameraStream = null
  }

  cameraVideo.srcObject = null
  cameraArea.hidden = true
}

// OCRボタン
ocrButton.addEventListener('click', async function (event) {
  event.preventDefault()

  console.log('OCRボタンが押されました')

  const file = ocrFile

  if (!file) {
    ocrStatus.textContent = '画像を選択してください。'
    return
  }

  ocrButton.disabled = true
  ocrStatus.textContent = '画像を読み取っています...'

  try {
    const result = await requestOcr(file)

    console.log('Python OCR結果:', result)

    if (result.name) {
      itemName.value = result.name
    }

    if (result.expiry) {
      expiryDate.value = result.expiry
    }

    ocrStatus.textContent = '画像の読み取りが完了しました。'
  } catch (error) {
    console.error(error)

    ocrStatus.textContent = '画像の読み取りに失敗しました。'
  } finally {
    ocrButton.disabled = false
  }
})

// 選択・登録済みの写真を削除
removeImageButton.addEventListener('click', function () {
  selectedImage = ''
  ocrFile = null
  itemImage.value = ''

  clearImagePreview()

  ocrButton.disabled = true
  ocrStatus.textContent = ''
})

// 商品登録フォームを表示
addButton.addEventListener('click', function () {
  editingId = null
  selectedImage = ''
  ocrFile = null

  ocrButton.disabled = true
  ocrStatus.textContent = ''

  openRegistrationForm()
})

// キャンセル
cancelButton.addEventListener('click', function () {
  editingId = null
  selectedImage = ''
  ocrFile = null

  ocrButton.disabled = true
  ocrStatus.textContent = ''

  closeForm()
})

// 保存
itemForm.addEventListener('submit', function (event) {
  event.preventDefault()

  console.log('フォーム送信が発生しました', event.submitter)

  if (editingId === null) {
    const item = {
      id: Date.now(),
      name: itemName.value,
      expiry: expiryDate.value,
      quantity: quantity.value,
      storage: storage.value,
      memo: memo.value,
      image: selectedImage
    }

    items.push(item)
  } else {
    const item = items.find(function (savedItem) {
      return savedItem.id === editingId
    })

    if (item) {
      item.name = itemName.value
      item.expiry = expiryDate.value
      item.quantity = quantity.value
      item.storage = storage.value
      item.memo = memo.value
      item.image = selectedImage
    }
  }

  saveItems(items)
  renderItems()
  updateSummary()

  editingId = null
  selectedImage = ''
  ocrFile = null

  closeForm()
})

// 商品一覧を表示
function renderItems () {
  itemList.innerHTML = ''

  const filteredItems = filterAndSortItems(
    items,
    searchInput.value,
    storageFilter.value,
    expiryFilter,
    sortSelect.value
  )

  displayCount.textContent = '表示件数：' + filteredItems.length + '件'

  if (filteredItems.length === 0) {
    const message = document.createElement('p')
    message.textContent = '該当する商品がありません'
    itemList.appendChild(message)
    return
  }

  filteredItems.forEach(function (item) {
    const card = createItemCard(item, openEditForm, deleteItem)

    itemList.appendChild(card)
  })
}

// 賞味期限の件数を表示
function updateSummary () {
  const counts = getSummaryCounts(items)

  expiredCount.textContent = counts.expired
  dangerCount.textContent = counts.danger
  warningCount.textContent = counts.warning
  safeCount.textContent = counts.safe
}

// バックアップデータを書き出す
exportButton.addEventListener('click', function () {
  exportItems(items)
})

// バックアップデータを選択
importButton.addEventListener('click', function () {
  importFile.click()
})

// バックアップデータを読み込む
importFile.addEventListener('change', async function () {
  const file = importFile.files[0]

  if (!file) {
    return
  }

  try {
    const importedItems = await importItems(file)

    const result = confirm(
      '現在の商品データを、読み込んだバックアップデータで置き換えますか？'
    )

    if (!result) {
      return
    }

    items = importedItems

    saveItems(items)

    renderItems()
    updateSummary()

    alert('バックアップデータを読み込みました。')
  } catch (error) {
    console.error(error)

    alert('バックアップデータの読み込みに失敗しました。')
  } finally {
    importFile.value = ''
  }
})

// =========================
// 商品カード
// =========================

function openEditForm (item) {
  editingId = item.id
  selectedImage = item.image || ''
  ocrFile = null

  openEditFormUI(item)
}

function deleteItem (item) {
  const result = confirm('この商品を削除しますか？')

  if (result) {
    items = items.filter(function (savedItem) {
      return savedItem.id !== item.id
    })

    saveItems(items)
    renderItems()
    updateSummary()
  }
}

// 選択中のサマリーを表示
function updateSummarySelection () {
  summaryBoxes.forEach(function (box) {
    if (box.dataset.expiryFilter === expiryFilter) {
      box.classList.add('active')
    } else {
      box.classList.remove('active')
    }
  })
}
