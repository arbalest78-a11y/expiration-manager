import {
  itemName,
  expiryDate,
  ocrButton,
  ocrStatus
} from './dom.js'

import { requestOcr } from './ocr-api.js'

// OCR結果を賞味期限欄に反映する。自動スキャン時は必ず利用者に確認する。
function applyOcrResult(result, automatic = false) {
  const fullDate = typeof result.expiry === 'string' ? result.expiry : ''
  const monthValue = typeof result.expiry_month === 'string' ? result.expiry_month : ''

  if (fullDate) {
    // 不正な日付は入力しない（誤認識防止）
    if (!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(fullDate)) {
      return 'notfound'
    }
    const [year, month, day] = fullDate.split('-').map(Number)
    const check = new Date(year, month - 1, day)
    if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
      return 'notfound'
    }

    // 通常の写真OCRは従来どおり。ライブOCRは誤認識を考慮して確認する。
    if (automatic) {
      const accepted = window.confirm(
        `賞味期限を「${year}年${month}月${day}日」と認識しました。\n\n` +
        '実物の表記と一致していますか？\n正しければOKを押してください。'
      )
      if (!accepted) {
        ocrStatus.textContent = '自動認識の候補を採用しませんでした。カメラを再起動して試してください。'
        return 'rejected'
      }
    }
    expiryDate.value = fullDate
    if (result.name) itemName.value = result.name
    ocrStatus.textContent = `賞味期限欄に${fullDate}を入力しました。保存前に実物をご確認ください。`
    return 'accepted'
  }

  if (monthValue) {
    const match = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(monthValue)
    if (!match) return 'notfound'

    const year = Number(match[1])
    const month = Number(match[2])
    const lastDay = new Date(year, month, 0).getDate()
    const formattedDate = `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`

    const accepted = window.confirm(
      `賞味期限を「${year}年${month}月」と認識しました。\n\n` +
      '実物の表記が年月のみの場合に限り、\n' +
      `${year}年${month}月${lastDay}日（月末）として入力しますか？\n\n` +
      '「日」まで記載されている場合や、読み取り結果が違う場合はキャンセルしてください。'
    )

    if (!accepted) {
      ocrStatus.textContent = '年月の候補を採用しませんでした。必要に応じて手動入力してください。'
      return 'rejected'
    }
    expiryDate.value = formattedDate
    if (result.name) itemName.value = result.name
    ocrStatus.textContent = `年月を確認して${formattedDate}を入力しました。保存前に実物をご確認ください。`
    return 'accepted'
  }

  return 'notfound'
}

export function setupOcr ({ getOcrFile }) {
  ocrButton.addEventListener('click', async function (event) {
    event.preventDefault()
    const file = getOcrFile()
    if (!file) {
      ocrStatus.textContent = '画像を選択してください。'
      return
    }

    ocrButton.disabled = true
    ocrStatus.textContent = '画像を読み取っています...'
    try {
      const result = await requestOcr(file)
      console.log('写真OCR結果:', result)
      const state = applyOcrResult(result)
      if (state === 'notfound') {
        ocrStatus.textContent = '賞味期限を認識できませんでした。'
      }
    } catch (error) {
      console.error(error)
      ocrStatus.textContent = '画像の読み取りに失敗しました。'
    } finally {
      ocrButton.disabled = false
    }
  })

  return {
    handleAutomaticResult (result) {
      return applyOcrResult(result, true)
    }
  }
}
