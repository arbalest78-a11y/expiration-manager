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

// 商品データをJSONファイルとして書き出す
export function exportItems(items) {
  const json = JSON.stringify(items, null, 2);

  const blob = new Blob([json], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;

  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  link.download = `expiration-items-backup-${year}-${month}-${day}.json`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}


// JSONファイルから商品データを読み込む
export function importItems(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();

    reader.addEventListener("load", function () {
      try {
        const data = JSON.parse(reader.result);

        if (!Array.isArray(data)) {
          throw new Error(
            "バックアップデータの形式が正しくありません。"
          );
        }

        resolve(data);

      } catch (error) {
        reject(error);
      }
    });

    reader.addEventListener("error", function () {
      reject(
        new Error("ファイルの読み込みに失敗しました。")
      );
    });

    reader.readAsText(file);
  });
}