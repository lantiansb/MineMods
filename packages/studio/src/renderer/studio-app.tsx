import { kindLabel } from "./words"
import { thingName } from "./words"
import { editableConnection, reviewEnabled } from "../connection"
import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { render } from "solid-js/web"
import { REVISION_CONFLICT, type BuildPanel, type JavaReport, type ModInfoInput, type StudioApi, type StudioView } from "../api"
import type { Project } from "@minemods/mod-core/project"
import type { Item } from "@minemods/mod-core/content"
import type { ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"
import { saveHand } from "./features/asset-edit-save"
import type { Job, JobState } from "@minemods/mod-core/jobs"
import { SettingsSchema } from "../settings"
import { AHEAD_WORDS } from "../prepare-ahead"
import { Avatar, Button, Icon } from "./ui"
import { TITLE_IMAGE, nextSplash, pickSplash } from "./world"
import { Advancements } from "./features/advancement"
import { SceneEula, TestScene, type SceneInfo } from "./features/test-scene"
import { ByHand } from "./features/play-by-hand"
import { CrashFix } from "./features/crash-fix"
import { jobWentStale } from "@minemods/mod-core/build-stages"
import { CRASH_WORDS, crashDetails, jobCrashDetail, jobCrashed } from "@minemods/mod-core/game-crash"
import { CHAIN_WORDS, EXPORT_WORDS, JOB_STATE_WORDS, chainOwnsNextAction, exportButton, chainStages, endedDetail, inGame, plainProgress, runningNote, skippedBuildWords, stageWait, type ChainEnd, type ChainFacts, type ChainStage } from "./play-chain"
import { versionView } from "./build-version"
import { VERSION_WORDS } from "@minemods/mod-core/packed-version"
import { advanceChain as advanceChainFor, type Chain, type ChainDeps } from "./play-chain-run"
import { handoffRequest } from "./pending-sentence"
import { ConfirmDialog, UNSAVED, ask, askText } from "./confirm-dialog"
import { connectionChip, outsidePresent } from "./connection-chip"
import { reviewOffer } from "./features/review-offer"
import { shelfOpen, rememberShelf, SHELF_STORE } from "./shelf-state"
import { MCP_PRESENCE } from "../mcp-presence"
import { ModInfo } from "./features/mod-info"
import { FindingGo } from "./features/finding-go"
import { jobTarget } from "./job-target"
import { INFO_WORDS, infoLine } from "./mod-info-model"
import type { FindingTarget } from "@minemods/mod-core/reconcile"
import { SCENE_WORDS } from "@minemods/mod-core/scene"
import { ProjectConception } from "./features/project-conception"
import { ContentBriefEditor, contentNames } from "./features/content-brief"
import type { ConceptionEntry, Conception } from "@minemods/mod-core/conception"
import type { ModelProgress } from "../main/model-core-session"
import { ModelWorkspace } from "./features/model-workspace"
import { ProjectArt } from "./features/project-art"
import { HomeWorlds, OpenOrImport } from "./features/home-worlds"
import { calm, setCalmSetting } from "./calm"
import { createMining } from "./little-things"
import { playSound, setSoundSetting } from "./sounds"
const logoHasFallen = { done: false }
import { buildCounts, glyphLines } from "./features/build-counts"
import { BuildWarningResult } from "./features/build-warnings"
import { creatureInside, insideTabs, type InsideTab } from "./features/creature-inside-model"
import { CreatureInsidePage } from "./features/creature-inside-page"
import { soundDestination } from "./features/sound-focus"
import { ThingMenu, UndoThing } from "./features/thing-menu"
import { MoreMenu } from "./more-menu"
import { ProjectNavigation, entityRuntimeAsset, runtimeAssetEntity } from "./features/project-navigation"
import { legacyConception, storesOnOpen } from "./features/project-navigation-model"
import { WORDS } from "./words"
import { CreationSteps } from "./features/creation-steps"
import { AssetWorkspace } from "./features/asset-workspace"
import { NO_AI_WORDS } from "./features/asset-edit-words"
import { ConnectionSettings } from "./features/connection-settings"
import { PersonalSettings } from "./features/personal-settings"
import { awayStatus, settingsBack, settingsOrigin } from "./features/settings-words"
import { ModelComplexityControl } from "./features/model-complexity"
import { MakingFloor } from "./features/external-workbench"
import { MadeProjectBar } from "./features/made-project"
import { followMade, freshMade, madeKey, MADE_WORDS } from "./made-project"
import { cardAsked, clearCardTarget, floorAsked } from "./features/making-floor-link"
import { ResourceManager, RESOURCE_LABELS, type ResourceTab } from "./features/resource-manager"
import { projectGames } from "./features/resource-manager-model"
import { TargetCard, loadTargets } from "./features/target-card"
import { JavaCard } from "./features/java-card"
import { PreinstalledMods } from "./features/preinstalled-mods"
import { SETUP_WORDS, defaultTarget, LOADER_NAMES, plainError, summaryLine, targetLine, targetLoaderName, type PendingMod } from "./features/project-setup-model"
import { CardShell, ProjectAssets } from "./features/project-assets"
import type { OverviewItem } from "../api"
import type { PublicConnection, SaveConnectionInput } from "../connection"
import type { McpConnectionStatus } from "../mcp-status"
import { MODULES, type ModuleKind } from "@minemods/mod-core/workspace-modules"
import type { ModuleDocument, WorkspaceAsset } from "@minemods/mod-core/workspace"
import type { ProjectRun } from "../project-runs"
import { advanced, setAdvanced, advancedLine, ADVANCED_TITLE, type AdvancedPlace } from "./advanced"
import { chosenModId, deriveModId, modIdProblem, MOD_ID_WORDS } from "../mod-id"
import { Fold } from "./fold"
import "./workbench.css"
import "./desktop.css"
import "./skin.css"
import "./world.css"
import "./shelf.css"
import "./readability.css"

type Page =
  | "home"
  | "create"
  | "overview"
  | "conception"
  | "commands"
  | "asset"
  | "library"
  | "entry"
  | "model"
  | "texture"
  | "animation"
  | "behavior"
  | "share"
  | "info"
  | "profile"
  | "resources"

// How long something has to take before the title bar says so, and how long an ignored click is shown: under about
// a third of a second a line that comes and goes reads as a flicker, and 0.6 s is one blink a person notices.
// Said where a creature has a model but no rules of its own yet. The old way on from here was a behaviour brief that
// no build read; rules that reach the game are made like everything else, from the overview's sentence.
const NO_RULES_WORDS = `这个生物还没有自己的行为。回到「工程总览」${WORDS.tell}，想让它在游戏里怎么样。`
const BUSY_QUIET_MS = 300
const IGNORED_FLASH_MS = 600

function StudioApp() {
  const [splashLine, setSplashLine] = createSignal<string>(pickSplash())
  const [splashPops, setSplashPops] = createSignal(false)
  const mining = createMining()
  const [page, setPage] = createSignal<Page>("home")
  const [resourceTab, setResourceTab] = createSignal<ResourceTab>("imports")
  const [resourcesFromSettings, setResourcesFromSettings] = createSignal(false)
  const [entries, setEntries] = createSignal<{ directory: string; project: Project }[]>([])
  const [allProjects, setAllProjects] = createSignal(false)
  // The title falls into place when Studio starts, like the game's: coming back to this page later it is simply there.
  const [logoDown, setLogoDown] = createSignal(logoHasFallen.done)
  logoHasFallen.done = true
  createEffect(() => {
    if (page() !== "home") setLogoDown(true)
  })
  const logoFalls = () => !logoDown() && page() === "home"
  const [openingWays, setOpeningWays] = createSignal(false)
  const [view, setView] = createSignal<StudioView | null>(null)
  const [settings, setSettings] = createSignal(SettingsSchema.parse({}))
  const [connection, setConnection] = createSignal<PublicConnection>()
  const [mcp, setMcp] = createSignal<McpConnectionStatus>()
  const [connectionOpen, setConnectionOpen] = createSignal(false)
  const [inspection, setInspection] = createSignal<{ id: string; nonce: number } | null>(null)
  const [leftOpen, setLeftOpen] = createSignal(shelfOpen(localStorage, SHELF_STORE, window.innerWidth, 1280))
  const [presenceBanner, setPresenceBanner] = createSignal<"disconnected" | "idle" | "restored" | null>(null)
  const [bannerTask, setBannerTask] = createSignal<string | null>(null)
  const checkPresence = async () => { setMcp(await window.studio.getMcpStatus()); setToast("已重新检测连接") }
  const copyPresence = async () => { await window.studio.copyMcpHandoff({ ...(view() ? { projectId: view()!.project.id } : {}) }); setToast("已复制起步说明") }
  // By value: the connection is read every 1.5 s, and a state that has not changed is not news. Otherwise 「再等等」 comes straight back, and 「重新连上了」 is gone at the next read.
  const presenceState = createMemo(() => mcp()?.state)
  createEffect(on(presenceState, (state, before) => {
    if (!state) return
    if (state === "disconnected" || state === "idle") { setBannerTask(mcp()?.task ?? null); setPresenceBanner(state); return }
    if (before === "disconnected" && ["connected", "working", "idle"].includes(state)) { setPresenceBanner("restored"); return }
    setPresenceBanner(null)
  }))
  createEffect(() => {
    if (presenceBanner() !== "restored") return
    const timer = window.setTimeout(() => setPresenceBanner(null), MCP_PRESENCE.restored)
    onCleanup(() => window.clearTimeout(timer))
  })
  onMount(() => {
    const resize = () => setLeftOpen(shelfOpen(localStorage, SHELF_STORE, window.innerWidth, 1280))
    window.addEventListener("resize", resize)
    onCleanup(() => window.removeEventListener("resize", resize))
  })
  // A project an outside AI made while the person was busy elsewhere: the bar offers it (see `made-project.ts`).
  const [madeOffer, setMadeOffer] = createSignal<{ id: string; name: string } | null>(null)
  const [externalDrafts, setExternalDrafts] = createSignal<Record<string, ModuleDocument>>({})
  const [externalPercentages, setExternalPercentages] = createSignal<Record<string, number | null>>({})
  // Declared before anything that reads it while the window is first drawn: a value read before its line is an
  // exception at start, and the whole window stays blank.
  const [environment, setEnvironment] = createSignal<Awaited<ReturnType<StudioApi["environment"]>>>()
  const external = () => connection()?.mode === "mcp"
  // Read again each time the status is polled, so "there" ends by itself some time after the last call.
  const mcpShown = createMemo(() => {
    const status = mcp()
    return status && { ...status, connected: outsidePresent(status, Date.now()) }
  })
  // The project 个人设置 was opened from (see `settingsOrigin`): the title bar, the way back and the hand-off's project all follow it, not
  // whatever project is still loaded after a visit to the home page.
  const [settingsFrom, setSettingsFrom] = createSignal<{ id: string; name: string } | null>(null)
  createEffect(
    on(
      page,
      (now, before) => {
        if (now !== "profile" || (before === "resources" && resourcesFromSettings())) return
        const open = view()
        setSettingsFrom(settingsOrigin({ previousPage: before, project: open && { id: open.project.id, name: open.project.name } }))
      },
      { defer: true },
    ),
  )
  const settingsWay = () => settingsBack(settingsFrom())
  const chip = createMemo(() => connectionChip({ external: external(), mcp: mcp(), aiConfigured: !!environment()?.aiConfigured, advanced: advanced(), now: Date.now() }))
  const saveConnection = async (input: SaveConnectionInput) => {
    setConnection(await window.studio.saveConnection(input))
    await Promise.all([window.studio.environment().then(setEnvironment), window.studio.getMcpStatus().then(setMcp)])
  }
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [toast, setToast] = createSignal("")
  const [search, setSearch] = createSignal("")
  const [name, setName] = createSignal("")
  // What the person wrote under 高级; null while the id still follows the name.
  const [modId, setModId] = createSignal<string | null>(null)
  const [modIdError, setModIdError] = createSignal("")
  const [createMore, setCreateMore] = createSignal(false)
  const [location, setLocation] = createSignal<{ token: string; label: string } | null>(null)
  // What the new project is set up for (2026-10-08): the catalogue of game targets, the one picked, the mods picked
  // before the project exists, and what Java the create page's card found. Folded into one line unless asked for.
  const [catalogue, setCatalogue] = createSignal<Awaited<ReturnType<StudioApi["getTargets"]>>>()
  const targets = () => catalogue()?.targets ?? []
  const [targetId, setTargetId] = createSignal("")
  const [setupOpen, setSetupOpen] = createSignal(false)
  const [pendingMods, setPendingMods] = createSignal<PendingMod[]>([])
  const [createJava, setCreateJava] = createSignal<JavaReport>()
  const createTarget = () => targets().find((target) => target.id === targetId())
  // The open project's game target as the catalogue names it; undefined until the catalogue is read.
  const projectTarget = () => targets().find((target) => target.id === view()?.project.target)
  const [modelPrompt, setModelPrompt] = createSignal("")
  const [initialModelPrompt, setInitialModelPrompt] = createSignal("")
  const modelPromptDirty = () => modelPrompt().trim() !== initialModelPrompt().trim()
  const resetModelPrompt = (value = "") => batch(() => {
    setInitialModelPrompt(value)
    setModelPrompt(value)
  })
  const [entityModal, setEntityModal] = createSignal(false)
  const [entityName, setEntityName] = createSignal("")
  const [entityNameMissing, setEntityNameMissing] = createSignal(false)
  const [projectNameMissing, setProjectNameMissing] = createSignal(false)
  const [active, setActive] = createSignal<{ projectId: string; jobId: string } | null>(null)
  const [job, setJob] = createSignal<Job | null>(null)
  const [jobsEnded, setJobsEnded] = createSignal(0)
  const [imported, setImported] = createSignal<Awaited<ReturnType<StudioApi["chooseImport"]>>>(null)
  const [category, setCategory] = createSignal<ConceptionEntry["kind"]>("entity")
  const [entryId, setEntryId] = createSignal<string | null>(null)
  const [modelProgress, setModelProgress] = createSignal<ModelProgress | null>(null)
  const selectedEntry = () => view()?.project.conception.entries.find((entry) => entry.id === entryId())
  const [editorDirty, setEditorDirty] = createSignal(false)
  const [contentDirty, setContentDirty] = createSignal(false)
  const [conflict, setConflict] = createSignal(false)
  const [navOpen, setNavOpen] = createSignal(false)
  const [buildOpen, setBuildOpen] = createSignal(false)
  const [module, setModule] = createSignal<ModuleKind>("model")
  const [assetId, setAssetId] = createSignal<string | null>(null)
  // The field of a thing's form a finding's button asked for: the form opens on its edit tab and focuses it.
  const [assetField, setAssetField] = createSignal<{ field: string; nonce: number } | null>(null)
  // A finding's button pressed in the build panel: the overview takes it up once it is on screen (`ProjectAssets` `jump`).
  const [jump, setJump] = createSignal<{ target: FindingTarget; nonce: number } | null>(null)
  // A field of 「模组信息」 a link asked for.
  const [infoField, setInfoField] = createSignal<{ field: string; nonce: number } | null>(null)
  let pressed = 0
  const [runs, setRuns] = createSignal<ProjectRun[]>([])
  const [offerVersion,setOfferVersion]=createSignal(0)
  const [reviewCopiedFor,setReviewCopiedFor]=createSignal("")
  const offer = createMemo(()=>{
    offerVersion()
    return page()==="overview" && view() ? reviewOffer(connection(),view()!.project,runs(),key=>localStorage.getItem(key)==="1") : null
  })
  const answerReview = async (enable:boolean) => {
    const shown=offer(), conn=connection()
    if (!shown || !conn) return
    if (enable) {
      await saveConnection({...editableConnection(conn),review:true})
      setReviewCopiedFor(view()!.project.id)
    }
    localStorage.setItem(shown.key,"1")
    setOfferVersion(n=>n+1)
  }
  const selectedAsset = () => view()?.project.workspace.assets.find((asset) => asset.id === assetId()) ?? null
  const running = () => runs().some((run) => ["planning", "running"].includes(run.state))
  const [inside, setInside] = createSignal<InsideTab|null>(null)
  const openModule = async (kind: ModuleKind, asset?: WorkspaceAsset, field?: string) => {
    if (page() === "asset" && (editorDirty() || contentDirty()) && !(await ask({ ...UNSAVED, text: "这里写的还没有交出去。放弃这些修改，换到另一样东西？" }))) return
    const soundTarget = asset?.document.kind === "entity" && soundDestination()?.entity === asset.document.model_asset_id
    if (!(await navigate("asset"))) return
    setContentDirty(false)
    // Before the page for this thing is made, so it is made already knowing which field to open.
    setAssetField(field ? { field, nonce: ++pressed } : null)
    setInside(soundTarget ? "sounds" : null)
    setModule(kind)
    setAssetId(asset?.id ?? null)
  }
  const submitRun = async (prompt: string, kind?: ModuleKind) => {
    if (busy() || active() || running()) return ignoredClick()
    setBusy(true)
    setError("")
    await window.studio
      .startProjectRun({
        projectId: current().project.id,
        expectedRevision: current().project.revision,
        prompt,
        module: kind,
        assetId: kind ? (assetId() ?? undefined) : undefined,
      })
      .then((run) => {
        setRuns((values) => [run, ...values])
        setContentDirty(false)
      })
      .finally(() => setBusy(false))
  }
  const cancelRun = async (runId: string) => {
    const result = await window.studio.cancelProjectRun({ projectId: current().project.id, runId })
    setRuns((values) => values.map((run) => (run.id === result.id ? result : run)))
  }
  // The overview page stores plans and has content made without handing back a view, so read the project again.
  const syncProject = async () => {
    const next = await window.studio.openProject(current().project.id).catch(() => null)
    if (next && view()?.project.id === next.project.id && !editorDirty() && !contentDirty()) apply(next)
  }
  const saveItem = async (item: Item) => {
    const project = current().project
    const asset = project.workspace.assets.find((value) => value.id === item.id && value.module === "item")
    const saved = asset ? await saveHand(window.studio, project, "item", asset.id, { ...asset.document, model_asset_id: item.model_asset_id, display: item.display }, ["模型", "持握姿势"], () => item.id, asset.revision) : null
    if (saved && !saved.ok) throw new Error(saved.issues.map((issue) => issue.message).join("\n"))
    const next = saved?.ok ? saved.view : await window.studio.saveContent({
      projectId: project.id,
      expectedRevision: project.revision,
      content: { blocks: project.blocks, items: project.items.map((value) => value.id === item.id ? item : value), recipes: project.recipes, logic: project.logic },
    })
    if (view()?.project.id === project.id) {
      apply(next)
    }
    notify("物品持握设置已保存")
  }
  const annotateAsset = async (prompt: string, annotation: ModelAnnotationInput) => {
    const projectId = current().project.id
    await window.studio.redoAsset({ projectId, itemId: annotation.targetId, feedback: prompt, annotation })
    const next = await window.studio.openProject(projectId)
    if (view()?.project.id === projectId) {
      apply(next)
    }
    notify("标注已交给模型修改任务")
  }
  const annotationJobs = new Map<string, { resolve: () => void; reject: (reason: Error) => void }>()
  onCleanup(() => annotationJobs.forEach((completion) => completion.reject(new Error("页面已关闭，标注任务可在任务列表查看。"))))
  const annotateModel = async (prompt: string, annotation: ModelAnnotationInput) => {
    if (external()) return annotateAsset(prompt, annotation)
    const projectId = current().project.id
    const result = await window.studio.generateModel({ projectId, expectedRevision: annotation.projectRevision, prompt, annotation })
    const completed = new Promise<void>((resolve, reject) => annotationJobs.set(result.jobId, { resolve, reject }))
    setModelProgress(null)
    setJob(null)
    setActive({ projectId, jobId: result.jobId })
    return completed
  }
  // Where a tile of the overview opens: the same editors the project tree leads to. Undefined when it has none.
  // What an outside AI has shown of the things it is making, matched to the overview by what each task makes.
  const overviewDrafts = createMemo(() =>
    (runs()[0]?.tasks ?? []).flatMap((task) =>
      externalDrafts()[task.id]
        ? [{ kind: task.module, title: task.title, asset_id: task.asset_id, document: externalDrafts()[task.id], progress: externalPercentages()[task.id] ?? null }]
        : [],
    ),
  )
  const itemEditor = (item: OverviewItem, field?: string) => {
    const asset = current().project.workspace.assets.find((value) => value.id === item.asset_id)
    if (asset?.document.kind==="entity" && field==="replace_file") {
      const entityId=asset.document.model_asset_id
      return ()=>void replaceModelFile(entityId)
    }
    if (asset) return () => void openModule(asset.module, asset, field)
    // Content saved before assets existed is listed as `kind:id`.
    const legacy = item.asset_id ? undefined : item.id.split(":")[1]
    if (!legacy) return undefined
    if (current().project.entities.some((value) => value.id === legacy)) return () => void openEntity(legacy)
    const entry = external() ? undefined : libraryEntries().find((value) => value.id === legacy)
    return entry ? () => void openEntry(entry) : undefined
  }
  const categoryCount = (kind: ConceptionEntry["kind"]) =>
    kind === "entity"
      ? current().project.entities.length
      : libraryEntries().filter((entry) => entry.kind === kind).length
  const current = () => view()!
  const inModelWorkspace = () => ["model", "texture", "animation"].includes(page())
  const entity = () => view()?.project.entities.find((entity) => entity.id === view()?.entity_id)
  // A creature's runtime rules asset is its "behaviour" step; this is the creature when one is open.
  const runtimeEntity = () =>
    page() === "asset" && selectedAsset() ? runtimeAssetEntity(current().project, selectedAsset()!) : undefined
  const stepEntity = () => runtimeEntity() ?? (inModelWorkspace() || page() === "behavior" ? entity() : undefined)
  const runtimeFor = (entityId: string) => (view() ? entityRuntimeAsset(current().project, entityId) : undefined)
  // The older 「模组构想」 route (its world brief, its lists, its brief per thing and per behaviour) builds nothing
  // playable. It is offered only where leaving it out would hide saved work: a project that has something there,
  // to a person who asked for 高级, working with Studio's own AI (the pages ask that AI).
  const legacyShown = () => !!view() && !external() && advanced() && legacyConception(current().project.conception)
  const insideSource = createMemo(()=>{
    const id=stepEntity()?.id
    const doc=id ? runtimeFor(id)?.document : null
    return doc?.kind==="entity" ? {project:current().project,doc} : null
  },null,{equals:(a,b)=>a?.project.id===b?.project.id && a?.project.revision===b?.project.revision && a?.doc.model_asset_id===b?.doc.model_asset_id})
  const insideData = createMemo(()=>{
    const source=insideSource()
    return source ? creatureInside(source.project,source.doc) : null
  })
  const chooseInside = async (tab:InsideTab) => {
    const asset=runtimeFor(stepEntity()!.id)
    if(!asset) return
    if(!runtimeEntity() || contentDirty() || editorDirty()) await openModule("entity",asset)
    if(page()==="asset" && assetId()===asset.id && !contentDirty() && !editorDirty()) setInside(tab)
  }
  const openBehavior = (entityId: string) => {
    const runtime = runtimeFor(entityId)
    if (runtime) void openModule("entity", runtime)
    else if (legacyShown()) void confirmModel()
  }
  const openAppearance = async (entityId: string, mode: "model" | "animation") => {
    if (current().entity_id === entityId && current().model) return void navigate(mode)
    await openEntity(entityId)
    if (mode === "animation" && page() === "model") navigate("animation")
  }
  async function replaceModelFile(id:string) {
    await openAppearance(id,"model")
    if (page()==="model") requestAnimationFrame(()=>document.querySelector<HTMLInputElement>(".model-import input[type=file]")?.click())
  }
  // A clock for how long a running stage has taken; a quarter of a minute is fine-grained enough for "已经过了 N 分钟".
  const [clock, setClock] = createSignal(Date.now())
  {
    const tick = window.setInterval(() => setClock(Date.now()), 15_000)
    onCleanup(() => window.clearInterval(tick))
  }
  /** Since when the job has been at work: after waiting for the runtime environment, from its turn (`turned_at`), else from its start. */
  const jobSince = () => {
    const checkpoint = job()?.checkpoint
    const turned = checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) && "turned_at" in checkpoint ? String(checkpoint.turned_at) : ""
    return turned || job()!.created_at
  }
  const rawDetail = () => {
    const checkpoint = job()?.checkpoint
    return checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) && "detail" in checkpoint
      ? String(checkpoint.detail)
      : ""
  }
  // broad7–9: the job's detail is only the newest piece of output, so the line saying the scene's game is open was replaced by the game's
  // next line before the drawer read it. The service keeps a mark (in_game_at) once that line was written; from then on it is said here.
  const marked = (mark: "in_game_at" | "at_title_at") => {
    const checkpoint = job()?.checkpoint
    // Only while the job is going: the mark outlives a job that stopped without writing an end, and then says what is no longer so.
    return ["queued", "running"].includes(job()?.state ?? "") && !!checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) && mark in checkpoint && !!(checkpoint as Record<string, unknown>)[mark]
  }
  // The newest thing said about the game being open: the player in the world, else (the game loaded, no world yet) its title screen.
  const openLine = (detail: string) =>
    marked("in_game_at") || detail.includes(SCENE_WORDS.in_game) ? SCENE_WORDS.in_game : marked("at_title_at") || detail.includes(SCENE_WORDS.at_title) ? SCENE_WORDS.at_title : ""
  const jobDetail = () => {
    const detail = rawDetail()
    const state = job()?.state
    if (state && state !== "queued" && state !== "running") return endedDetail(state, detail)
    const line = openLine(detail)
    return line && !detail.trimEnd().endsWith(line) ? `${detail}\n${line}` : detail
  }
  // Which words 「高级」 says it added: what is on screen decides (see `advancedLine`).
  const advancedPlace = (): AdvancedPlace => (page() === "overview" ? "overview" : inModelWorkspace() || page() === "behavior" || page() === "asset" || page() === "entry" ? "editor" : "other")
  const projectOpen = () => !!view() && !["home", "profile", "create", "resources"].includes(page())
  const errorMessage = (cause: unknown) =>
    cause instanceof Error
      ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
      : String(cause)
  const notifyTimer = { id: 0 }
  const notify = (message: string) => {
    setToast(message)
    // An earlier one still counting down must not take this one away with it.
    window.clearTimeout(notifyTimer.id)
    notifyTimer.id = window.setTimeout(() => setToast(""), 3500)
  }
  createEffect(() => setCalmSetting(!!settings().reducedMotion))
  createEffect(() => setSoundSetting(!!settings().sounds))
  // A button pressed is the one sound that needs no asking at each place: it is where every press goes through.
  const clickSound = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("button")) playSound("click")
  }
  document.addEventListener("click", clickSound)
  onCleanup(() => document.removeEventListener("click", clickSound))
  const refresh = () => window.studio.listProjects().then(setEntries)
  // A press while something is still being handled is not carried out, and the title bar says so instead of nothing happening.
  const [busyShown, setBusyShown] = createSignal(false)
  const [ignored, setIgnored] = createSignal(false)
  const ignoredTimer = { id: 0 }
  function ignoredClick() {
    setIgnored(true)
    window.clearTimeout(ignoredTimer.id)
    ignoredTimer.id = window.setTimeout(() => setIgnored(false), IGNORED_FLASH_MS)
  }
  createEffect(() => {
    if (!busy()) return setBusyShown(false)
    const timer = window.setTimeout(() => setBusyShown(true), BUSY_QUIET_MS)
    onCleanup(() => window.clearTimeout(timer))
  })
  async function perform<T>(operation: () => Promise<T>, applied?: (value: T) => void) {
    if (busy()) return ignoredClick()
    setBusy(true)
    setError("")
    return operation()
      .then((value) => {
        applied?.(value)
        return value
      })
      .catch((cause) => {
        // Closing a save dialog is the person changing their mind, not a failure (the main process says "已取消…导出。").
        if (!(cause instanceof Error && /已取消\S*导出/.test(cause.message))) setError(errorMessage(cause))
        return undefined
      })
      .finally(() => setBusy(false))
  }
  function apply(next: StudioView) {
    if (view()?.project.id !== next.project.id) return
    batch(() => {
      if (view()?.entity_id !== next.entity_id) resetModelPrompt()
      setView(next)
    })
    setEntries((entries) => entries.some((entry) => entry.project.id === next.project.id)
      ? entries.map((entry) => entry.project.id === next.project.id ? { ...entry, project: next.project } : entry)
      : [{ directory: next.directory, project: next.project }, ...entries])
  }
  const shownUpgrades = new Set<string>()
  function activate(next: StudioView) {
    if (next.open_notice && !shownUpgrades.has(next.project.id)) {
      shownUpgrades.add(next.project.id)
      notify(next.open_notice)
    }
    batch(() => {
      setInspection(null)
      setAssetId(null)
      setAssetField(null)
      setInside(null)
      setEntryId(null)
      setCategory("entity")
      setJump(null)
      setInfoField(null)
      setBuildOpen(false)
      setNavOpen(false)
      setConflict(false)
      setEditorDirty(false)
      setContentDirty(false)
      resetModelPrompt()
      setView(next)
      apply(next)
    })
  }
  // Answers whether the page is now the one asked for. With nothing unsaved it has already changed when this returns;
  // otherwise the person is asked first, in the app's own dialog.
  function navigate(next: Page): Promise<boolean> {
    if (next === page()) {
      setNavOpen(false)
      return Promise.resolve(true)
    }
    if (["model", "texture", "animation"].includes(page()) && ["model", "texture", "animation"].includes(next)) {
      setPage(next)
      setNavOpen(false)
      return Promise.resolve(true)
    }
    const go = () => batch(() => {
      setInspection(null)
      resetModelPrompt()
      setEditorDirty(false)
      setContentDirty(false)
      setError("")
      setPage(next)
      setNavOpen(false)
      setBuildOpen(false)
      return true
    })
    if (!editorDirty() && !contentDirty()) return Promise.resolve(go())
    return ask({ ...UNSAVED, text: "离开这一页，没保存的修改就没有了。" }).then((yes) => yes && go())
  }
  // 「在制作现场看全部」, pressed anywhere: the page is opened; the floor itself takes the thing and round that were asked for.
  createEffect(on(floorAsked, () => projectOpen() && void navigate("commands"), { defer: true }))
  // The other way: 「去验收」 / 「去挑想法」 on 制作现场 leads to the overview, where the card (or the cards of ideas) is.
  createEffect(on(cardAsked, () => projectOpen() && void navigate("overview").then((yes) => yes || clearCardTarget()), { defer: true }))
  async function openProject(id: string) {
    await perform(
      () => window.studio.openProject(id),
      (next) => {
        activate(next)
        setPage("overview")
      },
    )
  }
  // An outside AI made this project (or the bar's press): open it as any list entry would, asking first when something here is unsaved.
  async function openMade(id: string) {
    if ((editorDirty() || contentDirty()) && !(await ask({ ...UNSAVED, text: MADE_WORDS.unsaved }))) return
    setMadeOffer(null)
    await perform(
      () => window.studio.openProject(id),
      (next) => {
        activate(next)
        setPage("overview")
      },
    )
  }
  // The status is polled while an outside AI is the connection. A project it made is news once: the list is read again at once (it only
  // used to be read when the window opened, so a project made from outside never showed on the home page), and the window opens it or offers it.
  const handledMade = { key: "" }
  const madeSeen = createMemo(() => {
    const made = mcp()?.madeProject
    return made ? madeKey(made) : ""
  })
  createEffect(
    on(madeSeen, (key) => {
      if (!key) return
      const made = freshMade(mcp(), Date.now(), handledMade.key)
      if (!made) return
      handledMade.key = madeKey(made)
      void refresh()
      if (view()?.project.id === made.id && projectOpen()) return
      if (followMade({ page: page(), unsaved: editorDirty() || contentDirty(), working: busy() || !!active() }) === "open") void openMade(made.id)
      else setMadeOffer({ id: made.id, name: made.name })
    }),
  )
  // The bar has done its work once that project is on screen, by whatever way it was opened.
  createEffect(() => {
    if (madeOffer() && projectOpen() && view()?.project.id === madeOffer()!.id) setMadeOffer(null)
  })
  // The list is read whenever the home page is shown, so it is never older than the last time the person looked.
  createEffect(on(page, (now) => now === "home" && void refresh(), { defer: true }))
  /** Creates the project the create page describes; the title screen's name field comes here too, with every other choice left at its default. */
  function submitCreate() {
    if (!name().trim()) return setProjectNameMissing(true)
    setProjectNameMissing(false)
    const id = chosenModId(name(), modId())
    const problem = modIdProblem(id)
    setModIdError(problem)
    if (problem) {
      // A name that makes no usable mod ID is the one thing to settle on the create page.
      if (page() !== "create") void navigate("create")
      return setCreateMore(true)
    }
    void perform(
      () =>
        window.studio.createProject({
          name: name(),
          modId: id,
          description: "",
          empty: true,
          locationToken: location()?.token,
          targetId: targetId() || undefined,
        }),
      (next) => {
        const wanted = pendingMods()
        activate(next)
        setPage("overview")
        if (wanted.length) void addPendingMods(next.project.id, wanted)
      },
    )
  }
  /** The title screen: a name is all it takes to start; everything else keeps the create page's defaults. */
  function startFromTitle(typed: string) {
    resetCreate()
    if (!typed.trim()) return void navigate("create")
    setName(typed.trim())
    submitCreate()
  }
  function newProject() {
    resetCreate()
    void navigate("create")
  }
  function resetCreate() {
    setProjectNameMissing(false)
    setName("")
    setModId(null)
    setModIdError("")
    setCreateMore(advanced())
    setLocation(null)
    // Read before, the catalogue gives the default at once; the first time, it is set when the catalogue arrives.
    setTargetId(catalogue() ? (defaultTarget(targets(), catalogue()!.chosen)?.id ?? "") : "")
    setSetupOpen(advanced())
    setPendingMods([])
    setCreateJava(undefined)
    void readTargets()
  }
  // Without the catalogue (an older main process, or it could not be read) the create page keeps main's own default.
  function readTargets() {
    return loadTargets().then(
      (value) => {
        setCatalogue(value)
        if (!targetId()) setTargetId(defaultTarget(value.targets, value.chosen)?.id ?? "")
      },
      () => undefined,
    )
  }
  // The mods picked on the create page, added one after another once the project exists; what was not added is
  // said where it stays readable, since each line is a reason the person may want to act on.
  async function addPendingMods(projectId: string, wanted: readonly PendingMod[]) {
    notify(SETUP_WORDS.addingLater(wanted.length))
    const skipped: string[] = []
    let added = 0
    for (const mod of wanted) {
      const result = await window.studio
        .addModrinthMod({ projectId, modrinthId: mod.modrinthId })
        .catch((cause: unknown) => ({ added: [], skipped: [{ name: mod.title, why: plainError(cause, SETUP_WORDS.addFailed, advanced()) }] }))
      added += result.added.length
      skipped.push(...result.skipped.map((value) => SETUP_WORDS.skippedLine(value.name, value.why)))
    }
    if (skipped.length) setError(skipped.join(" "))
    else notify(SETUP_WORDS.addedLater(added))
  }
  async function openExistingProject() {
    if ((editorDirty() || contentDirty()) && !(await ask({ ...UNSAVED, text: "打开另一个工程，这里没保存的修改就没有了。" }))) return
    await perform(
      () => window.studio.chooseExistingProject(),
      (next) => {
        if (!next) return
        activate(next)
        setPage("commands")
      },
    )
  }
  function start(action: () => Promise<{ jobId: string }>, projectId = current().project.id, replacesEdits = true) {
    return perform(action, (result) => {
      // Unsaved edits belong to the project on screen; a job started for another project (the chain going on) leaves them be. A pack is made from what is saved
      // and leaves the edits on screen as they are: still not saved.
      if (replacesEdits && view()?.project.id === projectId) setEditorDirty(false)
      setJob(null)
      setActive({ projectId, jobId: result.jobId })
    })
  }
  // 「构建并试玩」 in one press. The decision is `chainStep`; here its jobs are started and their ends read.
  const [chain, setChain] = createSignal<Chain | null>(null)
  const [scene, setScene] = createSignal<SceneInfo | null>(null)
  // Which version the newest pack is and which one the press in progress works from, and which downloads this computer already has (`getBuildPanel`).
  const [panel, setPanel] = createSignal<BuildPanel | null>(null)
  const shownChain = () => (chain()?.projectId === view()?.project.id ? chain() : null)
  const chainBusy = () => !!chain() && !chain()!.stop
  const readScene = async (projectId: string) => {
    const next = await window.studio.getScene({ projectId }).catch(() => null)
    if (view()?.project.id === projectId) setScene(next)
    return next
  }
  // The chain belongs to the project it was pressed in. It goes on from there whichever project is on screen when a stage ends
  // (the person may have closed the drawer and opened another project); only a deleted project drops it.
  const chainDeps: ChainDeps = {
    readScene,
    latestBuildJobId: async (projectId) => (view()?.project.id === projectId ? current().latest_build_job_id : (await window.studio.openProject(projectId)).latest_build_job_id),
    readMaking: async (projectId) => (await window.studio.getProjectOverview({ projectId })).production.making,
    ready: async (projectId) => {
      const read = await window.studio.getBuildPanel({ projectId })
      return { ...read.ready, ...(read.whole ? { whole: { build: read.whole.build, play: read.whole.play } } : {}), ...(read.cold ? { cold: { check: read.cold.check, play: read.cold.play } } : {}) }
    },
    blocked: () => busy() || !!active(),
    start: async (projectId, stage, jobId) =>
      (await start(() => (stage === "build" ? window.studio.buildProject({ projectId }) : stage === "check" ? window.studio.startSceneCheck({ projectId, jobId }) : window.studio.startScenePlay({ projectId, jobId })), projectId, false)) ?? undefined,
    error,
    show: setChain,
  }
  const advanceChain = (base: Chain, choice: ChainFacts["choice"]) => advanceChainFor(base, choice, chainDeps)
  /** The press itself: the drawer opens and the chain starts. `want` "jar" stops once there is a file. */
  async function playNow(want: ChainFacts["want"] = "play") {
    if (!view()) return setBuildOpen(true)
    // A pack is made from what is saved. Edits on screen would not be in it, and the person thinks they would.
    if (!chainBusy() && (editorDirty() || contentDirty()) && !(await ask({ ...UNSAVED, text: "打包用的是保存过的版本，这些修改不会进包。", confirm: "用保存过的版本打包" }))) return
    setBuildOpen(true)
    // Pressed again while it is under way: the drawer opening is the answer, nothing is started twice.
    if (chainBusy()) return
    const base: Chain = { projectId: current().project.id, want, running: null, marks: {}, ended: null, stop: null, error: "", lines: [], findings: 0, missing: [], making: 0 }
    if (busy() || active()) return setChain({ ...base, stop: "busy" })
    setChain(base)
    void advanceChain(base, null)
  }
  // 「导出模组文件」: only a copy of a finished pack's jar, so it needs neither the game closed nor any check or game run first. With a pack of the project as it is, it is saved at once;
  // without one it packs (the same "只打包" press, which never checks or opens anything) and saves what that makes. The flag below is that second case waiting for its pack.
  const [exportAfterPack, setExportAfterPack] = createSignal<string | null>(null)
  const saveJar = (projectId: string, jobId: string) => perform(() => window.studio.exportJar({ projectId, jobId }), (result) => notify(`已导出：${result.path}`))
  function revealJar() {
    const jobId = current().latest_build_job_id
    if (jobId) void perform(() => window.studio.revealBuildJar({ projectId: current().project.id, jobId }))
  }
  function exportJarNow() {
    if (exportState().off) return
    const jobId = current().latest_build_job_id
    if (jobId) return void saveJar(current().project.id, jobId)
    playNow("jar")
    setExportAfterPack(current().project.id)
  }
  createEffect(() => {
    const projectId = exportAfterPack()
    const run = chain()
    if (!projectId || run?.projectId !== projectId || !run.stop || busy()) return
    // Every stop that asks the person something (the AI is still making things, the pack went stale) keeps the wait; any other end of the press is the end of it.
    if (run.stop === "built" && run.build) {
      setExportAfterPack(null)
      void saveJar(projectId, run.build)
    } else if (!chainOwnsNextAction(run.stop)) setExportAfterPack(null)
  })
  // What is running, as the export button needs to know it: nothing, a pack being made, or something else (the game, a check); "unknown" until the running job has been read.
  const runningKind = () => (!active() ? "none" : job()?.id !== active()!.jobId ? "unknown" : job()!.kind === "build" ? "build" : "other")
  const exportState = () => exportButton({ busy: busy(), running: runningKind(), hasPack: !!current().latest_build_job_id, pressing: chainBusy(), savingAfterPack: !!exportAfterPack() })
  // 「取消这一次，重新打包并打开」: the press that is getting the game ready works from a pack that is out of date. Stopping it and pressing again is one act for the
  // person; what was downloaded is kept by the files themselves (each is put in place only once whole), so the new press goes on from there. It waits here until the
  // old job has really ended and the chain stands still, so two presses never overlap.
  const [packAgain, setPackAgain] = createSignal<ChainFacts["want"] | null>(null)
  createEffect(() => {
    const want = packAgain()
    if (!want || busy() || active() || chain()?.stop !== "canceled") return
    setPackAgain(null)
    playNow(want)
  })
  async function cancelAndPackAgain() {
    const run = chain()
    if (!run?.running || !active()) return
    setPackAgain(run.want)
    const canceled = await perform(() => window.studio.cancelJob(active()!), setJob)
    if (canceled === undefined) setPackAgain(null)
  }
  /** A job ended (or was lost): when it is the chain's, the chain goes on from how it ended. */
  function chainEnded(jobId: string, state: ChainEnd, ended: Job | null, lost = "") {
    const run = chain()
    if (!run?.running || run.running.jobId !== jobId) return
    const output = ended?.kind === "scene_check" && ended.output && typeof ended.output === "object" && !Array.isArray(ended.output) ? (ended.output as { lines?: unknown; report?: { findings?: unknown } }) : null
    const lines = Array.isArray(output?.lines) ? output.lines.map(String) : []
    const findings = Array.isArray(output?.report?.findings) ? output.report.findings.length : 0
    void advanceChain({ ...run, running: null, marks: { ...run.marks, [run.running.stage]: state }, ended: { stage: run.running.stage, state, ...(jobWentStale(ended) ? { stale: true } : {}), ...(jobCrashed(ended) ? { crashed: true } : {}) }, error: ended?.error ?? lost, lines, findings, go: jobTarget(ended), crash: jobCrashDetail(ended) }, null)
  }
  const chainStageWords = (run: Chain, stage: ChainStage) => {
    if (run.running?.stage === stage) return inGame(stage, jobDetail()) ? CHAIN_WORDS.gameOpen : JOB_STATE_WORDS[job()?.id === run.running.jobId ? job()!.state : "queued"]
    const mark = run.marks[stage]
    // A play that ended in a crash is not 「没做成」 like one that could not start: it is said as what it was.
    if (stage === "play" && mark === "failed" && run.ended?.crashed) return CRASH_WORDS.mark
    // A pack that was reused is said as the version it is, the same words as the line on top (`versionView`).
    return mark === "skipped" ? (stage === "build" ? skippedBuildWords(panel()?.used ?? null) : CHAIN_WORDS.skipped[stage]) : mark ? JOB_STATE_WORDS[mark] : "还没开始"
  }
  const chainStopWords = (run: Chain) => {
    if (run.stop === "found") return CHAIN_WORDS.stop.found(run.findings)
    if (run.stop === "making") return CHAIN_WORDS.stop.making(run.making)
    if (run.stop === "build_stale") {
      // A build cut off by a save kept nothing; one that finished well is merely out of date. Both are fixed the same way.
      const cut = run.ended?.stage === "build" && run.ended.state !== "completed"
      if (run.making) return cut ? CHAIN_WORDS.stop.build_stale_failed_making(run.making) : CHAIN_WORDS.stop.build_stale_making(run.making)
      // A pack that finished and is out of date says what it lacks, in the same words as the version line (`VERSION_WORDS.later`); before that is read, the plain sentence.
      const used = panel()?.used
      return cut ? CHAIN_WORDS.stop.build_stale_failed : used && !used.current ? VERSION_WORDS.later(used) : CHAIN_WORDS.stop.build_stale
    }
    if (run.stop === "played" && panel()?.used && !panel()!.used!.current) return CHAIN_WORDS.stop.played_older
    if (run.stop === "missing") return CHAIN_WORDS.missing(run.missing)
    return run.stop === "busy" ? CHAIN_WORDS.busy : run.stop ? CHAIN_WORDS.stop[run.stop] : ""
  }
  // Which pack the panel is talking about, and what it lacks (`versionView`). The pack the press works from is only trusted once it is the one the answer is about.
  const version = createMemo(() => {
    const run = shownChain()
    const read = panel()
    const used = run && read && (read.used === null || read.used.job_id === run.build) ? read.used : undefined
    return versionView({
      used,
      latest: read ? read.latest : undefined,
      chain: run ? { running: run.running?.stage ?? null, stop: run.stop, want: run.want } : null,
      inGame: !!run?.running && inGame(run.running.stage, jobDetail()),
    })
  })
  // What a long wait shows under the stage that is running: the time, the real counter, and, when the counter stood still, that it did (`stageWait`).
  const stageWaitOf = (run: Chain, stage: ChainStage) => {
    const running = run.running
    if (running?.stage !== stage || job()?.id !== running.jobId) return null
    return stageWait({ stage, state: job()?.state, ms: clock() - Date.parse(jobSince()), detail: jobDetail(), checkpoint: job()?.checkpoint, ready: run.ready?.[stage], now: clock() })
  }
  // Read again whenever the drawer opens, the project changes or a job moves on: the licence line, the last check and the missing mods all come from here.
  const jobState = createMemo(() => job()?.state)
  const sceneProject = createMemo(() => (buildOpen() ? view()?.project.id : undefined))
  createEffect(() => {
    jobState()
    const projectId = sceneProject()
    if (projectId) void readScene(projectId)
  })
  // An outside AI may have packed the mod (build_project) since the project was read, and nothing of the window moves then: the drawer reads the project again when it
  // opens, so 「后台检查」 and 「打开测试场」 find that pack (the UI run of 2026-11-15 found them greyed after an outside build until the chain was pressed again).
  createEffect(on(sceneProject, (projectId) => (projectId ? void syncProject() : undefined)))
  // The packs' versions are read again when the drawer opens, when the project is saved (its revision moves: that is what makes a pack out of date), when a job moves on,
  // and when the press takes another pack. The newest answer wins; one for a project that is no longer shown is dropped.
  const panelAsk = { latest: 0 }
  // While Studio is fetching the game's files in the background (提前准备) the panel is asked again at every tick of the clock, so its line goes away when they are there.
  const [aheadLook, setAheadLook] = createSignal(0)
  createEffect(on(clock, () => panel()?.preparing && setAheadLook((value) => value + 1), { defer: true }))
  // And whenever main says the preparation changed (a step began or ended, a try failed, Java was installed): the panel is asked, and the Java line looks again, at that moment. Without this
  // a panel opened before the preparation began never showed it, and one that was showing "no Java found" kept saying so after Studio had installed one (round 21).
  const [aheadMoved, setAheadMoved] = createSignal(0)
  createEffect(() => {
    jobState()
    aheadLook()
    const projectId = sceneProject()
    const revision = view()?.project.revision
    const jobId = shownChain()?.build
    if (!projectId) return setPanel(null)
    const ask = ++panelAsk.latest
    void window.studio.getBuildPanel({ projectId, ...(jobId ? { jobId } : {}) }).then(
      (next) => {
        if (ask === panelAsk.latest && revision !== undefined) setPanel(next)
      },
      () => undefined,
    )
  })
  // 「模组信息」: one save for everything the mod says about itself. A refusal goes back to the page, which says it beside the fields.
  const saveModInfo = async (info: ModInfoInput) => {
    apply(await window.studio.saveModInfo({ projectId: current().project.id, expectedRevision: current().project.revision, info }))
    notify(INFO_WORDS.saved)
  }
  // The way to 「模组信息」 from anywhere (the overview, the build panel), on the field asked for when there is one.
  const openInfo = (field?: string) => {
    void navigate("info").then((yes) => yes && setInfoField(field ? { field, nonce: ++pressed } : null))
  }
  // A finding's button pressed anywhere (the build panel, a failure card): the card it names opens on the overview, which carries the press out once it has read the project.
  // Whatever lies over the overview is put away here, not left to `navigate`: that only closes the build drawer when the page actually changes, so a press made while the
  // overview was already the page opened the card underneath the drawer (broad18 r10). A refused move (unsaved work kept) leaves everything as it was.
  const goToTarget = (target: FindingTarget) => {
    void navigate("overview").then((yes) => {
      if (!yes) return
      setBuildOpen(false)
      setNavOpen(false)
      setJump({ target, nonce: ++pressed })
    })
  }
  // Home page, a project's own menu: its name, and moving it out of the list.
  const renameProject = async (entry: { project: Project }) => {
    const name = await askText({ title: "给工程改名", text: "只改显示的名字。游戏里认的模组 ID 不会变，存档和别的模组不受影响。", confirm: "改名", cancel: "不改", field: { label: "工程名称", value: entry.project.name, max: 120 } })
    if (!name || name === entry.project.name) return
    await perform(() => window.studio.renameProject({ projectId: entry.project.id, expectedRevision: entry.project.revision, name }), (next) => {
      if (view()?.project.id === next.project.id) setView(next)
      void refresh()
    })
  }
  const deleteProject = async (entry: { project: Project }) => {
    if (!(await ask({ title: `删除「${entry.project.name}」？`, text: "工程会被移进「已删除」文件夹，想找回来可以从那里拿", confirm: "删除", cancel: "不删" }))) return
    await perform(() => window.studio.deleteProject({ projectId: entry.project.id }), (result) => {
      if (view()?.project.id === entry.project.id) {
        setEditorDirty(false)
        setContentDirty(false)
        setChain(null)
        setView(null)
      }
      void refresh()
      notify(`已移进「已删除」文件夹：${result.moved}`)
    })
  }
  const saveConception = async (conception: Conception) => {
    const next = await window.studio.saveConception({
      projectId: current().project.id,
      expectedRevision: current().project.revision,
      conception,
    })
    apply(next)
    setContentDirty(false)
  }
  const saveEntry = async (entry: ConceptionEntry) => {
    const next = await window.studio.saveEntry({
      projectId: current().project.id,
      expectedRevision: current().project.revision,
      entry,
    })
    apply(next)
    setContentDirty(false)
  }
  const startAuthoring = async (operation: () => Promise<{ jobId: string; view: StudioView }>) => {
    if (busy() || active()) return ignoredClick()
    setBusy(true)
    setError("")
    await operation()
      .then((result) => {
        apply(result.view)
        setContentDirty(false)
        setJob(null)
        setActive({ projectId: result.view.project.id, jobId: result.jobId })
      })
      .catch((cause) => {
        setError(errorMessage(cause))
        throw cause
      })
      .finally(() => setBusy(false))
  }
  const openEntry = async (entry: ConceptionEntry) => {
    if ((editorDirty() || contentDirty()) && !(await ask({ ...UNSAVED, text: "打开另一样东西，这里没保存的修改就没有了。" }))) return
    setContentDirty(false)
    setEditorDirty(false)
    setEntryId(entry.id)
    setCategory(entry.kind)
    setNavOpen(false)
    // A creature's model page needs no stored entry (see `storesOnOpen`): opening it must not save the project.
    if (storesOnOpen(entry) && !current().project.conception.entries.some((value) => value.id === entry.id)) {
      const saved = await perform(
        () =>
          window.studio.saveEntry({
            projectId: current().project.id,
            expectedRevision: current().project.revision,
            entry,
          }),
        apply,
      )
      if (!saved) return
    }
    if (entry.kind === "entity" && entry.entity_id) {
      await perform(
        () => window.studio.selectEntity({ projectId: current().project.id, entityId: entry.entity_id! }),
        (next) => {
          apply(next)
          resetModelPrompt(next.model ? "" : entry.brief)
          setModelProgress(null)
          setPage("model")
        },
      )
      return
    }
    setPage("entry")
  }
  const makeEntry = (
    kind: ConceptionEntry["kind"],
    title: string,
    brief = "",
    entityId: string | null = null,
  ): ConceptionEntry => {
    const base = {
      id: crypto.randomUUID(),
      key: "",
      title,
      brief: brief || `描述${title}的外观与玩法。`,
      status: "draft" as const,
      entity_id: entityId,
      review: null,
      behavior_brief: "",
      behavior_review: null,
      model_confirmed_asset_id: null,
    }
    if (kind === "recipe")
      return {
        ...base,
        kind,
        recipe: {
          recipe_type: "crafting",
          input_names: Array(9).fill(""),
          output_name: title,
          output_names: [],
          count: 1,
          fuel: "",
          duration: "",
          intent: base.brief,
        },
      }
    return { ...base, kind }
  }
  const addContent = async () => {
    if (busy() || active()) return ignoredClick()
    if (category() === "entity") {
      setEntityName("")
      setEntityModal(true)
      return
    }
    const entry = makeEntry(category(), `新${contentNames[category()]}`)
    await perform(
      () =>
        window.studio.saveEntry({
          projectId: current().project.id,
          expectedRevision: current().project.revision,
          entry,
        }),
      (next) => {
        apply(next)
        setEntryId(entry.id)
        setPage("entry")
      },
    )
  }
  const openEntity = async (entityId: string) => {
    const target = current().project.entities.find((value) => value.id === entityId)!
    const stored = current().project.conception.entries.find((value) => value.entity_id === entityId)
    if (stored) {
      await openEntry(stored)
      return
    }
    // Opening a creature only looks at it: nothing is stored until the person writes something (see `openEntry`).
    await openEntry(makeEntry("entity", target.name, target.description, target.id))
  }
  const confirmModel = async () => {
    if (page() === "behavior" || !entity()?.model_asset_id) return
    if (busy() || active()) return ignoredClick()
    if ((editorDirty() || contentDirty()) && !(await ask({ ...UNSAVED, text: "接着去定行为，用的是已经保存的模型；这里没保存的修改就没有了。" }))) return
    const entry =
      current().project.conception.entries.find((value) => value.entity_id === entity()!.id) ??
      makeEntry("entity", entity()!.name, entity()!.description, entity()!.id)
    await perform(
      () =>
        window.studio.saveEntry({
          projectId: current().project.id,
          expectedRevision: current().project.revision,
          entry: { ...entry, model_confirmed_asset_id: entity()!.model_asset_id },
        }),
      (next) => {
        apply(next)
        setEditorDirty(false)
        setContentDirty(false)
        resetModelPrompt()
        setEntryId(entry.id)
        setPage("behavior")
      },
    )
  }
  const libraryEntries = createMemo(() => {
    if (!view()) return []
    const existing = current().project.conception.entries
    const blocks = current()
      .project.blocks.filter((item) => !existing.some((entry) => entry.id === item.id))
      .map((item) => ({
        ...makeEntry(
          "block",
          item.name,
          `现有方块 ${item.identifier}。硬度 ${item.hardness}，亮度 ${item.luminance}。\n继续描述新的外观、状态、交互或玩法。`,
        ),
        id: item.id,
      }))
    const items = current()
      .project.items.filter((item) => !existing.some((entry) => entry.id === item.id))
      .map((item) => ({
        ...makeEntry(
          "item",
          item.name,
          `现有物品 ${item.identifier}，堆叠上限 ${item.max_stack}。\n继续描述新的外观、用途、获得方式与玩法。`,
        ),
        id: item.id,
      }))
    const recipes = current()
      .project.recipes.filter((item) => !existing.some((entry) => entry.id === item.id))
      .map((item) => ({
        ...makeEntry("recipe", item.name),
        id: item.id,
        kind: "recipe" as const,
        recipe: {
          recipe_type: "crafting" as const,
          input_names: item.pattern.map((value) => value ?? ""),
          output_name: item.result,
          output_names: [],
          count: item.count,
          fuel: "",
          duration: "",
          intent: `已有配方 ${item.name}`,
        },
      }))
    return [...existing, ...blocks, ...items, ...recipes]
  })
  // What a pack made now would leave out, as the main process works it out from what a build compiles (`getBuildPanel`'s `drafts`); not from the status an asset was saved with.
  const draftCount = () => (view() ? panel()?.drafts ?? 0 : 0)
  const javaBuildProblem = () => {
    const latest = job()
    if (latest?.kind !== "build" || latest.project_id !== view()?.project.id) return panel()?.javaProblem
    const checkpoint = latest.checkpoint
    return latest.state === "failed" && checkpoint && typeof checkpoint === "object"
      && "reason" in checkpoint && checkpoint.reason === "java_cache" ? latest.error ?? undefined : undefined
  }
  // The one game setup Studio builds for, as the main process reports it; no versions are spelled here.
  const environmentFacts = () => {
    const profile = environment()?.profiles?.[0]
    if (!profile) return ""
    const loader = profile.loader.charAt(0).toUpperCase() + profile.loader.slice(1)
    return `Minecraft ${profile.minecraft} · ${loader}${advanced() ? ` ${profile.loaderVersion}` : ""} · Java ${profile.java}`
  }
  const environmentTag = () => (
    <Show when={environmentFacts()}>
      <div class="environment-tag">
        <Icon name="cube" />
        <span>{environmentFacts()}</span>
      </div>
    </Show>
  )
  const heading = (title: string, action?: () => void, label = "新建") => (
    <div class="page-heading">
      <h1>{title}</h1>
      <Show when={action}>
        <Button onClick={action} primary>
          <Icon name="plus" />
          {label}
        </Button>
      </Show>
    </div>
  )
  const jobPanel = () => (
    <Show when={active()}>
      <div class="job-strip" role="status">
        <span class="status-dot running" />
        <span>{(advanced() ? jobDetail().slice(-180) : plainProgress(jobDetail())) || "正在处理，请稍等"}</span>
        <Button onClick={() => void perform(() => window.studio.cancelJob(active()!), setJob)}>取消</Button>
      </div>
    </Show>
  )
  // Set by the poll of the open project's runs: main says "changed" right after a step of an outside AI changed one.
  const runsNow = { read: () => {} }
  onMount(() => {
    const unsubscribe = window.studio.onCommand((command) => {
      if (command === "presence") void window.studio.getMcpStatus().then(setMcp)
      if (command === "changed") runsNow.read()
      if (command === "prepared") {
        setAheadLook((value) => value + 1)
        setAheadMoved((value) => value + 1)
      }
      if (command === "new") newProject()
      if (command === "open") void openExistingProject()
      if (command === "home") navigate("home")
      if (command === "settings") navigate("profile")
      if (command === "export") {
        if (view()) setBuildOpen(true)
        else navigate("share")
      }
    })
    onCleanup(unsubscribe)
    void Promise.all([
      refresh(),
      window.studio.environment().then(setEnvironment),
      window.studio.getSettings().then(setSettings),
      window.studio.getConnection().then(setConnection),
      window.studio.getMcpStatus().then(setMcp),
    ]).catch((cause) => setError(errorMessage(cause)))
    void readTargets()
    const protect = (event: BeforeUnloadEvent) => {
      if (!editorDirty() && !contentDirty()) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", protect)
    onCleanup(() => window.removeEventListener("beforeunload", protect))
  })
  createEffect(() => {
    if (!external()) return
    const state = { stopped: false, timer: 0 }
    const poll = async () => {
      const status = await window.studio.getMcpStatus().catch(() => null)
      if (state.stopped) return
      if (status) setMcp(status)
      state.timer = window.setTimeout(() => void poll(), 1500)
    }
    void poll()
    onCleanup(() => {
      state.stopped = true
      window.clearTimeout(state.timer)
    })
  })
  const activeProjectId = createMemo(() => view()?.project.id)
  createEffect(
    on(activeProjectId, (projectId) => {
      setRuns([])
      setExternalDrafts({})
      setExternalPercentages({})
      if (!projectId) return
      const state = { stopped: false, applied: "", timer: 0, reading: false, again: false }
      // One read at a time; asked for while one is under way, the next follows at once instead of after the wait.
      const turn = async () => {
        state.reading = true
        await poll()
        state.reading = false
        if (!state.again || state.stopped) return
        state.again = false
        window.clearTimeout(state.timer)
        void turn()
      }
      runsNow.read = () => {
        state.again = state.reading
        if (state.reading) return
        window.clearTimeout(state.timer)
        void turn()
      }
      const poll = async () => {
        const result = await window.studio.listProjectRuns({ projectId }).catch(() => null)
        if (state.stopped) return
        if (!result) {
          state.timer = window.setTimeout(() => void turn(), 2000)
          return
        }
        setRuns((previous) =>
          result.map(
            (run) =>
              previous.find(
                (value) =>
                  value.id === run.id &&
                  value.updated_at === run.updated_at &&
                  value.events.at(-1)?.id === run.events.at(-1)?.id,
              ) ?? run,
          ),
        )
        if (external() && result[0]) {
          const progress = await window.studio.getExternalProgress({ projectId, runId: result[0].id }).catch(() => null)
          if (state.stopped) return
          const drafts = Object.fromEntries(
            Object.entries(progress?.drafts ?? {})
              .filter(([, value]) => value.draft)
              .map(([id, value]) => [id, value.draft as ModuleDocument]),
          )
          setExternalDrafts((previous) => (JSON.stringify(previous) === JSON.stringify(drafts) ? previous : drafts))
          setExternalPercentages(
            Object.fromEntries(Object.entries(progress?.drafts ?? {}).map(([id, value]) => [id, value.progress])),
          )
        }
        const signature = result
          .map((run) => `${run.id}:${run.state}:${run.tasks.map((task) => task.state).join(",")}`)
          .join(";")
        if (signature !== state.applied && !editorDirty() && !contentDirty()) {
          const next = await window.studio.openProject(projectId).catch(() => null)
          if (state.stopped) return
          if (next && !editorDirty() && !contentDirty()) {
            apply(next)
            state.applied = signature
          }
        }
        state.timer = window.setTimeout(() => void turn(), result.some((run) => ["planning", "running"].includes(run.state)) ? 1000 : 5000)
      }
      void turn()
      onCleanup(() => {
        state.stopped = true
        runsNow.read = () => {}
        window.clearTimeout(state.timer)
      })
    }),
  )
  createEffect(() => {
    if (!buildOpen()) return
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBuildOpen(false)
    }
    window.addEventListener("keydown", close)
    onCleanup(() => window.removeEventListener("keydown", close))
  })
  createEffect(() => {
    if (!navOpen()) return
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false)
        document.querySelector<HTMLButtonElement>(".nav-toggle")?.focus()
      }
    }
    window.addEventListener("keydown", close)
    onCleanup(() => window.removeEventListener("keydown", close))
  })
  createEffect(() => {
    if (error() === REVISION_CONFLICT || /版本不受支持/.test(error())) setConflict(true)
  })
  createEffect(() => {
    const task = active()
    if (!task) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const next = await window.studio.getJob(task).catch((cause) => {
        if (!stopped) {
          annotationJobs.get(task.jobId)?.reject(new Error(errorMessage(cause)))
          annotationJobs.delete(task.jobId)
          setError(errorMessage(cause))
          setActive(null)
          chainEnded(task.jobId, "failed", null, errorMessage(cause))
        }
        return null
      })
      if (!next || stopped) return
      setJob(next)
      if (next.kind === "generate-model" && next.state === "running") {
        const progress = await window.studio.getModelProgress(task).catch(() => null)
        if (!stopped) setModelProgress(progress)
      }
      if (["completed", "failed", "canceled", "interrupted"].includes(next.state)) {
        if (next.state === "failed") setError(next.error ?? "这一步没做成")
        if (next.state === "completed") {
          const updated = await window.studio.openProject(task.projectId).catch((cause) => {
            setError(errorMessage(cause))
            return null
          })
          if (!stopped && updated && view()?.project.id === task.projectId) {
            apply(updated)
            if (next.kind === "generate-model") resetModelPrompt()
          }
          if (updated) annotationJobs.get(task.jobId)?.resolve()
          if (!updated) annotationJobs.get(task.jobId)?.reject(new Error("模型已保存，但读取失败；请重新打开工程。"))
        }
        if (next.state !== "completed") annotationJobs.get(task.jobId)?.reject(new Error(next.error ?? "模型修改已取消或中断，标注已保留。"))
        annotationJobs.delete(task.jobId)
        if (!stopped) {
          setActive(null)
          setJobsEnded((count) => count + 1)
          chainEnded(task.jobId, next.state as ChainEnd, next)
        }
        return
      }
      timer = setTimeout(() => void poll(), 800)
    }
    void poll()
    onCleanup(() => {
      stopped = true
      clearTimeout(timer)
    })
  })

  return (
    <div
      class={`studio-root ${settings().reducedMotion ? "reduce-motion" : ""} ${navOpen() ? "nav-open" : ""}`}
      data-page={page()}
    >
      <Advancements projectId={projectOpen() ? (view()?.project.id ?? null) : null} />
      <header class="titlebar">
        <Show when={projectOpen()}>
          <button
            class="nav-toggle"
            aria-label="工程导航开关"
            aria-controls="project-sidebar"
            aria-expanded={navOpen()}
            onClick={() => setNavOpen(!navOpen())}
          >
            <Icon name="folder" />
          </button>
        </Show>
        <button
          class="brand"
          onPointerDown={mining.press}
          onPointerUp={mining.release}
          onPointerLeave={mining.release}
          onClick={() => {
            if (!mining.spent()) navigate("home")
          }}
          aria-label="MineMods Studio 工程库"
        >
          <span class="brand-mark" aria-hidden="true" />
          <span>MineMods</span>
        </button>
        <Show
          when={projectOpen()}
          fallback={
            <span class="workspace-breadcrumb">
              {page() === "profile"
                ? WORDS.settings
                : page() === "resources"
                  ? RESOURCE_LABELS[resourceTab()]
                  : page() === "home"
                    ? "工程库"
                    : page() === "share"
                      ? "导入与分享"
                      : "新建工程"}
            </span>
          }
        >
          <button class="title-project" onClick={() => navigate("home")} title="回到工程库">
            <strong>{current().project.name}</strong>
            <Icon name="folder" />
          </button>
          <span class="workspace-breadcrumb">
            {inModelWorkspace() || page() === "behavior" || runtimeEntity()
              ? `生物 / ${stepEntity()?.name ?? ""}${inside() ? " / " + insideTabs.find(tab => tab.key === inside())!.title : runtimeEntity() || page() === "behavior" ? " / 行为" : page() === "animation" ? " / " + WORDS.motion : page() === "texture" ? " / 贴图" : " / 外观"}`
              : page() === "entry"
                ? `${contentNames[selectedEntry()?.kind ?? "entity"]} / ${selectedEntry()?.title ?? ""}`
                : page() === "library"
                  ? contentNames[category()]
                  : page() === "asset"
                    ? `${kindLabel(module(), MODULES[module()].label)} / ${thingName(selectedAsset()) ?? "新建"}`
                    : page() === "overview"
                      ? "工程总览"
                      : page() === "commands"
                        ? WORDS.floor
                        : page() === "conception"
                          ? WORDS.legacy
                          : page() === "info"
                            ? INFO_WORDS.title
                            : "分享工程"}
          </span>
        </Show>
        <span class={`title-status ${projectOpen() && (editorDirty() || contentDirty()) ? "dirty" : ""} ${ignored() ? "flash" : ""}`} role="status">
          {busyShown() || ignored()
            ? "正在处理上一件事…"
            : projectOpen()
            ? editorDirty() || contentDirty()
              ? "有未保存修改"
              : external() && running()
                ? "制作中 · 草稿待保存"
                : "所有修改已保存"
            : awayStatus({ project: page() === "profile" ? settingsFrom()?.name : undefined, nickname: settings().nickname })}
        </span>
        <Show
          when={
            projectOpen() &&
            (["commands", "asset", "model", "texture", "animation"].includes(page()) ||
              (external() && advanced() && page() === "overview"))
          }
        >
          {/* On the overview a beginner has no model in front of them to tie this to, so there it waits for 高级. */}
          <ModelComplexityControl
            value={settings().modelComplexity}
            onChange={async (value) => {
              setSettings(await window.studio.saveSettings({ ...settings(), modelComplexity: value }))
              const label = { low: "低", medium: "中", high: "高" }[value]
              setToast(`模型精细度：${label}。之后 AI 做模型会照这个来做`)
            }}
          />
        </Show>
        <button
          class={`title-chip ${chip().on ? "on" : ""}`}
          data-presence={chip().state}
          aria-label={`连接 AI：${chip().text}`}
          aria-expanded={connectionOpen()}
          onClick={() => setConnectionOpen(true)}
          title={WORDS.connect}
        >
          <span class="status-light" aria-hidden="true" />
          {chip().text}
        </button>
        <Show when={projectOpen()}>
          <Button primary class="title-build" disabled={!view()} onClick={() => playNow()}>
            <Icon name="play" />
            {WORDS.play}
          </Button>
        </Show>
        <button
          type="button"
          class="title-chip title-advanced"
          aria-pressed={advanced()}
          title={ADVANCED_TITLE}
          onClick={() => setAdvanced(!advanced())}
        >
          高级
        </button>
        <button
          class={`title-icon ${page() === "profile" ? "active" : ""}`}
          aria-label="个人设置"
          title="个人设置"
          onClick={() => navigate("profile")}
        >
          <Icon name="settings" />
        </button>
      </header>
      <Show when={connectionOpen() && connection()}>
                      <ConnectionSettings
                        connection={connection()!}
                        status={chip().text}
                        mcp={mcpShown()}
                        onSave={saveConnection}
                        onTest={(input) => window.studio.testConnection(input)}
                        onListModels={(input) => window.studio.listConnectionModels(input)}
                        onCopy={() => window.studio.copyMcpConfig()}
                        projectName={projectOpen() ? view()?.project.name : undefined}
                        onGetHandoff={(role) => window.studio.getMcpHandoff({ projectId: projectOpen() ? view()?.project.id : undefined, ...(role ? { role } : {}) })}
                        onCopyHandoff={(role) => window.studio.copyMcpHandoff({ projectId: projectOpen() ? view()?.project.id : undefined, ...(role ? {role} : {}) })}
                        onDetectClients={() => window.studio.detectAiClients()}
                        onConnectClient={(client) => window.studio.connectAiClient({ client })}
                        onOpenDownload={(client) => window.studio.openAiClientDownload({ client })}
                        onOpenKeyPage={(provider) => window.studio.openProviderKeyPage({ provider })}
                        onCopyText={(text) => window.studio.copyText({ text })}
                        onDone={() => setConnectionOpen(false)}
                      />
      </Show>
      <div class={`app-layout ${projectOpen() ? "project-layout" : "home-layout"}`} classList={{ "shelf-compact": !leftOpen() }}>
        <Show when={projectOpen()}>
          <Show when={navOpen()}>
            <button class="nav-backdrop" aria-label="收起工程导航" onClick={() => setNavOpen(false)} />
          </Show>
          <aside class="sidebar" id="project-sidebar" classList={{ compact: !leftOpen() }}>
            <Show when={view()?.project.id} keyed>{(_project) => <ProjectNavigation
              compact={!leftOpen()}
              onToggle={() => setLeftOpen(rememberShelf(localStorage, SHELF_STORE, !leftOpen()))}
              onInspect={(id) => {
                const inspect = () => { setNavOpen(false); setInspection({ id, nonce: ++pressed }) }
                if (editorDirty() || contentDirty()) void navigate("overview").then((yes) => yes && inspect())
                else inspect()
              }}
              external={external()}
              legacy={legacyShown()}
              project={current().project}
              entries={libraryEntries()}
              page={page()}
              entryId={entryId()}
              entityId={current().entity_id}
              assetId={assetId()}
              onAsset={(asset) => openModule(asset.module, asset)}
              onAudioSaved={(next,id)=>{if (view()?.project.id !== next.project.id) return; apply(next); const asset=next.project.workspace.assets.find(a=>a.id===id); if(asset) void openModule(asset.module,asset)}}
              onNewAsset={(kind) => openModule(kind)}
              onNewEntity={() => {
                if (busy() || active()) return ignoredClick()
                setEntityName("")
                setEntityNameMissing(false)
                setEntityModal(true)
              }}
              onNavigate={navigate}
              onEntry={(entry) => void openEntry(entry)}
              onEntity={(id) => {
                const asset = runtimeFor(id)
                if (asset) void openModule("entity", asset)
                else void openEntity(id)
              }}
            />}</Show>
          </aside>
        </Show>
        <main class="main-area">
          <Show when={offer()}>{row=><section class="review-offer"><strong>{row().text}</strong><p>打开后要多开一个 AI 对话。</p>
            <Button onClick={()=>void answerReview(true).catch(e=>setError(errorMessage(e)))}>打开审查</Button>
            <Button onClick={()=>void answerReview(false)}>先不用</Button></section>}</Show>
          <Show when={page()==="overview" && view() && reviewCopiedFor()===view()!.project.id}>
            <Button onClick={()=>void window.studio.copyMcpHandoff({projectId:view()!.project.id,role:"reviewer"}).then(()=>setReviewCopiedFor("")).catch(e=>setError(errorMessage(e)))}>复制给审查的 AI</Button>
          </Show>
          <Show when={external() && page() === "overview" && presenceBanner()}>
            <div class="presence-banner" data-state={presenceBanner()} role={presenceBanner() === "disconnected" ? "alert" : "status"}>
              <span>{presenceBanner() === "disconnected" ? "AI 断开了。" : presenceBanner() === "idle" ? "AI 45 秒没动静。" : "AI 重新连上了。"}{bannerTask() ? `「${bannerTask()}」已交来的内容已经存好。` : "工程的修改已经存好。"}</span>
              <Show when={presenceBanner() === "disconnected"}><Button onClick={() => void checkPresence()}>重新检测</Button><Button onClick={() => void copyPresence()}>复制起步说明</Button></Show>
              <Show when={presenceBanner() === "idle"}><Button onClick={() => setPresenceBanner(null)}>再等等</Button></Show>
            </div>
          </Show>
          <Show when={advanced() && !buildOpen()}>
            <p class="advanced-note" role="status">
              {advancedLine(advancedPlace())}
            </p>
          </Show>
          <Show when={error()}>
            <div class="error-bar" role="alert">
              <span>{error()}</span>
              <button aria-label="关闭错误" onClick={() => setError("")}>
                <Icon name="close" />
              </button>
            </div>
          </Show>
          <Show when={projectOpen() && view()}><UndoThing project={current().project} saved={apply} /></Show>
          <Show when={projectOpen() && stepEntity()}>
            <CreationSteps
              data={insideData()} inside={runtimeEntity() ? inside() : null} onInside={tab=>void chooseInside(tab)}
              menu={<ThingMenu project={current().project} id={runtimeFor(stepEntity()!.id)?.id ?? stepEntity()!.id} kind="entity" title={stepEntity()!.name} busy={busy() || running()}
                saved={(v,id)=>{apply(v);if(!id)void navigate("overview")}} replace={()=>void replaceModelFile(stepEntity()!.id)}
                go={id=>{const asset=current().project.workspace.assets.find(a=>a.id===id);if(asset)void openModule(asset.module,asset)}} />}
              page={runtimeEntity() ? "behavior" : page()}
              canContinue={
                !busy() &&
                !active() &&
                (runtimeFor(stepEntity()!.id) ? true : legacyShown() && !!stepEntity()?.model_asset_id)
              }
              behaviorHint={runtimeFor(stepEntity()!.id) ? undefined : NO_RULES_WORDS}
              onMode={(mode) => void openAppearance(stepEntity()!.id, mode)}
              onBehavior={() => runtimeEntity() ? setInside(null) : openBehavior(stepEntity()!.id)}
              onLoot={runtimeFor(stepEntity()!.id) && (() => {
                const asset = runtimeFor(stepEntity()!.id)
                if (asset) void openModule("entity", asset, "loot")
              })}
            />
          </Show>
          {/* 制作现场 says this itself, with its own button: the page does not say it twice. */}
          <Show when={!external() && projectOpen() && page() !== "overview" && page() !== "commands" && !environment()?.projectAiConfigured}>
            <div class="connection-callout">
              <span>{WORDS.connect} 后，就可以{WORDS.say}让它做东西了。</span>
              <Button onClick={() => setConnectionOpen(true)}>
                {WORDS.connect}
                <Icon name="arrow" />
              </Button>
            </div>
          </Show>
            <Show when={projectOpen() && (page() === "overview" || inspection())}>
              <Show when={current().project.id} keyed>
                {(projectId) => (
                  <ProjectAssets
                    presence={external() ? mcp()?.state : undefined}
                    cardOnly={page() !== "overview"}
                    onDismiss={() => setInspection(null)}
                    inspection={inspection()}
                    projectId={projectId}
                    projectName={current().project.name}
                    project={current().project}
                    revision={current().project.revision}
                    ended={jobsEnded()}
                    external={external()}
                    aiConfigured={!!environment()?.aiConfigured}
                    nickname={settings().nickname}
                    onSettings={() => setConnectionOpen(true)}
                    onWatch={() => navigate("commands")}
                    onChanged={() => void syncProject()}
                    onSaveItem={saveItem}
                    onAnnotateModel={annotateAsset}
                    onDirty={(dirty) => { if (page() === "overview" || inspection()) setContentDirty(dirty) }}
                    editor={itemEditor}
                    jump={jump()}
                    onJumped={() => setJump(null)}
                    info={{ line: infoLine(current().project, settings().nickname), icon: current().project.icon ?? null, open: () => openInfo() }}
                    onBuild={() => playNow()}
                    onPack={() => playNow("jar")}
                    buildBusy={busy() || !!active() || chainBusy()}
                    onRevealJar={current().latest_build_job_id ? revealJar : undefined}
                    drafts={overviewDrafts()}
                    modelComplexity={settings().modelComplexity}
                  />
                )}
              </Show>
            </Show>
          <Switch>
            <Match when={page() === "resources"}>
              <ResourceManager targetProjects={view() ? [current().project] : entries().map((entry) => entry.project)} initialTab={resourceTab()} backLabel={resourcesFromSettings() ? `回${WORDS.settings}` : undefined} onBack={() => navigate(resourcesFromSettings() ? "profile" : "home")} onTab={setResourceTab} />
            </Match>
            {/* 制作现场: one page for both connections. With an outside AI it also stands in for the pages that client drives. */}
            <Match when={view() && (page() === "commands" || (external() && ["library", "entry", "behavior"].includes(page())))}>
              {/* A thing kept from before things had pages of their own is opened on a page that asks Studio's own AI. With an outside AI at work that page has nothing to do, and the person is told why they are looking at this one instead. */}
              <Show when={page() !== "commands"}>
                <div class="connection-callout" role="note">
                  <span>这样东西是早先做的，它自己的那一页要用 Studio 自带的 AI。现在是外面的 AI 在做：想改它，直接在你的 AI 助手里说，做的每一步都在下面的「{WORDS.floor}」里。</span>
                </div>
              </Show>
              <MakingFloor
                presence={external() ? mcp()?.state : undefined}
                view={current()}
                runs={runs()}
                drafts={externalDrafts()}
                modelComplexity={settings().modelComplexity}
                percentages={externalPercentages()}
                external={external()}
                connected={external() ? !!mcpShown()?.connected : !!environment()?.projectAiConfigured}
                enabled={external() ? !!mcp()?.enabled : true}
                disabled={busy() || !!active() || running()}
                onSettings={() => setConnectionOpen(true)}
                onCancel={cancelRun}
                onAsset={(asset) => openModule(asset.module, asset)}
                onRun={external() ? undefined : (prompt) => submitRun(prompt)}
                onDirty={setContentDirty}
                onChanged={() => void syncProject()}
              />
            </Match>
            <Match when={page()==="asset" && inside() && insideData()}>
              <CreatureInsidePage data={insideData()!} tab={inside()!} canAsk={external() || !!environment()?.projectAiConfigured} select={setInside} view={current()} busy={busy() || !!active() || running()} saved={apply}
                go={id=>{const a=current().project.workspace.assets.find(a=>a.id===id);if(a)void openModule(a.module,a)}}
                ask={text=>external() ? window.studio.copyText({text}).then(()=>notify("已复制给 AI 的话")) : submitRun(text,"entity").catch(cause=>setError(errorMessage(cause)))}/>
            </Match>
            <Match when={page() === "asset" && view()}>
              <Show when={`${module()}:${assetId() ?? "new"}`} keyed>
                {(_key) => (
                  <><Show when={insideData() && (!insideData()!.moves.length || !insideData()!.boss || !insideData()!.shows.length)}><div class="creature-prompt">它还可以有招式、阶段、演出。 <button disabled={busy() || running() || (!external() && !environment()?.projectAiConfigured)} title={!external() && !environment()?.projectAiConfigured ? "先连接 AI" : undefined} onClick={()=>{const text="请帮「"+stepEntity()!.name+"」设计招式、阶段和演出。";void (external()?window.studio.copyText({text}).then(()=>notify("已复制给 AI 的话")):submitRun(text,"entity")).catch(e=>setError(errorMessage(e)))}}>{external()?"复制给我的 AI":"让 AI 来做"}</button></div></Show>
                  <AssetWorkspace creatureView={current()}
                    behaviorNotes={<Show when={insideData()}>{data => <CreatureInsidePage data={data()} tab="behavior" select={setInside} view={current()} busy={busy() || running()} canAsk={false} go={() => {}} ask={() => {}} saved={apply} />}</Show>}
                    onReplaceModel={id=>void replaceModelFile(id)}
                    onRemoved={v=>{apply(v);setAssetId(null);void navigate("overview")}}
                    onSaved={(next, id) => {
                      apply(next)
                      setAssetId(id)
                    }}
                    external={external()}
                    project={current().project}
                    module={module()}
                    asset={selectedAsset()}
                    runs={runs()}
                    disabled={busy() || !!active() || running()}
                    handDisabled={busy() || running()}
                    aiConfigured={!!environment()?.projectAiConfigured}
                    onRun={(prompt) => submitRun(prompt, module())}
                    onCloseNew={() => void navigate("overview")}
                    onOpenAsset={(asset) => openModule(asset.module, asset)}
                    focusField={assetField()}
                    onEditModel={external() ? undefined : (entityId) => void openEntity(entityId)}
                    onSaveItem={saveItem}
                    onAnnotateModel={annotateAsset}
                    onCancel={cancelRun}
                    onDirty={setContentDirty}
                  /></>
                )}
              </Show>
            </Match>
            <Match when={page() === "info" && view()}>
              <ModInfo
                project={current().project}
                nickname={settings().nickname}
                disabled={busy() || !!active()}
                focus={infoField()}
                onSave={saveModInfo}
                onBack={() => void navigate("overview")}
              />
            </Match>
            <Match when={page() === "home"}>
              <div class="page home-page">
                {/* The title screen (10-14): the name of the mod is the only thing asked before work starts; the rest are ways in, not steps. */}
                <section class="title-screen" aria-label="开始">
                  <h1 class="mm-logo" aria-label="MineMods">
                    <img class="mm-logo-face" classList={{ fall: logoFalls() }} src={TITLE_IMAGE} alt="" draggable={false} />
                    <span
                      class="mm-splash"
                      classList={{ pop: splashPops() }}
                      aria-hidden="true"
                      onClick={() => {
                        setSplashLine(nextSplash(splashLine()))
                        if (!calm()) setSplashPops(true)
                      }}
                      onAnimationEnd={() => setSplashPops(false)}
                    >
                      {splashLine()}
                    </span>
                  </h1>
                  <Show when={settings().nickname}>
                    <p class="title-hello">
                      <Avatar tone={settings().avatar} />
                      {settings().nickname}，今天想做个什么？
                    </p>
                  </Show>
                  <form
                    class="title-start"
                    onSubmit={(event) => {
                      event.preventDefault()
                      startFromTitle(new FormData(event.currentTarget).get("name")?.toString() ?? "")
                    }}
                  >
                    <input name="name" aria-label="工程名称" maxlength="120" placeholder="给你的工程起个名字，比如：赤铜飞行社" autocomplete="off" />
                    <Button primary type="submit">
                      开始做
                    </Button>
                  </form>
                  <p class="title-hint">起好名字就进工程，然后用一句话告诉 AI 你想要什么。游戏、Java 这些 Studio 自己准备。</p>
                  <Show when={!chip().on}>
                    <p class="title-ai" role="note">
                      <span class="status-light" aria-hidden="true" />
                      <span>AI 还没连接。{NO_AI_WORDS}{WORDS.connect} 后，{WORDS.say}就能让它做。</span>
                      <button type="button" class="link-button" onClick={() => setConnectionOpen(true)}>
                        {WORDS.connect}
                      </button>
                    </p>
                  </Show>
                  <nav class="title-ways" aria-label="其他方式">
                    <Show when={view()}>
                      <button class="title-way" onClick={() => navigate("overview")}>
                        <Icon name="arrow" />
                        回到「{view()!.project.name}」
                      </button>
                    </Show>
                    <button class="title-way" title="打开本机上的工程，或者别人分享的 .minemods 文件" onClick={() => setOpeningWays(true)}>
                      <Icon name="folder" />
                      打开或导入工程
                    </button>
                    <button
                      class="title-way"
                      title="打开别人的模组或整合包，看看里面有什么"
                      onClick={() => {
                        setResourcesFromSettings(false)
                        setResourceTab("imports")
                        navigate("resources")
                      }}
                    >
                      <Icon name="document" />
                      模组图鉴
                    </button>
                  </nav>
                  <Show when={entries().length}>
                    <HomeWorlds entries={entries()} all={allProjects()} onOpen={(projectId) => void openProject(projectId)} onAll={() => setAllProjects(!allProjects())} />
                  </Show>
                </section>
                <Show when={openingWays()}>
                  <OpenOrImport
                    onClose={() => setOpeningWays(false)}
                    onOpen={() => {
                      setOpeningWays(false)
                      void openExistingProject()
                    }}
                    onImport={() => {
                      setOpeningWays(false)
                      navigate("share")
                      void perform(() => window.studio.chooseImport(), setImported)
                    }}
                  />
                </Show>
                {/* With no project yet the title screen is the one way in: a second create button, a count of zero and a search over nothing only made a first-time person choose between two of the same thing. */}
                <Show when={entries().length && allProjects()}>
                  <div class="projects-toolbar">
                    <div class="projects-title">
                      <h2>工程</h2>
                      <span class="project-count">{entries().length}</span>
                    </div>
                    <label class="search">
                      <Icon name="search" />
                      <input
                        aria-label="搜索工程"
                        placeholder="搜索工程"
                        value={search()}
                        onInput={(event) => setSearch(event.currentTarget.value)}
                      />
                    </label>
                  </div>
                  <div class="project-grid">
                    <For
                      each={entries().filter((entry) =>
                        entry.project.name.toLowerCase().includes(search().toLowerCase()),
                      )}
                    >
                      {(entry) => (
                        <div class="project-card-wrap">
                        <button class="project-card" onClick={() => void openProject(entry.project.id)}>
                          <ProjectArt project={entry.project} />
                          <div class="project-copy">
                            <strong>{entry.project.name}</strong>
                            <small>Minecraft · {projectGames(entry.project)}</small>
                            <small>
                              {new Date(entry.project.updated_at).toLocaleDateString("zh-CN")} ·{" "}
                              {
                                new Set([
                                  ...entry.project.entities.map((value) => value.id),
                                  ...entry.project.blocks.map((value) => value.id),
                                  ...entry.project.items.map((value) => value.id),
                                  ...entry.project.recipes.map((value) => value.id),
                                  ...entry.project.conception.entries.map((value) => value.entity_id ?? value.id),
                                  ...entry.project.workspace.assets.map((value) => value.id),
                                ]).size
                              }{" "}
                              样东西
                            </small>
                            <small class="project-location">{entry.directory}</small>
                          </div>
                        </button>
                        <MoreMenu class="project-menu" label={`「${entry.project.name}」的菜单`} title="改名、删除">
                          {(close) => <div class="project-menu-list" role="menu">
                            <button type="button" role="menuitem" onClick={() => { close(); void renameProject(entry) }}>改名</button>
                            <button type="button" role="menuitem" onClick={() => { close(); void deleteProject(entry) }}>删除</button>
                          </div>}
                        </MoreMenu>
                        </div>
                      )}
                    </For>
                  </div>
                  <Show
                    when={!entries().some((entry) => entry.project.name.toLowerCase().includes(search().toLowerCase()))}
                  >
                    <div class="empty">
                      <h2>没有找到这个工程</h2>
                      <p>试试其他名称，或清空搜索查看全部工程。</p>
                      <Button onClick={() => setSearch("")}>清空搜索</Button>
                    </div>
                  </Show>
                </Show>
              </div>
            </Match>
            <Match when={page() === "create"}>
              <div class="page">
                <div class="wizard">
                  <div class="wizard-panel panel">
                    <h1>新建工程</h1>
                    <form
                      class="create-form"
                      noValidate
                      onSubmit={(event) => {
                        event.preventDefault()
                        submitCreate()
                        if (projectNameMissing()) event.currentTarget.querySelector("input")?.focus()
                      }}
                    >
                      <div class="form-fields">
                        <label class="field">
                          工程名称
                          <input
                            aria-label="工程名称"
                            required
                            aria-invalid={projectNameMissing()}
                            aria-describedby={projectNameMissing() ? "create-name-error" : undefined}
                            maxlength="120"
                            placeholder="例如：赤铜飞行社"
                            value={name()}
                            onInput={(event) => { setName(event.currentTarget.value); if (event.currentTarget.value.trim()) setProjectNameMissing(false) }}
                          />
                          <Show when={projectNameMissing()}><span id="create-name-error" class="create-problem" role="alert">先给工程起个名字。</span></Show>
                        </label>
                      </div>
                      <Show
                        when={createTarget()}
                        fallback={
                          <Show when={environmentFacts()} fallback={<p class="create-facts">游戏版本这些 Studio 自己会准备好</p>}>
                            <p class="create-facts">{environmentFacts()}，这些 Studio 自己会准备好</p>
                          </Show>
                        }
                      >
                        {(target) => (
                          <>
                            <div class="setup-summary">
                              <span>{summaryLine({ target: target(), java: createJava(), mods: pendingMods().length })}</span>
                              <button type="button" class="studio-button" aria-expanded={setupOpen()} onClick={() => setSetupOpen(!setupOpen())}>
                                {setupOpen() ? SETUP_WORDS.fold : SETUP_WORDS.change}
                              </button>
                            </div>
                            {/* Drawn while folded too: the Java card's look is what the summary line says. */}
                            <div class="setup-cards" hidden={!setupOpen()}>
                              <TargetCard targets={targets()} value={target().id} onChange={setTargetId} />
                              <PreinstalledMods targetId={target().id} pending={pendingMods()} onPending={setPendingMods} />
                              <JavaCard major={target().java} onReport={setCreateJava} />
                            </div>
                          </>
                        )}
                      </Show>
                      <Fold class="create-advanced" open={createMore()} onToggle={setCreateMore} summary="更多选项">
                        <div class="form-fields">
                          <label class="field">
                            模组 ID
                            <input
                              aria-label="模组 ID"
                              maxlength="64"
                              spellcheck={false}
                              autocomplete="off"
                              aria-invalid={!!modIdError()}
                              placeholder={name().trim() ? deriveModId(name()) : ""}
                              value={modId() ?? (name().trim() ? deriveModId(name()) : "")}
                              onInput={(event) => {
                                setModId(event.currentTarget.value)
                                setModIdError("")
                              }}
                            />
                            <span class="create-hint">
                              {MOD_ID_WORDS.explain}
                              {MOD_ID_WORDS.empty}
                            </span>
                            <Show when={modIdError()}>
                              <span class="create-problem" role="alert">
                                {modIdError()}
                              </span>
                            </Show>
                          </label>
                          <label class="field">
                            保存位置
                            <div class="path-row">
                              <output>{location()?.label ?? environment()?.workspace ?? "默认工程目录"}</output>
                              <Button
                                onClick={() => void perform(() => window.studio.chooseProjectLocation(), setLocation)}
                              >
                                选择
                              </Button>
                            </div>
                          </label>
                        </div>
                      </Fold>
                      <div class="wizard-actions">
                        <Button onClick={() => navigate("home")}>取消</Button>
                        <Button primary type="submit" disabled={busy()}>
                          创建工程
                          <Icon name="arrow" />
                        </Button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </Match>
            <Match when={page() === "conception" && view()}>
              <div class="project-overview">
                <ProjectConception
                  project={current().project}
                  disabled={busy() || !!active()}
                  aiConfigured={!!environment()?.aiConfigured}
                  onDirty={setContentDirty}
                  onSave={saveConception}
                  onAnalyze={(brief) =>
                    startAuthoring(() =>
                      window.studio.analyzeConception({
                        projectId: current().project.id,
                        expectedRevision: current().project.revision,
                        brief,
                      }),
                    )
                  }
                  onImport={async (plan) => {
                    const next = await window.studio.importConception({
                      projectId: current().project.id,
                      expectedRevision: current().project.revision,
                      plan,
                    })
                    apply(next)
                    setContentDirty(false)
                    notify("已经记进工程")
                  }}
                  onOpen={(entry) => void openEntry(entry)}
                />
                <aside class="project-summary">
                  <h2>{WORDS.legacy}</h2>
                  <p class="muted">这一页和它下面的草稿只是写下来的想法，打包时不会用到。</p>
                  <div class="summary-contents">
                    {/* Creatures are left out: each has its real page in the left column. */}
                    <For each={(Object.keys(contentNames) as ConceptionEntry["kind"][]).filter((kind) => kind !== "entity")}>
                      {(kind) => (
                        <button
                          onClick={() => void navigate("library").then((there) => there && setCategory(kind))}
                        >
                          <span>{contentNames[kind]}</span>
                          <strong>{categoryCount(kind)}</strong>
                          <Icon name="arrow" />
                        </button>
                      )}
                    </For>
                  </div>
                  <div class="summary-next">
                    <h3>想做出能玩的</h3>
                    <p>回到「工程总览」{WORDS.say}：AI 先出想法和蓝图，你验收过了以后一样一样做出来，做好的才会{WORDS.into_mod}。</p>
                    <Button primary onClick={() => void navigate("overview")}>
                      去工程总览
                      <Icon name="arrow" />
                    </Button>
                  </div>
                </aside>
              </div>
              {jobPanel()}
            </Match>
            <Match when={page() === "library" && view()}>
              <div class="page content-library">
                {heading(contentNames[category()], () => void addContent(), `新增${contentNames[category()]}`)}
                <p class="muted">{current().project.name}</p>
                <div class="library-list">
                  <Show
                    when={category() === "entity"}
                    fallback={
                      <For each={libraryEntries().filter((entry) => entry.kind === category())}>
                        {(entry) => (
                          <button class="library-row" onClick={() => void openEntry(entry)}>
                            <Icon name={category() === "recipe" ? "recipe" : "cube"} />
                            <div>
                              <strong>{entry.title}</strong>
                              <p>{entry.brief}</p>
                            </div>
                            <span class="row-status">{entry.review ? "AI 整理过" : WORDS.draft}</span>
                            <Icon name="arrow" />
                          </button>
                        )}
                      </For>
                    }
                  >
                    <For each={current().project.entities}>
                      {(value) => (
                        <button class="library-row" onClick={() => void openEntity(value.id)}>
                          <Icon name="cube" />
                          <div>
                            <strong>{value.name}</strong>
                            <p>{value.description}</p>
                          </div>
                          <span class="row-status">{value.model_asset_id ? "有模型了" : "还没做"}</span>
                          <Icon name="arrow" />
                        </button>
                      )}
                    </For>
                  </Show>
                  <Show
                    when={
                      category() === "entity"
                        ? !current().project.entities.length
                        : !libraryEntries().some((entry) => entry.kind === category())
                    }
                  >
                    <div class="empty">
                      <h2>还没有{contentNames[category()]}</h2>
                      <Button onClick={() => navigate("conception")}>回到旧的构想</Button>
                      <Button primary disabled={busy() || !!active()} onClick={() => void addContent()}>
                        直接新建
                      </Button>
                    </div>
                  </Show>
                </div>
              </div>
            </Match>
            <Match when={(page() === "entry" || page() === "behavior") && selectedEntry()}>
              <Show when={`${entryId()}-${page()}`} keyed>
                {(_key) => (
                  <ContentBriefEditor
                    entry={selectedEntry()!}
                    behavior={page() === "behavior"}
                    disabled={busy() || !!active()}
                    aiConfigured={!!environment()?.aiConfigured}
                    onSave={saveEntry}
                    onReview={(entry, behavior) =>
                      startAuthoring(() =>
                        window.studio.reviewEntry({
                          projectId: current().project.id,
                          expectedRevision: current().project.revision,
                          entry,
                          behavior,
                        }),
                      )
                    }
                    onBack={() => navigate(page() === "behavior" ? "model" : legacyShown() ? "library" : "overview")}
                    onDirty={setContentDirty}
                  />
                )}
              </Show>
              {jobPanel()}
            </Match>
            <Match when={inModelWorkspace() && view()}>
              <Show when={JSON.stringify([current().project.id, current().entity_id])} keyed>{(_entity) => <ModelWorkspace
                view={current()}
                mode={page() as "model" | "texture" | "animation"}
                prompt={modelPrompt()}
                promptDirty={modelPromptDirty()}
                disabled={busy() || !!active() || (external() && running())}
                dirty={editorDirty()}
                aiConfigured={!!environment()?.aiConfigured}
                external={external()}
                continueReady={legacyShown() ? undefined : !!runtimeFor(current().entity_id ?? "")}
                continueHint={NO_RULES_WORDS}
                onTasks={() => navigate("commands")}
                progress={
                  job()?.project_id === current().project.id && job()?.entity_id === current().entity_id
                    ? modelProgress()
                    : null
                }
                generating={
                  active()?.projectId === current().project.id &&
                  job()?.entity_id === current().entity_id &&
                  job()?.kind === "generate-model"
                }
                onMode={navigate}
                onPrompt={setModelPrompt}
                onAdd={() => {
                  setEntityName("")
                  setEntityModal(true)
                }}
                onSelect={(entityId) => void openEntity(entityId)}
                onSaved={(next) => {
                  apply(next)
                  setEditorDirty(false)
                  notify("模型已保存")
                }}
                onDirty={setEditorDirty}
                onAnnotate={annotateModel}
                onError={setError}
                onGenerate={(prompt) => {
                  setModelProgress(null)
                  start(() =>
                    window.studio.generateModel({
                      projectId: current().project.id,
                      expectedRevision: current().project.revision,
                      prompt,
                    }),
                  )
                }}
                onContinue={() => openBehavior(current().entity_id ?? "")}
                onBack={() => void navigate("overview")}
              />}</Show>
              <div class="workspace-job">{jobPanel()}</div>
            </Match>
            <Match when={page() === "share"}>
              <div class="page">
                {heading("分享工程")}
                <div class="share-columns">
                  <section class="panel share-panel">
                    <h2>导出工程</h2>
                    <Show
                      when={view()}
                      fallback={
                        <div class="empty">
                          <Icon name="folder" />
                          <p>先从工程库里打开一个工程</p>
                          <Button onClick={() => navigate("home")}>工程库</Button>
                        </div>
                      }
                    >
                      <h3>{current().project.name}</h3>
                      {environmentTag()}
                      <div class="resource-list">
                        <For each={current().project.entities}>
                          {(value) => (
                            <div class="resource-row">
                              <Icon name="cube" />
                              {value.name}
                            </div>
                          )}
                        </For>
                        <For each={current().project.blocks}>
                          {(value) => (
                            <div class="resource-row">
                              <Icon name="cube" />
                              {value.name}
                            </div>
                          )}
                        </For>
                        <For each={current().project.recipes}>
                          {(value) => (
                            <div class="resource-row">
                              <Icon name="recipe" />
                              {value.name}
                            </div>
                          )}
                        </For>
                      </div>
                      <Button
                        primary
                        disabled={busy()}
                        onClick={() =>
                          void perform(
                            () => window.studio.exportProject({ projectId: current().project.id }),
                            (result) => {
                              if (result) notify(`工程已导出：${result.path}`)
                            },
                          )
                        }
                      >
                        <Icon name="download" />
                        导出 .minemods
                      </Button>
                    </Show>
                  </section>
                  <section class="panel share-panel">
                    <h2>导入工程</h2>
                    <div class="import-target">
                      <Icon name="folder" />
                      <strong>{imported()?.name ?? "选择 .minemods 文件"}</strong>
                      <Button
                        disabled={busy()}
                        onClick={() => void perform(() => window.studio.chooseImport(), setImported)}
                      >
                        {imported() ? "更换文件" : "选文件"}
                      </Button>
                    </div>
                    <Show when={imported()}>
                      <h3>{imported()!.project.name}</h3>
                      <p class="muted">
                        Minecraft {imported()!.environment.minecraft} · {LOADER_NAMES[imported()!.environment.loader as keyof typeof LOADER_NAMES] ?? imported()!.environment.loader} {imported()!.environment.loaderVersion}
                      </p>
                    </Show>
                    <Button
                      primary
                      disabled={busy() || !imported()}
                      onClick={() =>
                        void perform(
                          () => window.studio.importProject({ token: imported()!.token }),
                          (next) => {
                            activate(next)
                            setImported(null)
                            setPage("overview")
                            notify("工程已导入")
                          },
                        )
                      }
                    >
                      导入工程
                    </Button>
                  </section>
                </div>
              </div>
            </Match>
            <Match when={page() === "profile"}>
              <PersonalSettings
                settings={settings()}
                workspace={environment()?.workspace}
                onSave={async (next) => {
                  const saved = await window.studio.saveSettings(next)
                  setSettings(saved)
                  return saved
                }}
                onChooseDirectory={async () => {
                  const location = await window.studio.chooseProjectLocation()
                  if (!location) return null
                  const saved = await window.studio.saveProjectsDirectory({ locationToken: location.token })
                  setSettings(saved)
                  return saved
                }}
                onResetDirectory={async () => {
                  const saved = await window.studio.saveProjectsDirectory({ locationToken: null })
                  setSettings(saved)
                  return saved
                }}
                backLabel={settingsWay().label}
                cameFrom={settingsWay().said}
                onBack={() => navigate(settingsWay().to)}
                onResources={(tab) => {
                  setResourcesFromSettings(true)
                  setResourceTab(tab)
                  void navigate("resources")
                }}
                connection={
                  <Show when={connection()}>
                    {(value) => (
                      <section class="connection-settings connection-summary panel"><p role="status">{chip().text}</p>
                        <Button onClick={() => setConnectionOpen(true)}>重新连接</Button>
                        <label><input type="checkbox" aria-label="审查" checked={reviewEnabled(value())} disabled={running() || busy()}
                          onChange={event => void saveConnection({ ...editableConnection(value()), review: event.currentTarget.checked }).catch(cause => setError(errorMessage(cause)))} /> 审查 · {reviewEnabled(value()) ? "开着" : "关着"}</label>
                        <p>打开以后，每样东西做完再请另一个 AI 检查一遍。用自己的助手要多开一个对话，用密钥会增加花费。</p>
                      </section>
                    )}
                  </Show>
                }
              />
            </Match>
          </Switch>
        </main>
      </div>
      <Show when={buildOpen() && view()}>
        <div
          class="drawer-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setBuildOpen(false)
          }}
        >
          <aside class="build-drawer" role="dialog" aria-modal="true" aria-labelledby="build-title">
            <header class="build-drawer-head">
              <h2 id="build-title">打包模组 · {current().project.name}</h2>
              <button class="title-icon" aria-label="关闭打包抽屉" onClick={() => setBuildOpen(false)}>
                <Icon name="close" />
              </button>
            </header>
            <div class="build-drawer-body">
              <Show when={advanced()}>
                <p class="advanced-note" role="status">
                  {advancedLine("build")}
                </p>
              </Show>
              <section class="build-step">
                <h3>会打包进去的东西</h3>
                {/* Which pack this panel talks about: one version, with what was made after it kept apart. The count below is of the next pack, not of this one. */}
                <Show when={version()}>
                  {(shown) => (
                    <div class="version-block" role="status">
                      <div class={`check-row${shown().later ? " warn" : ""}`}>
                        <Icon name={shown().later ? "document" : "check"} />
                        <strong>{shown().pack}</strong>
                        <Show when={shown().same}>
                          <span>{shown().same}</span>
                        </Show>
                      </div>
                      <Show when={shown().later}>
                        <p class="build-note">{shown().later}</p>
                      </Show>
                      <Show when={shown().note}>
                        <p class="build-note">{shown().note}</p>
                      </Show>
                      <Show when={shown().restart}>
                        <div class="build-actions">
                          <Button disabled={busy()} onClick={() => void cancelAndPackAgain()}>
                            <Icon name="play" />
                            {shown().restart}
                          </Button>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
                <div class="check-row">
                  <Icon name="check" />
                  <strong>
                    {/* broad7 w2: gameplay code was built in but not listed, and read as left out. */}
                    {buildCounts(current().project)}
                  </strong>
                  <span>{panel()?.latest ? "再打包一次会带上这些" : "会打包进模组"}</span>
                </div>
                <For each={current().project.entities.filter((entity) => !entity.model_asset_id)}>
                  {(entity) => <p class="build-note">「{entity.name}」还没有模型，这次不会做进模组。打开外观页，把模型带进来或做一个，再打包。</p>}
                </For>
                {/* 补字 (E19): which characters the game's fonts lack go in as the mod's own glyphs, and which stay boxes. */}
                <Show when={glyphLines(panel()?.glyphs)}>
                  {(lines) => (
                    <>
                      <Show when={lines().filled}>
                        {(line) => (
                          <div class="check-row">
                            <Icon name="check" />
                            <strong>{line().text}</strong>
                            <span>{line().note}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={lines().missing}>
                        {(line) => (
                          <div class="check-row warn">
                            <Icon name="document" />
                            <strong>{line().text}</strong>
                            <span>{line().note}</span>
                          </div>
                        )}
                      </Show>
                    </>
                  )}
                </Show>
                <Show when={draftCount()}>
                  <div class="check-row warn">
                    <Icon name="document" />
                    <strong>{draftCount()} 样只是设计稿</strong>
                    <span>保存在工程里，这次不会{WORDS.into_mod}</span>
                  </div>
                </Show>
                <div class="check-row">
                  <Icon name="check" />
                  <strong>{projectTarget() ? targetLine(projectTarget()!) : environmentFacts()}</strong>
                  <span>模组是给这个版本做的</span>
                </div>
                <Show when={projectTarget()?.java ?? environment()?.profiles?.[0]?.java}>
                  {(major) => <JavaCard compact major={major()} after={jobsEnded() + aheadMoved()} buildProblem={javaBuildProblem()} />}
                </Show>
              </section>
              <section class="build-step play-chain" aria-live="polite">
                <h3>操作进度</h3>
                {/* Only while nothing of this press is running: a press that waits for the preparation says it itself, in the stage's own line. */}
                <Show when={!shownChain()?.running}>
                  <Show
                    when={panel()?.preparing}
                    fallback={
                      <Show when={panel()?.prepareFailed}>
                        {(failed) => <p class="build-note">{AHEAD_WORDS.failed(failed())}</p>}
                      </Show>
                    }
                  >
                    <p class="build-note">{panel()?.prepareStep ? `${AHEAD_WORDS.now}：${AHEAD_WORDS.step[panel()!.prepareStep!]}` : AHEAD_WORDS.now}</p>
                    <Show when={panel()?.prepareCounter}>
                      <p class="chain-now">{panel()?.prepareCounter}</p>
                    </Show>
                  </Show>
                </Show>
                <Show when={scene() && !scene()!.eula}>
                  <SceneEula onAgree={() => void window.studio.agreeSceneEula().then(() => readScene(current().project.id))} />
                </Show>
                <Show when={shownChain()}>
                  {(run) => (
                    <>
                      <ol class="chain-stages">
                        <For each={chainStages(run().want)}>
                          {(stage) => (
                            <li class={run().running?.stage === stage ? "now" : ""}>
                              <div class="chain-stage-head">
                                <strong>{CHAIN_WORDS.stage[stage]}</strong>
                                <span>{chainStageWords(run(), stage)}</span>
                              </div>
                              <Show when={run().running?.stage === stage}>
                                <Show when={runningNote(stage, jobDetail(), run().ready?.[stage], run().whole?.[stage], run().cold?.[stage])}>
                                  {(note) => <p class="build-note">{note()}</p>}
                                </Show>
                                <Show when={stageWaitOf(run(), stage)}>
                                  {(wait) => (
                                    <>
                                      <Show when={wait().elapsed}>
                                        <p class="build-note">{wait().elapsed}</p>
                                      </Show>
                                      {/* The real counter the job wrote; with none, nothing is made up. */}
                                      <Show when={wait().counter && wait().counter !== plainProgress(jobDetail())}>
                                        <p class="chain-now">{wait().counter}</p>
                                      </Show>
                                      <Show when={wait().stalled}>
                                        {(stalled) => (
                                          <div class="chain-stop warn" role="status">
                                            <p>{stalled().lead}</p>
                                            <p>{stalled().can}</p>
                                          </div>
                                        )}
                                      </Show>
                                    </>
                                  )}
                                </Show>
                                <Show when={plainProgress(jobDetail())}>
                                  <p class="chain-now">{plainProgress(jobDetail())}</p>
                                </Show>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ol>
                      <Show when={!run().stop && !run().running}>
                        <p class="build-note">正在准备…</p>
                      </Show>
                      <Show when={run().stop}>
                        <div class={`chain-stop ${["built", "played", "left"].includes(run().stop!) ? "" : "warn"}`} role="status">
                          <p>{chainStopWords(run())}</p>
                          <Show when={["build_failed", "check_failed", "play_failed", "crashed"].includes(run().stop!) && run().error}>
                            <p>{run().stop === "crashed" ? crashDetails(run().error) : run().error}</p>
                            <Show when={run().stop === "crashed"}>
                              {/* Where the stack first entered the mod and what the game threw: for whoever reads the report, not for everyone. */}
                              <Show when={advanced() && run().crash}>
                                <pre class="build-note">{run().crash}</pre>
                              </Show>
                              <CrashFix projectId={run().projectId} busy={busy() || !!active()} />
                            </Show>
                            {/* A failure that named the thing it stopped on leads to that thing's card (see `jobTarget`). */}
                            <FindingGo finding={{ targets: run().go ? [run().go!] : [] }} onGo={goToTarget} />
                          </Show>
                          <Show when={run().stop === "found"}>
                            <ul>
                              <For each={run().lines}>{(line) => <li>{line}</li>}</For>
                            </ul>
                          </Show>
                          <Show when={run().stop === "eula"}>
                            <p class="build-note">{CHAIN_WORDS.licence}</p>
                            <p class="build-note">{CHAIN_WORDS.openBareNote}</p>
                            <ByHand project={current().project} />
                            <div class="build-actions">
                              {/* The person's own click is the agreement; the chain then reads the licence line again and goes on with the check. */}
                              <Button
                                primary
                                disabled={busy() || !!active()}
                                onClick={() => {
                                  const base = { ...run(), stop: null }
                                  void window.studio.agreeSceneEula().then(() => advanceChain(base, null), () => undefined)
                                }}
                              >
                                <Icon name="check" />
                                {CHAIN_WORDS.agree}
                              </Button>
                              <Button disabled={busy() || !!active()} onClick={() => void advanceChain({ ...run(), stop: null }, "open")}>
                                <Icon name="play" />
                                {CHAIN_WORDS.openBare}
                              </Button>
                            </div>
                          </Show>
                          <Show when={run().stop === "making"}>
                            <div class="build-actions">
                              <Button primary disabled={busy() || !!active()} onClick={() => void advanceChain({ ...run(), stop: null }, "now")}>
                                <Icon name="tool" />
                                {CHAIN_WORDS.packNow}
                              </Button>
                              <Button disabled={busy() || !!active()} onClick={() => void advanceChain({ ...run(), stop: null }, "leave")}>{CHAIN_WORDS.waitForAi}</Button>
                            </div>
                          </Show>
                          {/* One press packs the project as it is now and goes on the way the first press would have; no need to find out that it must be pressed again. */}
                          <Show when={run().stop === "build_stale"}>
                            <div class="build-actions">
                              <Button primary disabled={busy() || !!active()} onClick={() => playNow(run().want)}>
                                <Icon name="play" />
                                {CHAIN_WORDS.again(run().want)}
                              </Button>
                            </div>
                          </Show>
                          <Show when={run().stop === "found" || run().stop === "check_failed"}>
                            <div class="build-actions">
                              <Button primary disabled={busy() || !!active()} onClick={() => void advanceChain({ ...run(), stop: null }, "open")}>
                                <Icon name="play" />
                                {CHAIN_WORDS.open}
                              </Button>
                              <Button onClick={() => void advanceChain({ ...run(), stop: null }, "leave")}>{CHAIN_WORDS.leave}</Button>
                            </div>
                          </Show>
                        </div>
                      </Show>
                      {/* The game was opened on its main menu with nothing set out: how to see the things by hand stays while the game is open and after, which is when it is needed. */}
                      <Show when={run().bare && run().stop !== "eula"}>
                        <ByHand project={current().project} />
                      </Show>
                    </>
                  )}
                </Show>
                <div class="build-actions">
                  {/* While a stop of the press in progress has buttons of its own, the ordinary pair would compete with them (see `chainOwnsNextAction`). */}
                  <Show when={!chainOwnsNextAction(shownChain()?.stop)}>
                    <Button primary={shownChain()?.want !== "jar"} disabled={busy() || !!active() || chainBusy()} onClick={() => playNow()}>
                      <Icon name="play" />
                      {version()?.start?.play ?? CHAIN_WORDS.start}
                    </Button>
                    <Button primary={shownChain()?.want === "jar"} disabled={busy() || !!active() || chainBusy()} onClick={() => playNow("jar")}>
                      <Icon name="tool" />
                      {version()?.start?.jar ?? CHAIN_WORDS.jar}
                    </Button>
                  </Show>
                  {/* After playing, the file is what is left to do: it is here beside the play buttons, and it is the same whether or not the game is still open. */}
                  <Show when={current().latest_build_job_id}><Button onClick={revealJar}>打开模组文件所在的文件夹</Button></Show>
                  <Button disabled={exportState().off} onClick={() => exportJarNow()}>
                    <Icon name="download" />
                    {EXPORT_WORDS.button}
                  </Button>
                  <Show when={active()}>
                    <Button onClick={() => void perform(() => window.studio.cancelJob(active()!), setJob)}>
                      取消
                    </Button>
                  </Show>
                </div>
                <Show when={exportState().why}>
                  <p class="build-note">{exportState().why}</p>
                </Show>
                {/* What the tools themselves printed, and the job's own state: for whoever asked to see it. */}
                <Show when={advanced() && (active() || job())}>
                  <pre class="log">{job()?.error ?? (jobDetail() ? jobDetail() : JOB_STATE_WORDS[job()?.state ?? "queued"])}</pre>
                </Show>
                <p class="build-note">取消或失败都不会删掉上一次成功的打包。</p>
              </section>
              <BuildWarningResult projectId={current().project.id} jobId={shownChain()?.build ?? current().latest_build_job_id} currentId={current().latest_build_job_id} currentWarnings={current().latest_build_warnings} advanced={advanced()} />
              <TestScene
                scene={scene()}
                projectId={current().project.id}
                targetId={current().project.target}
                revision={current().project.revision}
                buildJobId={current().latest_build_job_id ?? null}
                busy={busy() || !!active()}
                start={(action) => void start(action)}
                onGo={goToTarget}
              />
              <Show when={advanced()}>
                <section class="build-step">
                  <h3>开发环境试玩</h3>
                  <p class="build-note">和测试场不同：这里跑的是源码的开发版本，不是打包出来的 jar。</p>
                  <Button
                    class="full"
                    disabled={busy() || !!active() || !current().latest_build_job_id}
                    onClick={() =>
                      void start(() =>
                        window.studio.startPlaytest({
                          projectId: current().project.id,
                          jobId: current().latest_build_job_id!,
                        }),
                      )
                    }
                  >
                    <Icon name="play" />
                    {current().latest_build_job_id ? "打开开发环境的游戏" : "打包成功后才能打开"}
                  </Button>
                </section>
              </Show>
              {/* The mod's name, icon, author, version and licence are edited on one page (round 19); this panel only says what the next build will carry and links there. */}
              <section class="build-step mod-info-link">
                <h3>{INFO_WORDS.title}</h3>
                <div class="check-row">
                  <Icon name="document" />
                  <strong>{current().project.name}</strong>
                  <span>{infoLine(current().project, settings().nickname)}</span>
                </div>
                <p class="build-note">{current().project.icon ? "已经选了图标。" : "还没有选图标。"}改了要重新打包才会带上。</p>
                <Button disabled={busy() || !!active()} onClick={() => openInfo()}>
                  {INFO_WORDS.open}（名字、图标、作者、版本、许可证）
                </Button>
              </section>
              <section class="build-step">
                <h3>导出与分享</h3>
                <button
                  class="export-row"
                  disabled={busy()}
                  onClick={() =>
                    void perform(
                      () => window.studio.exportProject({ projectId: current().project.id }),
                      (result) => {
                        if (result) notify(`工程已导出：${result.path}`)
                      },
                    )
                  }
                >
                  <span class="slot-icon">
                    <Icon name="share" />
                  </span>
                  <span>
                    <strong>工程文件 .minemods</strong>
                    <small>发给朋友，对方可以打开继续编辑</small>
                  </span>
                </button>
                <button
                  class="export-row"
                  disabled={busy() || !!active()}
                  onClick={() =>
                    void perform(
                      () => window.studio.exportSource({ projectId: current().project.id }),
                      (result) => notify(`源码已导出：${result.path}`),
                    )
                  }
                >
                  <span class="slot-icon">
                    <Icon name="document" />
                  </span>
                  <span>
                    <strong>源代码</strong>
                    <small>完整的 {targetLoaderName(current().project.target)} 源码，给想自己改代码的人</small>
                  </span>
                </button>
              </section>
            </div>
          </aside>
        </div>
      </Show>
      <MadeProjectBar made={madeOffer()} onOpen={(id) => void openMade(id)} onDismiss={() => setMadeOffer(null)} />
      {/* The live region stands before there is anything to say: one put up together with its words is often not read out. */}
      <div role="status">
        <Show when={toast()}>
          <div class="toast">{toast()}</div>
        </Show>
      </div>
      <Show when={conflict()}>
        <div class="modal-backdrop" data-route="conflict">
          <section class="modal" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
            <h2 id="conflict-title">工程版本需要确认</h2>
            <p style={{ "line-height": "1.7", color: "var(--muted)" }}>
              {error() === REVISION_CONFLICT
                ? "这个工程刚在别处被改过（比如外面的 AI，或者另一个窗口），你这里看到的不是最新的。刚才那一步没有存进去，已有的东西也没有被覆盖。"
                : "这个文件是用别的版本做的，现在这个 Studio 打不开它。"}
            </p>
            <Show when={advanced()}>
              <pre class="log">{error()}</pre>
            </Show>
            <div class="page-actions">
              <Button onClick={() => setConflict(false)}>保留当前编辑</Button>
              <Show when={view() && error() === REVISION_CONFLICT}>
                <Button
                  primary
                  onClick={() =>
                    void perform(
                      () => window.studio.openProject(current().project.id),
                      (next) => {
                        setEditorDirty(false)
                        setContentDirty(false)
                        apply(next)
                        setPage("overview")
                        setConflict(false)
                      },
                    )
                  }
                >
                  重新载入工程
                </Button>
              </Show>
            </div>
          </section>
        </div>
      </Show>
      <ConfirmDialog />
      <Show when={entityModal()}>
        <CardShell title="新增生物" manageFocus onClose={() => setEntityModal(false)}>
          <form class="new-asset-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              if (!entityName().trim()) {
                setEntityNameMissing(true)
                event.currentTarget.querySelector("input")?.focus()
                return
              }
              void perform(
                () =>
                  window.studio.addEntity({
                    projectId: current().project.id,
                    expectedRevision: current().project.revision,
                    name: entityName(),
                  }),
                (next) => {
                  apply(next)
                  setEntityModal(false)
                  setPage("model")
                },
              )
            }}
          >
            <label class="field">
              名称
              <input
                aria-label="生物名称"
                required
                aria-invalid={entityNameMissing()}
                aria-describedby={entityNameMissing() ? "entity-name-error" : undefined}
                maxlength="120"
                placeholder="例如：铜鸮"
                value={entityName()}
                onInput={(event) => { setEntityName(event.currentTarget.value); if (event.currentTarget.value.trim()) setEntityNameMissing(false) }}
              />
              <Show when={entityNameMissing()}><span id="entity-name-error" class="create-problem" role="alert">先给生物起个名字。</span></Show>
            </label>
            <div class="page-actions">
              <Button onClick={() => setEntityModal(false)}>取消</Button>
              <Button primary type="submit" disabled={busy()}>
                开始制作
              </Button>
            </div>
          </form>
        </CardShell>
      </Show>
    </div>
  )
}
render(() => <StudioApp />, document.getElementById("root")!)
