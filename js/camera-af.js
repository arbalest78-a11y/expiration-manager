// AF対応の背面カメラを優先する
export function getAutofocusScore (track) {
  let modes = []
  try {
    const capabilities = track?.getCapabilities?.() || {}
    modes = Array.isArray(capabilities.focusMode)
      ? capabilities.focusMode
      : []
  } catch (error) {
    console.warn('AF対応情報を取得できません:', error)
  }

  if (modes.includes('continuous') && modes.includes('single-shot')) return 3
  if (modes.includes('continuous')) return 2
  if (modes.includes('single-shot')) return 1
  return 0
}

export function getVideoConstraints (deviceId = '') {
  return {
    ...(deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: 'environment' } }),
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  }
}

export async function selectAutofocusCamera (initialStream, { isCurrent, setAutoStatus }) {
  if (!navigator.mediaDevices.enumerateDevices) return initialStream

  const initialTrack = initialStream.getVideoTracks()[0]
  const initialDeviceId = initialTrack?.getSettings?.().deviceId || ''
  let bestDeviceId = initialDeviceId
  let bestScore = getAutofocusScore(initialTrack)

  if (bestScore === 3) return initialStream

  let rearCameras
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()

    rearCameras = devices.filter(
      device =>
        device.kind === 'videoinput' &&
        device.deviceId &&
        (/\b(back|rear|environment)\b/i.test(device.label) ||
          /背面|アウトカメラ/.test(device.label))
    )
  } catch (error) {
    console.warn('カメラ一覧を取得できません:', error)
    return initialStream
  }

  const candidates = rearCameras.filter(
    device => device.deviceId !== initialDeviceId
  )
  if (!candidates.length) return initialStream

  setAutoStatus('AF対応の背面カメラを確認中です…')

  // 複数のカメラを同時に開かないようにする
  initialStream.getTracks().forEach(track => track.stop())

  for (const device of candidates) {
    if (!isCurrent()) return null

    let probeStream = null
    try {
      probeStream = await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(device.deviceId),
        audio: false
      })

      if (!isCurrent()) return null

      const score = getAutofocusScore(probeStream.getVideoTracks()[0])

      console.log('背面カメラのAF判定:', device.label, score)

      if (score > bestScore) {
        bestScore = score
        bestDeviceId = device.deviceId
      }
    } catch (error) {
      console.warn('カメラの確認をスキップ:', device.label, error)
    } finally {
      probeStream?.getTracks().forEach(track => track.stop())
    }

    if (bestScore === 3) break
  }

  if (!isCurrent()) return null

  console.log('自動選択するカメラ:', bestDeviceId, 'AFスコア:', bestScore)

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: getVideoConstraints(bestDeviceId),
      audio: false
    })
  } catch (error) {
    console.warn('AF対応カメラを起動できません:', error)
    return navigator.mediaDevices.getUserMedia({
      video: getVideoConstraints(),
      audio: false
    })
  }
}
