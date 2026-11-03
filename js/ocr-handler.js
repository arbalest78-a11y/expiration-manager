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
  const suggestedDate = typeof result.expiry_suggestion === 'string' ? result.expiry_suggestion : ''
  const monthValue = typeof result.expiry_month === 'string' ? result.expiry_month : ''
  const warning = typeof result.expiry_warning === 'string' ? result.expiry_warning : ''
  const otherDates = Array.isArray(result.date_candidates)
    ? result.date_candidates.filter(value => typeof value === 'string')
    : []

  // OCRの文字認識は正しいとは限らない。手動・自動いずれの実行でも確認を求める。
  const candidate = fullDate || suggestedDate
  if (candidate) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(candidate)) {
      ocrStatus.textContent = '日付の形式が正しくありません。手動で入力してください。'
      return 'notfound'
    }

    const [year, month, day] = candidate.split('-').map(Number)
    const check = new Date(year, month - 1, day)
    if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
      ocrStatus.textContent = '存在しない日付です。手動で入力してください。'
      return 'notfound'
    }

    const candidatesText = otherDates.length > 1
      ? `\n別候補: ${otherDates.filter(value => value !== candidate).join('、')}\n`
      : ''
    const estimateText = suggestedDate
      ? 'OCRの誤認識を補正した【推定値】です。\n'
      : 'OCRが読み取った【日付候補】です。\n'

    const accepted = window.confirm(
      `${estimateText}\n${year}年${month}月${day}日\n` +
      `${warning ? `\n注意: ${warning}\n` : ''}${candidatesText}\n` +
      '必ず実物の日付（年・月・日すべて）と見比べてください。\n' +
      '完全に一致する場合だけOKを押してください。\n' +
      '1文字でも違う／読めない場合はキャンセルして手動入力してください。'
    )
    if (!accepted) {
      ocrStatus.textContent = 'OCR候補を採用しませんでした。実物を見て賞味期限を手動入力してください。'
      return 'rejected'
    }

    expiryDate.value = candidate
    if (result.name) itemName.value = result.name
    ocrStatus.textContent = `実物と照合して${candidate}を入力しました。保存前にも確認してください。`
    return 'accepted'
  }

  // 年月しか取得できない場合は、元のパッケージにも日が書かれていない場合に限る。
  if (monthValue) {
    const match = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(monthValue)
    if (!match) return 'notfound'

    const year = Number(match[1])
    const month = Number(match[2])
    const lastDay = new Date(year, month, 0).getDate()
    const formattedDate = `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`
    const accepted = window.confirm(
      `OCRは「${year}年${month}月」までしか認識できませんでした。\n\n` +
      '実物も年月のみの印字の場合だけ、\n' +
      `${year}年${month}月${lastDay}日（月末）に変換しますか？\n\n` +
      '「日」まで記載されている場合は、必ずキャンセルしてください。'
    )
    if (!accepted) {
      ocrStatus.textContent = '年月候補を採用しませんでした。日付まで確認して手動入力してください。'
      return 'rejected'
    }
    expiryDate.value = formattedDate
    if (result.name) itemName.value = result.name
    ocrStatus.textContent = `実物の年月表示を確認し、${formattedDate}を入力しました。`
    return 'accepted'
  }

  if (warning) {
    ocrStatus.textContent = warning
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
