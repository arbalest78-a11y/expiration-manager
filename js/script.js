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

const cropArea =
  document.getElementById("cropArea");

const cropCanvas =
  document.getElementById("cropCanvas");

const clearCropButton =
  document.getElementById("clearCropButton");

const cropContext =
  cropCanvas.getContext("2d");

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
let cropImage = null;

let barcodeControls = null;
let detectedJan = "";

const janCodeReader =
  new ZXingBrowser.BrowserMultiFormatOneDReader();

let cropSelection = null;

let isSelectingCrop = false;

let cropStartX = 0;
let cropStartY = 0;

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
    showCropSelector(selectedImage);

    // 写真を選択したらOCRボタンを使えるようにする
    ocrButton.disabled = false;
    ocrStatus.textContent = "";
  });

  reader.readAsDataURL(file);
});

// =========================
// OCR範囲選択
// =========================

// 画像を範囲選択Canvasに表示
function showCropSelector(dataUrl) {

  cropImage = new Image();

  cropImage.addEventListener("load", function () {

    const maxWidth = 700;

    let displayWidth = cropImage.naturalWidth;
    let displayHeight = cropImage.naturalHeight;

    if (displayWidth > maxWidth) {

      const ratio =
        maxWidth / displayWidth;

      displayWidth = maxWidth;

      displayHeight =
        Math.round(
          displayHeight * ratio
        );
    }

    cropCanvas.width = displayWidth;
    cropCanvas.height = displayHeight;

    cropSelection = null;

    drawCropCanvas();

    cropArea.hidden = false;
  });

  cropImage.src = dataUrl;
}


// Canvasを描画
function drawCropCanvas() {

  if (!cropImage) {
    return;
  }

  cropContext.clearRect(
    0,
    0,
    cropCanvas.width,
    cropCanvas.height
  );

  cropContext.drawImage(
    cropImage,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height
  );

  if (cropSelection) {

    cropContext.strokeStyle = "red";
    cropContext.lineWidth = 3;

    cropContext.strokeRect(
      cropSelection.x,
      cropSelection.y,
      cropSelection.width,
      cropSelection.height
    );
  }
}


// マウス位置をCanvas座標に変換
function getCropPosition(event) {

  const rect =
    cropCanvas.getBoundingClientRect();

  const scaleX =
    cropCanvas.width / rect.width;

  const scaleY =
    cropCanvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) *
      scaleX,

    y: (event.clientY - rect.top) *
      scaleY
  };
}


// 選択開始
cropCanvas.addEventListener(
  "pointerdown",
  function (event) {

    const position =
      getCropPosition(event);

    cropStartX = position.x;
    cropStartY = position.y;

    isSelectingCrop = true;

    cropCanvas.setPointerCapture(
      event.pointerId
    );
  }
);


// 選択中
cropCanvas.addEventListener(
  "pointermove",
  function (event) {

    if (!isSelectingCrop) {
      return;
    }

    const position =
      getCropPosition(event);

    cropSelection = {
      x: Math.min(
        cropStartX,
        position.x
      ),

      y: Math.min(
        cropStartY,
        position.y
      ),

      width: Math.abs(
        position.x - cropStartX
      ),

      height: Math.abs(
        position.y - cropStartY
      )
    };

    drawCropCanvas();
  }
);


// 選択終了
cropCanvas.addEventListener(
  "pointerup",
  function () {

    isSelectingCrop = false;
  }
);


// 選択を解除
clearCropButton.addEventListener(
  "click",
  function () {

    cropSelection = null;

    drawCropCanvas();
  }
);

function createCroppedOcrFile() {
  return new Promise(function (resolve, reject) {

    // 範囲を選択していない場合は元画像を使う
    if (
      !cropImage ||
      !cropSelection ||
      cropSelection.width < 5 ||
      cropSelection.height < 5
    ) {
      resolve(ocrFile);
      return;
    }

    // 表示画像と元画像のサイズ差を計算
    const scaleX =
      cropImage.naturalWidth /
      cropCanvas.width;

    const scaleY =
      cropImage.naturalHeight /
      cropCanvas.height;

    const sourceX =
      cropSelection.x * scaleX;

    const sourceY =
      cropSelection.y * scaleY;

    const sourceWidth =
      cropSelection.width * scaleX;

    const sourceHeight =
      cropSelection.height * scaleY;

    // 選択範囲の周囲に自動で余白を追加
    const paddingX = sourceWidth * 0.1;
    const paddingY = sourceHeight * 0.25;

    // 元画像の外にはみ出さないように調整
    const paddedX =
      Math.max(0, sourceX - paddingX);

    const paddedY =
      Math.max(0, sourceY - paddingY);

    const paddedRight =
      Math.min(
        cropImage.naturalWidth,
        sourceX + sourceWidth + paddingX
      );

    const paddedBottom =
      Math.min(
        cropImage.naturalHeight,
        sourceY + sourceHeight + paddingY
      );

    const paddedWidth =
      paddedRight - paddedX;

    const paddedHeight =
      paddedBottom - paddedY;

    // 切り抜き画像用Canvas
    const outputCanvas =
      document.createElement("canvas");

    outputCanvas.width =
      Math.round(paddedWidth);

    outputCanvas.height =
      Math.round(paddedHeight);

    const outputContext =
      outputCanvas.getContext("2d");

    outputContext.drawImage(
      cropImage,

      paddedX,
      paddedY,
      paddedWidth,
      paddedHeight,

      0,
      0,
      outputCanvas.width,
      outputCanvas.height
    );

    outputCanvas.toBlob(
      function (blob) {

        if (!blob) {
          reject(
            new Error(
              "画像の切り抜きに失敗しました。"
            )
          );
          return;
        }

        const file =
          new File(
            [blob],
            "expiry-crop.jpg", {
              type: "image/jpeg"
            }
          );

        resolve(file);
      },

      "image/jpeg",
      0.95
    );
  });
}

async function startJanScan() {

  if (!cameraStream) {
    return;
  }

  detectedJan = "";

  try {

    barcodeControls =
      await janCodeReader.decodeFromStream(
        cameraStream,
        cameraVideo,
        function (result) {

          if (!result) {
            return;
          }

          const code = result.getText();

          // JANコードは主に8桁または13桁
          if (!/^(?:\d{8}|\d{13})$/.test(code)) {
            return;
          }

          // 同じコードを何度も処理しない
          if (detectedJan === code) {
            return;
          }

          detectedJan = code;

          console.log(
            "JANコードを読み取りました:",
            detectedJan
          );

          ocrStatus.textContent =
            "JANコードを読み取りました：" +
            detectedJan;
        }
      );

  } catch (error) {

    console.error(
      "JANコード読み取りエラー:",
      error
    );

    ocrStatus.textContent =
      "JANコードの読み取りを開始できませんでした。";
  }
}

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
        "JANコードをカメラに映してください。";

      await startJanScan();

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

    showCropSelector(selectedImage);

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
  if (barcodeControls) {
    barcodeControls.stop();
    barcodeControls = null;
  }
  
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
ocrButton.addEventListener("click", async function (event) {
  event.preventDefault();

  console.log("OCRボタンが押されました");

  const file =
    await createCroppedOcrFile();

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

  console.log("フォーム送信が発生しました", event.submitter);

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