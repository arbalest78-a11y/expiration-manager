import {
  loadItems,
  saveItems,
  exportItems,
  importItems
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
  requestOcr
} from "./ocr-api.js";

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
} from "./dom.js";

import {
  readExpiryDate
} from "./ocr.js";

// =========================
// データ
// =========================

// 保存されている商品を読み込む
let items = loadItems();
let editingId = null;
let selectedImage = "";
let expiryFilter = "all";

let cameraStream = null;
let ocrFile = null;

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

// 絞り込みをすべて解除
clearFilterButton.addEventListener("click", function () {
  searchInput.value = "";
  storageFilter.value = "all";
  expiryFilter = "all";

  updateSummarySelection();
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
    ocrButton.disabled = true;
    return;
  }

  ocrFile = file;

  const reader = new FileReader();

  reader.addEventListener("load", function () {
    selectedImage = reader.result;
    showImagePreview(selectedImage);

    // 写真を選択したらOCRボタンを使えるようにする
    ocrButton.disabled = false;
    ocrStatus.textContent = "";
  });

  reader.readAsDataURL(file);
});

// =========================
// カメラ
// =========================

// カメラを起動
startCameraButton.addEventListener(
  "click",
  async function () {
    try {
      cameraStream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: {
              ideal: "environment"
            }
          },
          audio: false
        });

      cameraVideo.srcObject = cameraStream;
      cameraArea.hidden = false;

      ocrStatus.textContent =
        "賞味期限をカメラに映してください。";

    } catch (error) {
      console.error(error);

      ocrStatus.textContent =
        "カメラを起動できませんでした。";
    }
  }
);


// 撮影
captureButton.addEventListener(
  "click",
  function () {
    const context =
      cameraCanvas.getContext("2d");

    cameraCanvas.width =
      cameraVideo.videoWidth;

    cameraCanvas.height =
      cameraVideo.videoHeight;

    context.drawImage(
      cameraVideo,
      0,
      0,
      cameraCanvas.width,
      cameraCanvas.height
    );

    selectedImage =
      cameraCanvas.toDataURL("image/jpeg");

    showImagePreview(selectedImage);

    cameraCanvas.toBlob(
      function (blob) {
        if (!blob) {
          return;
        }

        ocrFile = new File(
          [blob],
          "camera.jpg", {
            type: "image/jpeg"
          }
        );

        ocrButton.disabled = false;

        ocrStatus.textContent =
          "撮影しました。画像から読み取れます。";
      },
      "image/jpeg",
      0.9
    );

    stopCamera();
  }
);


// カメラを閉じる
stopCameraButton.addEventListener(
  "click",
  function () {
    stopCamera();
  }
);


// カメラ停止
function stopCamera() {
  if (cameraStream) {
    cameraStream
      .getTracks()
      .forEach(function (track) {
        track.stop();
      });

    cameraStream = null;
  }

  cameraVideo.srcObject = null;
  cameraArea.hidden = true;
}

// OCRボタン
ocrButton.addEventListener("click", async function () {
  const file = ocrFile;

  if (!file) {
    ocrStatus.textContent = "画像を選択してください。";
    return;
  }

  ocrButton.disabled = true;
  ocrStatus.textContent = "画像を読み取っています...";

  try {
    const result = await requestOcr(file);

    console.log("Python OCR結果:", result);

    if (result.name) {
      itemName.value = result.name;
    }

    if (result.expiry) {
      expiryDate.value = result.expiry;
    }

    ocrStatus.textContent =
      "画像の読み取りが完了しました。";

  } catch (error) {
    console.error(error);

    ocrStatus.textContent =
      "画像の読み取りに失敗しました。";
  } finally {
    ocrButton.disabled = false;
  }
});

// 選択・登録済みの写真を削除
removeImageButton.addEventListener("click", function () {
  selectedImage = "";

  clearImagePreview();

  ocrButton.disabled = true;
  ocrStatus.textContent = "";
});

// 商品登録フォームを表示
addButton.addEventListener("click", function () {
  editingId = null;
  selectedImage = "";

  ocrButton.disabled = true;
  ocrStatus.textContent = "";

  openRegistrationForm();
});

// キャンセル
cancelButton.addEventListener("click", function () {
  editingId = null;
  selectedImage = "";

  ocrButton.disabled = true;
  ocrStatus.textContent = "";

  closeForm();
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

  displayCount.textContent =
    "表示件数：" + filteredItems.length + "件";

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

// バックアップデータを書き出す
exportButton.addEventListener("click", function () {
  exportItems(items);
});


// バックアップデータを選択
importButton.addEventListener("click", function () {
  importFile.click();
});


// バックアップデータを読み込む
importFile.addEventListener("change", async function () {
  const file = importFile.files[0];

  if (!file) {
    return;
  }

  try {
    const importedItems = await importItems(file);

    const result = confirm(
      "現在の商品データを、読み込んだバックアップデータで置き換えますか？"
    );

    if (!result) {
      return;
    }

    items = importedItems;

    saveItems(items);

    renderItems();
    updateSummary();

    alert("バックアップデータを読み込みました。");

  } catch (error) {
    console.error(error);

    alert(
      "バックアップデータの読み込みに失敗しました。"
    );

  } finally {
    importFile.value = "";
  }
});

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