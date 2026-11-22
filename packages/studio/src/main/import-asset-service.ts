import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import * as assets from "@minemods/mod-core/import-assets"
import { loadImportedModel, type ImportedModelPreview } from "@minemods/mod-core/imported-model"
import { loadImportEntityModels } from "@minemods/mod-core/import-entity-models"
import { baseModelFallback } from "@minemods/mod-core/import-base-models"
import { createImportedRuntimeResolver } from "@minemods/mod-core/imported-runtime-model"
import { getImportProject } from "@minemods/mod-core/import-project"
import { buildImportAssetGraph, loadImportAssetGraph } from "@minemods/mod-core/import-asset-graph"
import { assertNoReverseSymlink, reverseFilePath } from "@minemods/mod-core/reverse-archive"
import {
  clearImportedArchiveCache,
  createJarClassProvider,
  createVanillaResourceProvider,
  resolveTargetMinecraftVersion,
} from "@minemods/mod-core/import-vanilla"

export class ImportAssetServiceError extends Error {}

export function createImportAssetService(workspaceDirectory: string, runtimeDirectory?: string) {
  const pending = new Set<Promise<unknown>>()
  const tails = new Map<string, Promise<unknown>>()
  const execute = <T>(id: string, operation: () => Promise<T>) => {
    const work = (tails.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation)
      .catch((cause: unknown) => {
        throw new ImportAssetServiceError(cause instanceof Error ? cause.message : "资产操作失败")
      })
      .finally(() => {
        pending.delete(work)
        if (tails.get(id) === work) tails.delete(id)
      })
    tails.set(id, work)
    pending.add(work)
    return work
  }
  const core = (id: string) => ({ workspaceDirectory, id })
  /** The game's own files for the version this project targets, when a copy exists on this computer. */
  const openGame = async (id: string) => {
    const project = await getImportProject(workspaceDirectory, id)
    const version = resolveTargetMinecraftVersion(
      project.report.metadata.minecraft_versions,
      project.manifest.source.filename,
    )?.version
    return version
      ? createVanillaResourceProvider(version, { workspaceDirectory, runtimeDirectory, projectDirectory: project.directory })
      : null
  }
  /** Pictures already read from the game's files, per project. */
  const gameIcons = new Map<string, Map<string, { mime: "image/png"; base64: string } | null>>()
  /** When a project last turned out to have no copy of the game, so a card full of slots asks only once. */
  const gameMissing = new Map<string, number>()
  const entityIndex = async (id: string) => {
    const game = await openGame(id).catch(() => null)
    // Only probing here; the build opens its own handle when it actually needs the files.
    game?.dispose()
    return loadImportEntityModels({ ...core(id), hasGame: !!game, openGame: () => openGame(id) })
  }
  const saveDerived = async (
    root: string,
    assetId: string,
    metadata: Record<string, unknown>,
    files: Record<string, unknown>,
  ) => {
    const relative = `models/${assetId}`
    await assertNoReverseSymlink(root, relative, true)
    const target = reverseFilePath(root, relative)
    const projectRoot = path.dirname(root)
    await assertNoReverseSymlink(projectRoot, ".cache/import-assets", true)
    await mkdir(reverseFilePath(projectRoot, ".cache/import-assets"), { recursive: true })
    const staging = reverseFilePath(projectRoot, `.cache/import-assets/${randomUUID()}.tmp`)
    const backup = reverseFilePath(projectRoot, `.cache/import-assets/${randomUUID()}.bak`)
    await mkdir(staging, { recursive: false })
    const hashes: Record<string, string> = {}
    try {
      for (const [name, value] of Object.entries(files)) {
        const content = JSON.stringify(value, null, 2)
        await writeFile(path.join(staging, name), content, { flag: "wx", mode: 0o600 })
        hashes[name] = createHash("sha256").update(content).digest("hex")
      }
      await writeFile(path.join(staging, "asset.json"), JSON.stringify({ ...metadata, files: hashes }, null, 2), {
        flag: "wx",
        mode: 0o600,
      })
      await mkdir(path.dirname(target), { recursive: true })
      const existing = await lstat(target).catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? null : Promise.reject(error),
      )
      if (existing && !existing.isDirectory()) throw new ImportAssetServiceError("模型派生目录被其他文件占用。")
      if (existing) await rename(target, backup)
      await rename(staging, target).catch(async (error) => {
        if (existing) await rename(backup, target)
        throw error
      })
      await rm(backup, { recursive: true, force: true })
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
  const importAssets = {
    isBusy: () => pending.size > 0,
    dispose: async () => {
      await Promise.allSettled([...pending])
      await clearImportedArchiveCache()
    },
    selection: (input: { id: string }) => execute(input.id, () => assets.getImportAssetSelection(core(input.id))),
    catalog: (input: { id: string }) => execute(input.id, () => assets.getImportedAssetCatalog(core(input.id))),
    graph: (input: { id: string }) => execute(input.id, () => loadImportAssetGraph(core(input.id))),
    buildGraph: (input: { id: string }) => execute(input.id, () => buildImportAssetGraph(core(input.id))),
    extract: (input: { id: string; groupIds: string[] }) =>
      execute(input.id, () => assets.extractImportAssets({ ...core(input.id), groupIds: input.groupIds })),
    read: (input: { id: string; assetId: string }) =>
      execute(input.id, () => assets.readImportedAssetFile({ ...core(input.id), assetId: input.assetId })),
    save: (input: { id: string; assetId: string; expectedSha256: string; content: string }) =>
      execute(input.id, async () => {
        const catalog = await assets.saveImportedAssetFile({ ...input, workspaceDirectory })
        const root = await assets.getImportAssetRoot(core(input.id))
        await assertNoReverseSymlink(root, "models", true)
        // Any edited model or parent can change a derived scene. Rebuild on the next preview.
        await rm(reverseFilePath(root, "models"), { recursive: true, force: true })
        return catalog
      }),
    export: (input: { id: string; destination: string }) =>
      execute(input.id, () => assets.exportImportAssetWorkspace({ ...input, workspaceDirectory })),
    preview: (input: { id: string; assetId: string; texturePath?: string }) =>
      execute(input.id, async () => {
        const catalog = await assets.getImportedAssetCatalog(core(input.id))
        const asset = catalog?.assets.find((entry) => entry.id === input.assetId)
        if (!catalog || !asset || asset.kind !== "model") throw new ImportAssetServiceError("请选择已入库的模型资产。")
        const candidates = new Map<string, assets.ImportedAsset[]>()
        catalog.assets.forEach((entry) =>
          candidates.set(entry.resourcePath, [...(candidates.get(entry.resourcePath) ?? []), entry]),
        )
        const resources = new Map<string, assets.ImportedAsset>()
        candidates.forEach((entries, relative) => {
          const own = entries.filter((entry) => entry.groupId === asset.groupId)
          const unique = own.length ? own : entries
          if (unique.length === 1) resources.set(relative, unique[0]!)
        })
        const texture = input.texturePath
          ? catalog.assets.find(
              (entry) => entry.path === input.texturePath && entry.kind === "texture" && entry.format === "png",
            )
          : undefined
        if (input.texturePath && !texture) throw new ImportAssetServiceError("请选择当前资产工程中的 PNG 贴图。")
        if (texture) resources.set(texture.resourcePath, texture)
        const project = await getImportProject(workspaceDirectory, input.id),
          versionSelection = resolveTargetMinecraftVersion(
            project.report.metadata.minecraft_versions,
            project.manifest.source.filename,
          ),
          targetVersion = versionSelection?.version ?? null,
          sourcePath = path.join(project.directory, "source", project.manifest.source.filename),
          vanilla = targetVersion
            ? await createVanillaResourceProvider(targetVersion, {
                workspaceDirectory,
                runtimeDirectory,
                projectDirectory: project.directory,
              })
            : null,
          original = project.manifest.source.filename.toLowerCase().endsWith(".jar")
            ? await createJarClassProvider(sourcePath, project.manifest.source.sha256)
            : null,
          dependencies = new Map<string, string>(),
          vanillaDependencies = new Map<string, { sha256: string; content: string | null }>(),
          vanillaDiagnostics: { code: string; version: string | null; path?: string; message: string }[] = []
        if (!targetVersion)
          vanillaDiagnostics.push({
            code: "target_version_ambiguous",
            version: null,
            message: "导入报告和原始文件名无法确定唯一的 Minecraft 目标版本，未启用原版资源补全。",
          })
        else if (!vanilla)
          vanillaDiagnostics.push({
            code: "client_jar_unavailable",
            version: targetVersion,
            message: `本机没有 Minecraft ${targetVersion} 的 client JAR，原版资源无法补全。`,
          })
        if (versionSelection && vanilla)
          vanillaDiagnostics.push({
            code: "target_version_selected",
            version: versionSelection.version,
            message: `已根据${versionSelection.selectionBasis === "report_exact" ? "导入报告" : "原始文件名与报告版本范围"}选用 Minecraft ${versionSelection.version} 资源。`,
          })
        try {
          const readResource = async (relative: string) => {
              const normalized = relative.replaceAll("\\", "/"),
                entry = resources.get(normalized)
              if (entry) {
                dependencies.set(entry.id, entry.sha256)
                return assets.readImportedAssetBytes({ ...core(input.id), assetId: entry.id })
              }
              if (candidates.has(normalized))
                throw new ImportAssetServiceError(`资源引用存在多个来源，请选择明确的资源：${normalized}`)
              if (vanilla?.has(normalized) || (normalized.endsWith(".class") && vanilla?.hasClass(normalized))) {
                const bytes = await vanilla.readFile(normalized),
                  sha256 = createHash("sha256").update(bytes).digest("hex")
                vanillaDependencies.set(normalized, {
                  sha256,
                  content: normalized.endsWith(".class") ? null : Buffer.from(bytes).toString("base64"),
                })
                return bytes
              }
              if (original?.has(normalized)) return original.readFile(normalized)
              // No copy of the game on this computer: the plain cube family is built in.
              const fallback = baseModelFallback(normalized)
              if (fallback) return fallback
              throw new ImportAssetServiceError(`资源引用缺失：${normalized}`)
            },
            runtimePaths = [
              ...new Set([
                ...resources.keys(),
                ...(vanilla?.paths ?? []),
                ...(vanilla?.classPaths ?? []),
                ...(original?.paths ?? []),
              ]),
            ],
            resolveRuntimeModel = createImportedRuntimeResolver({ paths: runtimePaths, readFile: readResource }),
            modelPaths = [...new Set([...resources.keys(), ...(vanilla?.paths ?? [])])]
          const result = await loadImportedModel({
            entryPath: asset.resourcePath,
            paths: modelPaths,
            ...(texture ? { texturePath: texture.resourcePath } : {}),
            readFile: readResource,
            resolveRuntimeModel,
          })
          if (vanilla && !(await vanilla.verify()))
            throw new ImportAssetServiceError("Minecraft client JAR changed during model preview.")
          if (original && !(await original.verify()))
            throw new ImportAssetServiceError("Imported source JAR changed during model preview.")
          const root = await assets.getImportAssetRoot(core(input.id))
          await saveDerived(
            root,
            asset.id,
            {
              schemaVersion: 1,
              assetId: asset.id,
              sourceSha256: catalog.sourceSha256,
              sourcePath: asset.sourcePath,
              sourceAssetSha256: asset.sha256,
              format: result.format,
              textureCandidateAssetIds: result.textures.flatMap((name) =>
                resources.get(name) ? [resources.get(name)!.id] : [],
              ),
              selectedTextureAssetId: texture?.id ?? null,
              diagnostics: [...result.diagnostics, ...vanillaDiagnostics.map((diagnostic) => diagnostic.message)],
              vanillaDiagnostics,
              dependencies: [...dependencies].map(([assetId, sha256]) => ({ assetId, sha256 })),
              vanillaDependencies: vanilla
                ? {
                    version: vanilla.version,
                    jarSha256: vanilla.sha256,
                    classJarSha256: vanilla.classSha256,
                    selectionBasis: versionSelection?.selectionBasis,
                    jarSource: vanilla.selectionBasis,
                    entries: [...vanillaDependencies].map(([resourcePath, value]) => ({
                      path: resourcePath,
                      sha256: value.sha256,
                      embedded: value.content !== null,
                    })),
                  }
                : undefined,
            },
            {
              ...(result.model && result.preview
                ? { "preview.json": { model: result.model, preview: result.preview } }
                : {}),
              ...(result.blockbench ? { "model.bbmodel": result.blockbench } : {}),
              ...(vanillaDependencies.size
                ? {
                    "vanilla-resources.json": Object.fromEntries(
                      [...vanillaDependencies].flatMap(([resourcePath, value]) =>
                        value.content === null ? [] : [[resourcePath, value]],
                      ),
                    ),
                  }
                : {}),
            },
          )
          return {
            ...result,
            diagnostics: [...result.diagnostics, ...vanillaDiagnostics.map((diagnostic) => diagnostic.message)],
            vanillaDiagnostics,
            textures: result.textures.map((name) => resources.get(name)?.path ?? name),
          }
        } finally {
          vanilla?.dispose()
          original?.dispose()
        }
      }),
    /** Every creature the project adds and whether a picture of it is available. */
    entities: (input: { id: string }) =>
      execute(input.id, async () =>
        (await entityIndex(input.id)).entities.map((entry) => ({
          entity: entry.entity,
          kind: entry.kind,
          creature: entry.creature,
          partial: entry.partial,
          hasTexture: !!entry.texture,
          matchedByName: entry.via === "name",
          helper: entry.helper === true,
          note: entry.diagnostics[0] ?? null,
        })),
      ),
    /**
     * The picture of an item or block that is not part of the project, read from the copy of the
     * game on this computer. Null when there is no copy or the game draws it without a flat picture.
     */
    gameIcon: (input: { id: string; item: string }) => {
      const known = gameIcons.get(input.id)?.get(input.item)
      if (known !== undefined) return Promise.resolve(known)
      // Its own queue: reading the game's files never touches the project and should not wait behind it.
      return execute(`${input.id}:game-icons`, async () => {
        const match = input.item.match(/^([a-z0-9_.-]{1,128}):([a-z0-9_./-]{1,128})$/)
        if (!match || input.item.includes("..") || /(^|:)\/|\/\/|\/$/.test(input.item)) return null
        if (Date.now() - (gameMissing.get(input.id) ?? 0) < 60_000) return null
        const game = await openGame(input.id).catch(() => null)
        if (!game) {
          gameMissing.set(input.id, Date.now())
          return null
        }
        try {
          const namespace = match[1]!
          const name = match[2]!
          // Stairs, slabs and fences are drawn from the block they are cut from.
          const whole = name.replace(/_(slab|stairs|wall|fence_gate|fence|button|pressure_plate|trapdoor|door)$/, "")
          const names = [
            `item/${name}`,
            `block/${name}`,
            ...["side", "front", "top"].map((face) => `block/${name}_${face}`),
            ...(whole === name ? [] : [whole, `${whole}_planks`, `${whole}s`, `${whole}_top`].map((base) => `block/${base}`)),
          ]
          let icon: { mime: "image/png"; base64: string } | null = null
          for (const candidate of names) {
            const file = `assets/${namespace}/textures/${candidate}.png`
            if (!game.has(file)) continue
            const bytes = await game.readFile(file).catch(() => null)
            const png = bytes && bytes.length <= 256 * 1024 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
            if (!png) continue
            icon = { mime: "image/png", base64: Buffer.from(bytes).toString("base64") }
            break
          }
          const cache = gameIcons.get(input.id) ?? new Map<string, { mime: "image/png"; base64: string } | null>()
          // Bounded: a project asks for a few hundred pictures at most.
          if (cache.size < 4096) cache.set(input.item, icon)
          gameIcons.set(input.id, cache)
          return icon
        } finally {
          game.dispose()
        }
      })
    },
    /** The model and texture of one creature, ready for the 3D preview. */
    previewEntity: async (input: { id: string; entity: string }): Promise<ImportedModelPreview> => {
      // A creature drawn from a model file goes through the normal model preview, which queues itself;
      // it must not be started from inside this project's queue or it would wait for itself.
      const fromFile = await execute(input.id, async () => {
        const entry = (await entityIndex(input.id)).entities.find((candidate) => candidate.entity === input.entity)
        if (entry?.kind !== "asset") return null
        const catalog = await assets.getImportedAssetCatalog(core(input.id))
        const texture = entry.texture && "assetId" in entry.texture ? entry.texture.assetId : undefined
        return { assetId: entry.modelAssetId!, texturePath: catalog?.assets.find((asset) => asset.id === texture)?.path }
      })
      if (fromFile)
        return importAssets.preview({
          id: input.id,
          assetId: fromFile.assetId,
          ...(fromFile.texturePath ? { texturePath: fromFile.texturePath } : {}),
        })
      return execute(input.id, async (): Promise<ImportedModelPreview> => {
        const entry = (await entityIndex(input.id)).entities.find((candidate) => candidate.entity === input.entity)
        if (!entry || entry.kind !== "java")
          return {
            format: "java-model",
            model: null,
            preview: null,
            blockbench: null,
            textures: [],
            diagnostics: entry?.diagnostics.length ? entry.diagnostics : ["没有找到这个生物的模型。"],
          }
        const catalog = await assets.getImportedAssetCatalog(core(input.id))
        const textureAsset =
          entry.texture && "assetId" in entry.texture
            ? catalog?.assets.find((asset) => asset.id === (entry.texture as { assetId: string }).assetId)
            : undefined
        let textureBytes: Uint8Array | undefined
        if (textureAsset) textureBytes = await assets.readImportedAssetBytes({ ...core(input.id), assetId: textureAsset.id })
        else if (entry.texture && "game" in entry.texture) {
          const game = await openGame(input.id).catch(() => null)
          try {
            textureBytes = await game?.readFile(entry.texture.game)
          } catch {
            // The preview falls back to an untextured model.
          } finally {
            game?.dispose()
          }
        }
        const entryPath = `java-models/${input.entity.replace(/[^a-z0-9_.-]/g, "_")}.geo.json`
        const texturePath = textureBytes ? "java-models/texture.png" : undefined
        const result = await loadImportedModel({
          entryPath,
          paths: [entryPath, ...(texturePath ? [texturePath] : [])],
          ...(texturePath ? { texturePath } : {}),
          readFile: async (relative) => {
            if (relative === entryPath) return new TextEncoder().encode(JSON.stringify(entry.geometry))
            if (textureBytes && relative === texturePath) return textureBytes
            throw new ImportAssetServiceError(`资源引用缺失：${relative}`)
          },
        })
        return {
          ...result,
          preview: result.preview ? { ...result.preview, look: entry.look ?? { blend: false, opacity: 1 } } : null,
          format: "java-model",
          diagnostics: [...entry.diagnostics, ...result.diagnostics],
          textures: textureAsset ? [textureAsset.path] : [],
        }
      })
    },
  }
  return importAssets
}
