/** Draw the actual range of samples in each column, including both channels. */
export async function audioWave(src: string, thumbnail = false) {
  const chars = atob(src.slice(src.indexOf(",") + 1))
  const bytes = Uint8Array.from(chars, (char) => char.charCodeAt(0)).buffer
  const audio = await new OfflineAudioContext(1, 1, 22050).decodeAudioData(bytes)
  const canvas = document.createElement("canvas")
  canvas.width = thumbnail ? 40 : 256
  canvas.height = thumbnail ? 40 : 64
  const center = canvas.height / 2
  const brush = canvas.getContext("2d")!
  brush.fillStyle = thumbnail ? "#172a29" : "#13332e"
  brush.fillRect(0, 0, canvas.width, canvas.height)
  brush.fillStyle = thumbnail ? "#c3ffd5" : "#a4e2bd"
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index))
  const ranges:{low:number;high:number}[]=[]
  let peak=0
  for (let x = 0; x < canvas.width; x++) {
    const start = Math.floor((x * audio.length) / canvas.width)
    const end = Math.floor(((x + 1) * audio.length) / canvas.width)
    let low = 0,
      high = 0
    for (const channel of channels)
      for (let i = start; i < end; i++) {
        low = Math.min(low, channel[i])
        high = Math.max(high, channel[i])
      }
    ranges.push({low,high})
    peak=Math.max(peak,high,-low)
  }
  const scale = (center - 2) / (peak || 1)
  ranges.forEach(({ low, high }, x) => {
    // At shelf scale, widen quiet sections while keeping their timing and the peak's shape.
    const amplitude = (value: number) => thumbnail ? Math.sign(value) * Math.sqrt(Math.abs(value * scale) / center) * center : value * scale
    const upper = amplitude(high)
    brush.fillRect(x, center - upper, 1, Math.max(1, upper - amplitude(low)))
  })
  return canvas.toDataURL()
}
