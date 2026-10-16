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

  openRegistrationForm()
})

// キャンセル
cancelButton.addEventListener('click', function () {
  cameraController.stop()
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
  cameraController.stop()

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
