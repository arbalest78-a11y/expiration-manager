import {
  getExpiryCategory
} from "./expiry.js";

// 賞味期限ごとの件数を集計
export function getSummaryCounts(items) {
  const counts = {
    expired: 0,
    danger: 0,
    warning: 0,
    safe: 0
  };

  items.forEach(function (item) {
    const category = getExpiryCategory(item.expiry);
    counts[category]++;
  });

  return counts;
}