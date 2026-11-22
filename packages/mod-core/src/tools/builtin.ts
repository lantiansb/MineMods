import { SOUND_LIMITS } from "../sound"
import type { BuiltinTool, ToolManifest } from "./manifest"

/**
 * Studio's own tools (工具资产 that come with Studio): written here, not in a folder, always there and turned on until the person turns one off. They need no program,
 * address or key of their own.
 * - sound-synth: an outside AI writes a recipe of sound (oscillators, noise, envelopes, filters on a time line) and Studio renders it: the way any AI can make a sound
 *   itself, without a service. Renders to the game's sound (mono, at most `SOUND_LIMITS.seconds`).
 * - delegate-sound / delegate-image: the AI connected to Studio makes the file with a generator of its own and hands it back; one that has none says so.
 * - video-frames: a check that cuts a recording into frames for the reviewer to look at (Studio's test scene records it).
 */
export const SOUND_ENCODER_REQUIRED = "缺少 ffmpeg。请用户在 Studio 的「存储空间」下载或指定 ffmpeg；装好前，可以用已有的声音，或者直接提交已经转好的单声道 OGG Vorbis 声音文档。"

const NAME_FIELDS = {
  title: { type: "string" as const, description: "声音卡片上显示的名字，可写中文", maxLength: 120 },
  subtitle_zh: { type: "string" as const, description: "游戏中文字幕；与 subtitle_en 一起填写", maxLength: SOUND_LIMITS.subtitle },
  subtitle_en: { type: "string" as const, description: "游戏英文字幕；与 subtitle_zh 一起填写", maxLength: SOUND_LIMITS.subtitle },
}

export const BUILTIN_MANIFESTS: Record<BuiltinTool, ToolManifest> = {
  "sound-synth": {
    schema_version: 1,
    id: "sound-synth",
    version: "1",
    title: "合成音效",
    description:
      "按一份合成配方当场合成一段音效（吼声、金属撞击、鼓点、风声、蹄声这类），波形由 Studio 本地计算，保存成单声道 OGG Vorbis 需 ffmpeg。recipe 是 JSON 文字：{seconds, layers:[{wave: sine|square|saw|triangle|noise, from_hz, to_hz, start, length, gain, attack, decay, sustain, release, lowpass_hz, highpass_hz, vibrato_hz, vibrato_depth}]}，各层叠在一起（最多 16 层）。取值：时间都是秒（seconds 最长 10）；from_hz、to_hz、lowpass_hz、highpass_hz 在 10 到 12000 之间；gain、sustain 0 到 1；vibrato_hz 0 到 40；vibrato_depth 是音高抖动的比例，0 到 0.5（0.03 已经很明显）。完成后返回合成波形的时长、峰值、RMS、削波和主要频段。",
    role: "generate",
    medium: "sound",
    input: {
      type: "object",
      properties: {
        recipe: { type: "string", description: "合成配方（JSON 文字），格式见工具说明", maxLength: 4000 },
        name: { type: "string", description: "这段声音的名字（小写英文、数字和下划线），存成声音资产时用", maxLength: 40 },
        ...NAME_FIELDS,
      },
      required: ["recipe", "name"],
    },
    runner: { type: "builtin", name: "sound-synth" },
    limits: { seconds: 30, bytes: SOUND_LIMITS.bytes },
  },
  "delegate-sound": {
    schema_version: 1,
    id: "delegate-sound",
    version: "1",
    title: "由连接的 AI 生成声音",
    description:
      "请连着 Studio 的 AI 用它自己的生成能力做一段声音，再把文件交回来（finish_tool_run 带 data URL）。它没有生成声音的能力就如实说不支持，不要用别的东西冒充。ffmpeg 支持解码的声音会转成游戏要的单声道 OGG Vorbis。",
    role: "generate",
    medium: "sound",
    input: { type: "object", properties: { prompt: { type: "string", description: "要什么样的声音，越具体越好（是什么东西发出的、多长、什么情绪）", maxLength: 1000 }, name: { type: "string", description: "存成声音资产时的名字（小写英文、数字和下划线）", maxLength: 40 }, ...NAME_FIELDS }, required: ["prompt", "name"] },
    runner: { type: "builtin", name: "delegate-sound" },
    limits: { seconds: 1800, bytes: 8 * 1024 * 1024 },
  },
  "delegate-image": {
    schema_version: 1,
    id: "delegate-image",
    version: "1",
    title: "由连接的 AI 生成图片",
    description: "请连着 Studio 的 AI 用它自己的画图能力画一张图（比如六视图），再把文件交回来（finish_tool_run 带 data URL）。它没有画图能力就如实说不支持；不得用脚本画占位图冒充。",
    role: "generate",
    medium: "image",
    input: { type: "object", properties: { prompt: { type: "string", description: "要画什么，照 Studio 给的绘图规格写", maxLength: 4000 } }, required: ["prompt"] },
    runner: { type: "builtin", name: "delegate-image" },
    limits: { seconds: 1800, bytes: 16 * 1024 * 1024 },
  },
  "scene-record": {
    schema_version: 1,
    id: "scene-record",
    version: "1",
    title: "录测试场",
    description: "把用户在 Studio 里打开的这个工程的测试场游戏窗口录下来（只录这一个窗口，不录别的），存成工程的检查材料，不进资产、不进模组。游戏要开着、不能最小化；只在 Windows 上能录。录完用 video-frames 抽帧来看。",
    role: "generate",
    medium: "video",
    input: { type: "object", properties: { seconds: { type: "integer", description: "录多少秒", minimum: 2, maximum: 60 } }, required: ["seconds"] },
    runner: { type: "builtin", name: "scene-record" },
    limits: { seconds: 120, bytes: 64 * 1024 * 1024 },
  },
  "video-frames": {
    schema_version: 1,
    id: "video-frames",
    version: "1",
    title: "录像抽帧检查",
    description: "把测试场的一段录像按时间均匀抽成若干张图，get_tool_run 会把这些图和要看什么（look_for）一起给你：逐张看，照 look_for 写下发现。它自己不判断好坏。",
    role: "check",
    medium: "video",
    input: {
      type: "object",
      properties: {
        recording: { type: "string", description: "录像的编号：scene-record 那次运行的编号", maxLength: 80 },
        frames: { type: "integer", description: "抽几张", minimum: 2, maximum: 24 },
        look_for: { type: "string", description: "审查时要看什么（比如：招式的预警圈和判定是否对得上）", maxLength: 1000 },
      },
      required: ["recording", "frames", "look_for"],
    },
    runner: { type: "builtin", name: "video-frames" },
    limits: { seconds: 300, bytes: 32 * 1024 * 1024 },
  },
}

