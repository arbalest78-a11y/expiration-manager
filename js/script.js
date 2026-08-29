import {
  loadItems,
  saveItems
} from "./storage.js";

import {
  filterAndSortItems
} from "./filter.js";

import {
  getSummaryCounts
} from "./summary.js";

import {
  createItemCard
} from "./card.js";

import {
  showImagePreview,
  clearImagePreview,
  openRegistrationForm,
  openEditFormUI,
  closeForm
} from "./form.js";

import {
  readExpiryDate
} from "./ocr.js";

import {
  addButton,
  cancelButton,
  itemForm,
  itemList,
  itemName,
  expiryDate,
  expiryImage,
  readExpiryButton,
  ocrStatus,
  quantity,
  storage,
  memo,
  itemImage,
  removeImageButton,
  searchInput,
  sortSelect,
  storageFilter,
  expiredCount,
  dangerCount,
  warningCount,
  safeCount,
  summaryBoxes
} from "./dom.js";

// =========================
// データ
// =========================

// 保存されている商品を読み込む
let items = loadItems();
let editingId = null;
let selectedImage = "";
let expiryFilter = "all";

// =========================
// 初期表示
// =========================

renderItems();
updateSummary();

// =========================
// イベント
// =========================

// 商品名検索
searchInput.addEventListener("input", function () {
  renderItems();
});

// 並び替え
sortSelect.addEventListener("change", function () {
  renderItems();
});

// 収納場所で絞り込み
storageFilter.addEventListener("change", function () {
  renderItems();
});

// 賞味期限サマリーで絞り込み
summaryBoxes.forEach(function (box) {
  box.addEventListener("click", function () {

    const selectedFilter = box.dataset.expiryFilter;

    // 同じものをもう一度押したら解除
    if (expiryFilter === selectedFilter) {
      expiryFilter = "all";
    } else {
      expiryFilter = selectedFilter;
    }

    updateSummarySelection();
    renderItems();
  });
});

// 商品写真を読み込む
itemImage.addEventListener("change", function () {
  const file = itemImage.files[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.addEventListener("load", function () {
    selectedImage = reader.result;

    showImagePreview(selectedImage);
  });

  reader.readAsDataURL(file);
});

// 選択・登録済みの写真を削除
removeImageButton.addEventListener("click", function () {
  selectedImage = "";

  clearImagePreview();
});

// 商品登録フォームを表示
addButton.addEventListener("click", function () {
  editingId = null;
  selectedImage = "";

  openRegistrationForm();
});

// キャンセル
cancelButton.addEventListener("click", function () {
  editingId = null;
  selectedImage = "";

  closeForm();
});

// 写真から賞味期限を読み取る
readExpiryButton.addEventListener("click", async function () {
  const file = expiryImage.files[0];

  if (!file) {
    ocrStatus.textContent = "賞味期限の写真を撮影してください";
    return;
  }

  readExpiryButton.disabled = true;
  ocrStatus.textContent = "読み取り中...";

  try {
    const result = await readExpiryDate(file, function (message) {
      if (
        message.status === "recognizing text" &&
        typeof message.progress === "number"
      ) {
        const percent = Math.round(message.progress * 100);
        ocrStatus.textContent = "読み取り中... " + percent + "%";
      }
    });

    if (result.date) {
      expiryDate.value = result.date;
      ocrStatus.textContent =
        "賞味期限を読み取りました：" + result.date;
    } else {
      ocrStatus.textContent =
        "賞味期限を読み取れませんでした。日付を手動で入力してください。";
    }
  } catch (error) {
    console.error(error);

    ocrStatus.textContent =
      "読み取り中にエラーが発生しました。";
  } finally {
    readExpiryButton.disabled = false;
  }
});

// 保存
itemForm.addEventListener("submit", function (event) {
  event.preventDefault();

  if (editingId === null) {
    const item = {
      id: Date.now(),
      name: itemName.value,
      expiry: expiryDate.value,
      quantity: quantity.value,
      storage: storage.value,
      memo: memo.value,
      image: selectedImage
    };

    items.push(item);
  } else {
    const item = items.find(function (savedItem) {
      return savedItem.id === editingId;
    });

    if (item) {
      item.name = itemName.value;
      item.expiry = expiryDate.value;
      item.quantity = quantity.value;
      item.storage = storage.value;
      item.memo = memo.value;
      item.image = selectedImage;
    }
  }

  saveItems(items);
  renderItems();
  updateSummary();

  editingId = null;
  selectedImage = "";

  closeForm();
});

// 商品一覧を表示
function renderItems() {
  itemList.innerHTML = "";

  const filteredItems = filterAndSortItems(
    items,
    searchInput.value,
    storageFilter.value,
    expiryFilter,
    sortSelect.value
  );

  if (filteredItems.length === 0) {
    const message = document.createElement("p");
    message.textContent = "該当する商品がありません";
    itemList.appendChild(message);
    return;
  }

  filteredItems.forEach(function (item) {
    const card = createItemCard(
      item,
      openEditForm,
      deleteItem
    );

    itemList.appendChild(card);
  });
}

// 賞味期限の件数を表示
function updateSummary() {
  const counts = getSummaryCounts(items);

  expiredCount.textContent = counts.expired;
  dangerCount.textContent = counts.danger;
  warningCount.textContent = counts.warning;
  safeCount.textContent = counts.safe;
}

// =========================
// 商品カード
// =========================

function openEditForm(item) {
  editingId = item.id;
  selectedImage = item.image || "";

  openEditFormUI(item);
}

function deleteItem(item) {
  const result = confirm("この商品を削除しますか？");

  if (result) {
    items = items.filter(function (savedItem) {
      return savedItem.id !== item.id;
    });

    saveItems(items);
    renderItems();
    updateSummary();
  }
}

// 選択中のサマリーを表示
function updateSummarySelection() {

  summaryBoxes.forEach(function (box) {

    if (box.dataset.expiryFilter === expiryFilter) {
      box.classList.add("active");
    } else {
      box.classList.remove("active");
    }

  });
}