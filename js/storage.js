// 保存されている商品を読み込む
export function loadItems() {
  return JSON.parse(localStorage.getItem("expirationItems")) || [];
}

// 商品をlocalStorageに保存
export function saveItems(items) {
  localStorage.setItem(
    "expirationItems",
    JSON.stringify(items)
  );
}