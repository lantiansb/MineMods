import { readMedia } from "@minemods/mod-core/media"
import { MUSIC_LABELS, musicEvents } from "@minemods/mod-core/music"
import type { Project } from "@minemods/mod-core/project"
import { isSoundAsset } from "@minemods/mod-core/sound"
import type { WorkspaceAsset } from "@minemods/mod-core/workspace"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import type { ExternalAudioLookInput } from "../external"
import { audioPlot, audioSpectrum, AUDIO_SAMPLE_RATE, decodeAudio, measureAudio, rmsDb } from "./audio-measure"
import { MakingRefusal } from "@minemods/mod-core/making"
import type { LookProgress } from "./look-job"

const RELATIVE_SECONDS = 8
const RELATIVE_ASSETS = 6
const factRef = (asset: WorkspaceAsset): FindingRef => ({ kind: "asset", id: asset.id, title: asset.title })
type Issue = { rule: string; text: string; fix: string; refs: FindingRef[] }

function tracks(asset: WorkspaceAsset) {
  const doc = asset.document
  if (doc.kind === "sound")
    return doc.files.map((track, index) => ({
      part: index + 1, label: `第 ${index + 1} 段`, channels: 1, seconds: track.duration,
      data: async (_directory: string) => Buffer.from(track.data.slice(track.data.indexOf(",") + 1), "base64"),
    }))
  if (doc.kind === "music")
    return musicEvents(doc).map((track) => ({
      part: track.part, label: MUSIC_LABELS[track.part], channels: track.channels, seconds: track.seconds,
      data: (directory: string) => readMedia(directory, track.media_sha256),
    }))
  return []
}

function cues(project: Project, asset: WorkspaceAsset, seconds: number): Issue[] {
  return project.entities.flatMap((entity) => (entity.abilities ?? []).flatMap((ability) => ability.events.flatMap((event) => {
    if (event.type !== "sound" || !isSoundAsset(event.sound) || event.sound.asset !== asset.id || event.at >= ability.windup) return []
    const left = ability.windup - event.at
    if (seconds <= left + 0.05) return []
    const owner = project.workspace.assets.find((candidate) => candidate.document.kind === "entity" && candidate.document.model_asset_id === entity.id)
    return [{
      rule: "audio_cue_after_windup",
      text: `「${owner?.title ?? entity.name}」的「${ability.name}」还剩 ${Number(left.toFixed(2))} 秒出手，这段提示音长 ${seconds} 秒。`,
      fix: "如果这段声音要在出手前讲完，缩短声音或把发声时刻提前。",
      refs: [factRef(asset), { kind: "ability", id: ability.id, title: ability.name } as const, ...(owner ? [factRef(owner)] : [])],
    }]
  })))
}

export async function lookAudioAsset(directory: string, project: Project, input: ExternalAudioLookInput, program: string, progress?: LookProgress) {
  const asset = project.workspace.assets.find((choice) => choice.id === input.assetId)
  if (asset?.document.kind !== "sound" && asset?.document.kind !== "music")
    throw new MakingRefusal("请用 open_project（detail: summary）找已保存的声音或音乐，再把那项的 UUID 放进 assetId。")
  const available = tracks(asset)
  const selected = input.audio_part ?? (asset.document.kind === "music" ? "loop" : 1)
  const track = available.find((candidate) => candidate.part === selected)
  if (!track) throw new MakingRefusal(`找不到这段音频。这里可以看 ${available.map((entry) => entry.part).join("、")}。`)
  progress?.(0, 2)
  const samples = await decodeAudio(program, await track.data(directory), track.channels, track.seconds + 0.02)
  const measured = measureAudio(samples, track.channels)
  const { facts } = measured
  const { image, bands, dominant } = audioSpectrum(samples, track.channels, measured.frames)
  const pictures = [
    { label: `${track.label} 波形（峰值 ${facts.peak_dbfs} dBFS，暗区为前后静音）`, url: audioPlot(measured) },
    { label: `${track.label} 频谱（亮处能量高，暗区为前后静音）`, url: audioPlot(measured, image) },
  ]
  progress?.(2, 2)

  const matching = project.workspace.assets.filter((other) => other.id !== asset.id && other.document.kind === asset.document.kind)
  const comparison: { rms: number; ref: FindingRef }[] = []
  for (const other of matching.slice(0, RELATIVE_ASSETS)) {
    const clip = tracks(other).find((candidate) => candidate.part === selected) ?? tracks(other)[0]
    if (!clip) continue
    const sample = await clip.data(directory).then((data) => decodeAudio(program, data, clip.channels, RELATIVE_SECONDS)).catch(() => null)
    if (sample) comparison.push({ rms: rmsDb(sample), ref: factRef(other) })
  }
  const picked = rmsDb(samples.subarray(0, RELATIVE_SECONDS * AUDIO_SAMPLE_RATE * track.channels))
  const values = comparison.map((entry) => entry.rms).sort((a, b) => a - b)
  const median = values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2 : null
  const difference = median === null ? null : Number((picked - median).toFixed(1))
  const warning = (rule: string, text: string, fix: string, refs = [factRef(asset)]): Issue => ({ rule, text, fix, refs })
  const details = [
    ...((facts.starts_seconds ?? facts.seconds) >= 0.18 ? [warning("audio_leading_silence", facts.starts_seconds === null ? "整段都低于起声门槛。" : `前 ${facts.starts_seconds} 秒没有明显的声音。`, "如果要立即提示玩家，剪掉多余的开头静音，然后请人试听。")] : []),
    ...(selected !== "loop" && facts.tail_silence_seconds < 0.02 && facts.last_20ms_dbfs >= -32 ? [warning("audio_possible_cut", `最后 20 毫秒还有 ${facts.last_20ms_dbfs} dBFS，尾音可能被截断。`, "试听最后一下。若有突兀的断点，留足尾音或加短淡出。")] : []),
    ...(difference !== null && Math.abs(difference) >= 8 ? [warning("audio_relative_level", `比同工程抽查的同类内容${difference > 0 ? "响" : "轻"}约 ${Math.abs(difference)} dB。`, "先和工程里的同类声音一起试听，再决定要不要调音量。", [factRef(asset), ...comparison.map((entry) => entry.ref)])] : []),
    ...(asset.document.kind === "sound" ? cues(project, asset, facts.seconds) : []),
  ]
  return {
    asset: factRef(asset), selected, available: available.map(({ part, label }) => ({ part, label })),
    audio_facts: {
      ...facts, is_mono: facts.channels === 1, dominant_band: dominant,
      band_energy_percent: { below_250_hz: bands[0], hz_250_to_2000: bands[1], hz_2000_to_12000: bands[2] },
      comparison: { difference_db: difference, compared: comparison.length, available: matching.length, seconds_per_asset: RELATIVE_SECONDS },
    },
    pictures,
    finding_details: details,
    notes: [
      "峰值和平均值以数字满刻度为基准。平均值是录音电平的均方根。声音起止按 10 毫秒一格、低于 −45 dBFS 算静音。",
      "波形显示每一格的波峰和波谷，黄色线标出静音边界。频谱按时间均匀抽取短窗口；高于 12 kHz 的能量未参与统计。",
      "这些图和数来自音频文件。游戏里的音量设置、播放位置和其他声音还会影响听感。最终请人试听。",
    ],
  }
}
