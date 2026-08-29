import {
  formatDate,
  setExpiryColor,
  getRemainingDays,
  setRemainingColor
} from "./expiry.js";

// 商品カードを作成
export function createItemCard(item, onEdit, onDelete) {
  const card = document.createElement("div");
  card.className = "item-card";
  setExpiryColor(card, item.expiry);

  const image = document.createElement("div");
  image.className = "item-image";

  if (item.image) {
    const img = document.createElement("img");
    img.src = item.image;
    img.alt = item.name;
    image.appendChild(img);
  } else {
    image.textContent = "写真なし";
  }

  const info = document.createElement("div");
  info.className = "item-info";

  const name = document.createElement("h3");
  name.textContent = item.name;

  const expiry = document.createElement("p");
  expiry.textContent = "賞味期限：" + formatDate(item.expiry);

  const remaining = document.createElement("p");
  remaining.textContent = getRemainingDays(item.expiry);
  remaining.className = "remaining-days";
  setRemainingColor(remaining, item.expiry);

  const quantityText = document.createElement("p");
  quantityText.textContent = "個数：" + item.quantity;

  const storageText = document.createElement("p");
  storageText.textContent = "収納場所：" + item.storage;

  const memoText = document.createElement("p");
  memoText.textContent = "メモ：" + (item.memo || "なし");

  info.appendChild(name);
  info.appendChild(expiry);
  info.appendChild(remaining);
  info.appendChild(quantityText);
  info.appendChild(storageText);
  info.appendChild(memoText);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const editButton = document.createElement("button");
  editButton.textContent = "編集";

  editButton.addEventListener("click", function () {
    onEdit(item);
  });

  const deleteButton = document.createElement("button");
  deleteButton.textContent = "削除";

  deleteButton.addEventListener("click", function () {
    onDelete(item);
  });

  actions.appendChild(editButton);
  actions.appendChild(deleteButton);

  card.appendChild(image);
  card.appendChild(info);
  card.appendChild(actions);

  return card;
}