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

import { setupCamera } from './camera.js'
import { setupOcr } from './ocr-handler.js'

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

// JANコード検索APIの接続先
const PRODUCT_API_BASE_URL =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:5000'
    : 'https://YOUR-RENDER-SERVICE.onrender.com'

// JANコード検索用のHTML要素
const janCodeInput = document.getElementById('janCode')
const lookupJanButton = document.getElementById('lookupJanButton')
const janSearchStatus = document.getElementById('janSearchStatus')

// =========================
// データ
// =========================

// 保存されている商品を読み込む
let items = loadItems()
let editingId = null
let selectedImage = ''
let expiryFilter = 'all'

let ocrFile = null

// =========================
// 初期表示
// =========================

renderItems()
updateSummary()

const ocrController = setupOcr({
  getOcrFile: function () {
    return ocrFile
  }
})

const cameraController = setupCamera({
  onCaptureStart: function () {
    ocrFile = null
  },

  onCapture: function (imageData, croppedFile) {
    selectedImage = imageData
    showImagePreview(selectedImage)

    ocrFile = croppedFile
    ocrButton.disabled = false
  },

  onAutoResult: ocrController.handleAutomaticResult
})

// =========================
// イベント
// =========================

// =========================
// JANコードから商品情報を取得
// =========================

let janLookupAbortController = null

function cancelJanLookup () {
  if (janLookupAbortController) {
    janLookupAbortController.abort()
    janLookupAbortController = null
  }
  lookupJanButton.disabled = false
}

lookupJanButton.addEventListener('click', async function () {
  const janCode = janCodeInput.value.trim()

  // JANコードの入力チェック
  if (!/^(?:\d{8}|\d{13})$/.test(janCode)) {
    janSearchStatus.textContent =
      'JANコードは半角数字の8桁または13桁で入力してください。'
    return
  }

  if (PRODUCT_API_BASE_URL.includes('YOUR-RENDER-SERVICE')) {
    janSearchStatus.textContent = 'RenderのURLを設定してください。'
    return
  }

  cancelJanLookup()

  const controller = new AbortController()
  janLookupAbortController = controller

  lookupJanButton.disabled = true
  janSearchStatus.textContent = '商品情報を検索しています…'

  try {
    const response = await fetch(
      `${PRODUCT_API_BASE_URL}/product/${encodeURIComponent(janCode)}`,
      { signal: controller.signal }
    )

    const result = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        result.error ||
          `商品情報を取得できませんでした（HTTP ${response.status}）。`
      )
    }

    // 検索中にフォームを閉じたり、JANコードが変わった場合
    if (controller.signal.aborted || janCodeInput.value.trim() !== janCode) {
      return
    }

    const productName = (result.name || '').trim()

    if (!productName) {
      janSearchStatus.textContent =
        '商品名が登録されていません。手動で入力してください。'
      return
    }

    // 入力済みの商品名を上書きする場合は確認する
    if (
      itemName.value.trim() &&
      itemName.value.trim() !== productName &&
      !confirm('入力済みの商品名を変更しますか？')
    ) {
      janSearchStatus.textContent = '商品名は変更せず、そのまま残しました。'
      return
    }

    // 商品名を入力欄へ反映
    itemName.value = productName

    janSearchStatus.textContent = `商品名「${productName}」を入力しました。`
  } catch (error) {
    if (error.name !== 'AbortError') {
      janSearchStatus.textContent = `商品検索に失敗しました：${error.message}`
    }
  } finally {
    if (janLookupAbortController === controller) {
      janLookupAbortController = null
      lookupJanButton.disabled = false
    }
  }
})

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
  cameraController.stop()

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
  cameraController.stop()
  editingId = null
  selectedImage = ''
  ocrFile = null

  ocrButton.disabled = true
  ocrStatus.textContent = ''

  cancelJanLookup()
  openRegistrationForm()

  janCodeInput.value = ''
  janSearchStatus.textContent = ''
})

// キャンセル
cancelButton.addEventListener('click', function () {
  cameraController.stop()
  editingId = null
  selectedImage = ''
  ocrFile = null

  ocrButton.disabled = true
  ocrStatus.textContent = ''

  cancelJanLookup()
  janCodeInput.value = ''
  janSearchStatus.textContent = ''

  closeForm()
})

// 保存
itemForm.addEventListener('submit', function (event) {
  event.preventDefault()
  cameraController.stop()

  console.log('フォーム送信が発生しました', event.submitter)

  if (editingId === null) {
    const item = {
      id: Date.now(),
      name: itemName.value,
      jan_code: janCodeInput.value.trim(),
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
      item.jan_code = janCodeInput.value.trim()
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

  cancelJanLookup()
  janCodeInput.value = ''
  janSearchStatus.textContent = ''

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

  cancelJanLookup()
  openEditFormUI(item)

  janCodeInput.value = item.jan_code || ''
  janSearchStatus.textContent = ''
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