/**
 * The tool folders Studio writes once into a new runtime, turned off until the person looks at them and turns them on: an online sound generator to fill in
 * with a real service's address and key. Deleted, it is not written again.
 */
export const TOOL_TEMPLATES: Record<string, ToolManifest> = {
  "image-api": {
    schema_version: 1,
    id: "image-api",
    version: "0",
    title: "在线画图（模板，OpenAI 兼容）",
    description: "调用一个 OpenAI 兼容的图片生成接口画一张图（比如模型的六视图）。这是模板：地址默认是 OpenAI 的 images/generations，换成你用的服务；在 Studio 里存好它的密钥（IMAGE_API_KEY），再启用。",
    role: "generate",
    medium: "image",
    input: { type: "object", properties: { prompt: { type: "string", description: "要画什么（六视图就照 Studio 给的绘图规格写）", maxLength: 4000 }, size: { type: "string", description: "图片大小", enum: ["1024x1024", "1536x1024", "1024x1536"] } }, required: ["prompt"] },
    runner: {
      type: "http",
      url: "https://api.openai.com/v1/images/generations",
      method: "POST",
      headers: { Authorization: "Bearer {secret:IMAGE_API_KEY}", "Content-Type": "application/json" },
      body: { model: "gpt-image-1", prompt: "{input.prompt}", size: "1536x1024", n: 1 },
      answer: { kind: "base64", path: "data.0.b64_json" },
    },
    limits: { seconds: 300, bytes: 16 * 1024 * 1024 },
    source: "模板；用的时候遵守你所选服务的条款，费用由该服务收取。",
  },
  "sound-api": {
    schema_version: 1,
    id: "sound-api",
    version: "0",
    title: "在线音效生成（模板）",
    description: "调用一个在线的音效生成服务：给一段文字描述和时长，拿回一段音频。这是模板：把地址、请求格式和取结果的位置换成你用的服务，在 Studio 里存好它的密钥（SOUND_API_KEY），再启用。",
    role: "generate",
    medium: "sound",
    input: { type: "object", properties: { prompt: { type: "string", description: "要什么样的声音", maxLength: 1000 }, seconds: { type: "number", description: "多长（秒）", minimum: 0.5, maximum: 10 }, name: { type: "string", description: "存成声音资产时的名字", maxLength: 40 } }, required: ["prompt", "seconds", "name"] },
    runner: {
      type: "http",
      url: "https://api.example.com/v1/sound-generation",
      method: "POST",
      headers: { Authorization: "Bearer {secret:SOUND_API_KEY}", "Content-Type": "application/json" },
      body: { text: "{input.prompt}", duration_seconds: "{input.seconds}" },
      answer: { kind: "binary" },
    },
    limits: { seconds: 120, bytes: 8 * 1024 * 1024 },
    source: "模板，不指向任何真实服务；换成你选的服务后遵守它的条款。",
  },
}
