import { soundUsers } from "@minemods/mod-core/sound-moments"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import { AssetAction, AssetRename, AssetRestore, COPY_KINDS } from "../asset-actions"
import type { StudioApi } from "../api"

const types = {
  rename_asset: AssetRename,
  duplicate_asset: AssetAction,
  delete_asset: AssetAction,
  restore_deleted_asset: AssetRestore,
}
type Tool = keyof typeof types
type Service = Pick<StudioApi, "renameAsset" | "duplicateAsset" | "deleteAsset" | "restoreDeleted">
type ExternalService = { [Key in keyof Service]: (input: Parameters<Service[Key]>[0], external: true) => ReturnType<Service[Key]> }

export function isAssetAction(tool: string): tool is Tool {
  return Object.hasOwn(types, tool)
}

export const ASSET_ACTIONS = {
  how: "用户明确要求改名、复制或删除时，先用 open_project（detail: summary）取工程 revision 和资产 UUID，再调用 run_tool，tool 填下方的动作名。projectId 放在外层，expectedRevision 和 assetId 放在 input 里。改生物的标题时选 module: entity。改名只改 Studio 里显示的名字，游戏注册名照旧。删除前核对用户指定的对象，删除会写进动态，可以在动态中撤销。若返回 used_by，先按其中的用处用普通修改任务换掉引用，再刷新 revision 重试。",
  actions: [
    { tool: "rename_asset", input: { expectedRevision: "工程 revision", assetId: "资产 UUID", title: "新显示名称" } },
    { tool: "duplicate_asset", input: { expectedRevision: "工程 revision", assetId: "资产 UUID" }, kinds: COPY_KINDS },
    { tool: "delete_asset", input: { expectedRevision: "工程 revision", assetId: "资产 UUID" } },
    { tool: "restore_deleted_asset", input: { expectedRevision: "当前工程 revision", deletion: "删除成功时返回的编号" } },
  ],
}

export async function runAssetAction(service: ExternalService, tool: Tool, projectId: string, input: Record<string, unknown>) {
  const given = { ...input, projectId }
  switch (tool) {
    case "rename_asset": {
      const parsed = types.rename_asset.parse(given)
      const { project } = await service.renameAsset(parsed, true)
      return { ok: true, revision: project.revision, assetId: parsed.assetId, title: parsed.title }
    }
    case "duplicate_asset": {
      const { view, assetId } = await service.duplicateAsset(types.duplicate_asset.parse(given), true)
      return { ok: true, revision: view.project.revision, assetId, title: view.project.workspace.assets.find((asset) => asset.id === assetId)?.title }
    }
    case "restore_deleted_asset": {
      const { view, assetId } = await service.restoreDeleted(types.restore_deleted_asset.parse(given), true)
      return { ok: true, revision: view.project.revision, assetId }
    }
    case "delete_asset": {
      const parsed = types.delete_asset.parse(given)
      const removed = await service.deleteAsset(parsed, true)
      const { project } = removed.view
      if (removed.deletion !== null) {
        return {
          ok: true, revision: project.revision, assetId: parsed.assetId, deletion: removed.deletion,
          how: "已写入动态。需要撤销时，在 Studio 动态里点撤销，或者调用 run_tool 的 restore_deleted_asset，传删除编号和最新的工程 revision。",
        }
      }
      const sound = soundUsers(project, parsed.assetId)
      const targets = removed.used_by.map((user) => {
        const assetId = project.blueprint?.entries.find((entry) => entry.key === user.id)?.asset_id
          ?? project.workspace.assets.find((asset) => user.id === asset.id || user.id.endsWith(":" + asset.id))?.id
          ?? null
        const document = project.workspace.assets.find((asset) => asset.id === assetId)?.document
        const entity = document?.kind === "entity" ? document.model_asset_id : user.kind === "entity" ? user.id.split(":").at(-1) : null
        const places = sound.filter((place) => place.owner === assetId || (entity && place.entity === entity))
        return { ...user, assetId, places: places.map(({ key, where }) => ({ key, where })) }
      })
      const refs: FindingRef[] = targets.flatMap<FindingRef>((user) => {
        if (user.assetId) return [{ kind: "asset", id: user.assetId, title: user.title }]
        if (project.blueprint?.entries.some((entry) => entry.key === user.id))
          return [{ kind: "blueprint", id: user.id, title: user.title }]
        return []
      })
      return {
        ok: false, revision: project.revision, deletion: null, used_by: targets, refs, message: removed.message,
        how: "先用普通修改任务分别换掉 used_by 里的引用。places 列出了能定位到的发声处。保存这些修改后再读工程 revision，重试删除。",
      }
    }
  }
}
