// 日付を YYYY/MM/DD に変換
export function formatDate(dateString) {
  const parts = dateString.split("-");
  return parts[0] + "/" + parts[1] + "/" + parts[2];
}

// 賞味期限に応じてカードの背景色を設定
export function setExpiryColor(card, expiryDateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDateString);
  expiry.setHours(0, 0, 0, 0);

  const difference =
    Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  if (difference < 0) {
    card.classList.add("expired");
  } else if (difference <= 2) {
    card.classList.add("danger");
  } else if (difference <= 7) {
    card.classList.add("warning");
  } else {
    card.classList.add("safe");
  }
}

// 賞味期限までの残り日数を表示
export function getRemainingDays(expiryDateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDateString);
  expiry.setHours(0, 0, 0, 0);

  const difference =
    Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  if (difference < 0) {
    return "期限切れ";
  } else if (difference === 0) {
    return "今日まで";
  } else {
    return "あと" + difference + "日";
  }
}

// 残り日数の文字色を設定
export function setRemainingColor(element, expiryDateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDateString);
  expiry.setHours(0, 0, 0, 0);

  const difference =
    Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  if (difference < 0) {
    element.classList.add("remaining-expired");
  } else if (difference <= 2) {
    element.classList.add("remaining-danger");
  } else if (difference <= 7) {
    element.classList.add("remaining-warning");
  } else {
    element.classList.add("remaining-safe");
  }
}

// 賞味期限の分類を返す
export function getExpiryCategory(expiryDateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDateString);
  expiry.setHours(0, 0, 0, 0);

  const difference =
    Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  if (difference < 0) {
    return "expired";
  } else if (difference <= 2) {
    return "danger";
  } else if (difference <= 7) {
    return "warning";
  } else {
    return "safe";
  }
}