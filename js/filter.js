import {
  getExpiryCategory
} from "./expiry.js";

export function filterAndSortItems(
  items,
  keyword,
  storageValue,
  expiryFilter,
  sortValue
) {
  let filteredItems = items.filter(function (item) {
    return item.name.toLowerCase().includes(keyword.toLowerCase());
  });

  // 収納場所で絞り込み
  if (storageValue !== "all") {
    filteredItems = filteredItems.filter(function (item) {
      return item.storage === storageValue;
    });
  }

  // 賞味期限で絞り込み
  if (expiryFilter !== "all") {
    filteredItems = filteredItems.filter(function (item) {
      return getExpiryCategory(item.expiry) === expiryFilter;
    });
  }

  // 並び替え
  if (sortValue === "expiry") {
    filteredItems.sort(function (a, b) {
      return new Date(a.expiry) - new Date(b.expiry);
    });
  } else if (sortValue === "name") {
    filteredItems.sort(function (a, b) {
      return a.name.localeCompare(b.name, "ja");
    });
  }

  return filteredItems;
}