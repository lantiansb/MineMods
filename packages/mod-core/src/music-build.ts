import { readMedia } from "./media"
import { checkMusicBytes, musicEvents } from "./music"
import type { Project } from "./project"
import { compileSoundData, type SoundDocument } from "./sound"

export function bossSongs(project: Project) {
  const ids = new Set(project.entities.flatMap(entity => entity.behavior === "hostile" && entity.boss?.music ? [entity.boss.music.asset] : []))
  return [...ids].map(id => {
    const asset = project.workspace.assets.find(asset => asset.id === id)
    if (!asset || asset.document.kind !== "music") throw new Error("Boss 的音乐在工程里找不到。请选择音乐资产，再重新生成。")
    return { id, document: asset.document, title: asset.title }
  })
}

export async function buildSoundData(directory: string, modId: string, effects: SoundDocument[], songs: ReturnType<typeof bossSongs>) {
  const data = compileSoundData(modId, effects)
  const names = effects.map(sound => sound.name)
  const large: { id: string; title: string; text: string }[] = []
  if (songs.length) {
    const root = `src/main/resources/assets/${modId}`
    const manifest = `${root}/sounds.json`
    const events = JSON.parse(String(data.files[manifest])) as Record<string, unknown>
    for (const song of songs) {
      let size = 0
      for (const part of musicEvents(song.document)) {
        if (Object.hasOwn(events, part.event)) throw new Error(`「${song.title}」的声音事件 ${part.event} 重名，请更改音乐或声音的内部名称。`)
        const bytes = await readMedia(directory, part.media_sha256)
        checkMusicBytes(part, bytes)
        size += bytes.length
        names.push(part.event)
        events[part.event] = { sounds: [{ name: `${modId}:${part.event}`, stream: true }] }
        data.files[`${root}/sounds/${part.event}.ogg`] = bytes
      }
      if (size > 8 * 1024 * 1024) large.push({ id: song.id, title: song.title, text: `「${song.title}」的音频占 ${(size / 1048576).toFixed(1)} MiB` })
    }
    data.files[manifest] = JSON.stringify(events, null, 2)
  }
  return { ...data, names, large }
}
