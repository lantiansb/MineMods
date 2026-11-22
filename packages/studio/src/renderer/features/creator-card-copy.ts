export function checkCopy(text: string, names: (text: string) => string) {
  const clean = text
    .replace(/(?:如果|若)它?本来就该这样[^。]*justified[^。]*。?/g, "如果这就是预期效果，请说明原因，让 AI 记下来。")
    .replace(/（[^（）]*[{][^（）]*[}][^（）]*）/g, "")
    .replace(/[{][^{}]*[}]/g, "相关设置")
    .replace(/[{}]/g, "")
    .replace(/"id" *:/g, "编号 ")
    .replace(/请用户/g, "请你")
    .replace(/\bjustified\b/g, "例外说明")
  return names(clean)
}

/** A tool's manifest may address its caller, who is usually an AI. */
export function toolCopy(text: string) {
  if (/[{}]|"id" *:|请用户|协调方转述/.test(text)) return ""
  return text
}

export function runSummaryCopy(text: string) {
  return text === "进程在任务完成前退出，结果未继续写入。" ? "上一次制作中途结束了。可以在制作现场重试。" : text
}
