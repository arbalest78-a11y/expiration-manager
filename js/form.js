import {
  formSection,
  itemForm,
  itemList,
  itemName,
  expiryDate,
  quantity,
  storage,
  memo,
  itemImage,
  imagePreview,
  removeImageButton
} from "./dom.js";

// 画像プレビューを表示
export function showImagePreview(imageData) {
  imagePreview.src = imageData;
  imagePreview.style.display = "block";
  removeImageButton.style.display = "inline-block";
}

// 画像プレビューを消す
export function clearImagePreview() {
  itemImage.value = "";
  imagePreview.src = "";
  imagePreview.style.display = "none";
  removeImageButton.style.display = "none";
}

// 登録フォームを表示
export function openRegistrationForm() {
  itemForm.reset();
  quantity.value = 1;

  clearImagePreview();

  formSection.querySelector("h2").textContent = "商品登録";
  formSection.style.display = "block";

  formSection.scrollIntoView({
    behavior: "smooth"
  });
}

// 編集フォームを表示
export function openEditFormUI(item) {
  itemName.value = item.name;
  expiryDate.value = item.expiry;
  quantity.value = item.quantity;
  storage.value = item.storage;
  memo.value = item.memo;

  if (item.image) {
    showImagePreview(item.image);
  } else {
    clearImagePreview();
  }

  formSection.querySelector("h2").textContent = "商品編集";
  formSection.style.display = "block";

  formSection.scrollIntoView({
    behavior: "smooth"
  });
}

// フォームを閉じて初期状態に戻す
export function closeForm() {
  formSection.style.display = "none";

  itemForm.reset();
  quantity.value = 1;

  clearImagePreview();

  formSection.querySelector("h2").textContent = "商品登録";

  itemList.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}
