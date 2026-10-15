
import {
  itemName,
  expiryDate,
  ocrButton,
  ocrStatus
} from './dom.js'

import { requestOcr } from './ocr-api.js'

// OCR機能の初期設定
export function setupOcr ({ getOcrFile }) {

  ocrButton.addEventListener('click', async function (event) {
    event.preventDefault()

    console.log('OCRボタンが押されました')

    const file = getOcrFile()

    if (!file) {
      ocrStatus.textContent = '画像を選択してください。'
      return
    }

    ocrButton.disabled = true
    ocrStatus.textContent = '画像を読み取っています...'

    try {
      // PythonのOCRサーバーへ画像を送信
      const result = await requestOcr(file)

      console.log('Python OCR結果:', result)

      if (result.name) {
        itemName.value = result.name
      }

      // 年月日まで認識できた場合
      if (result.expiry) {
        expiryDate.value = result.expiry

        ocrStatus.textContent =
          '賞味期限を読み取りました。'

      // 年月のみ認識できた場合
      } else if (result.expiry_month) {

        const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(
          result.expiry_month
        )

        if (!match) {
          ocrStatus.textContent =
            '年月の形式を確認できませんでした。'

        } else {
          const year = Number(match[1])
          const month = Number(match[2])

          // 月末の日付を取得
          const lastDay = new Date(year, month, 0).getDate()

          // YYYY-MM-DD形式に変換
          const formattedDate =
            `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`

          // 利用者に確認
          const confirmed = window.confirm(
            `賞味期限を「${year}年${month}月」と認識しました。\n\n` +
            `実物の表記を確認してください。\n` +
            `${year}年${month}月${lastDay}日（月末）として入力しますか？`
          )

          if (confirmed) {
            expiryDate.value = formattedDate

            ocrStatus.textContent =
              `賞味期限欄に${formattedDate}を入力しました。` +
              '保存ボタンで登録してください。'

          } else {
            ocrStatus.textContent =
              '年月のみの賞味期限の反映をキャンセルしました。'
          }
        }

      } else {
        ocrStatus.textContent =
          '賞味期限を認識できませんでした。'
      }

    } catch (error) {
      console.error(error)

      ocrStatus.textContent =
        '画像の読み取りに失敗しました。'

    } finally {
      ocrButton.disabled = false
    }
  })
}
