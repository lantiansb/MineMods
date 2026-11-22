import { SOLID_BODY_WORDS } from "@minemods/mod-core/creature-hitbox"
import { ASSET_ACTIONS } from "./mcp-asset-actions"
import { PARTICLE_GUIDE } from "@minemods/mod-core/particle"
import { createHash } from "node:crypto"
import { PLAN_CHECK_WORDS } from "@minemods/mod-core/blueprint-constraints"
import { MODEL_POSE_SCRIPT } from "@minemods/studio-ai/script"
import { APPENDAGE_GUIDE, CREATURE_COMBAT_GUIDE, PARTICLE_DESIGN_GUIDE } from "@minemods/mod-core/combat-design-words"
import { gameplayCapability } from "./gameplay-handoff"
import { z } from "zod"
import { getModuleSchema } from "@minemods/mod-core/workspace"
import { ASSET_KINDS, kindLabels, kindTargets } from "@minemods/mod-core/workspace-modules"
import { GESTURE_BOUNDARY } from "@minemods/mod-core/gesture-rig"
import { PROJECT_RUN_LIMITS } from "@minemods/mod-core/workspace-runs"
import { listTargetManifests } from "@minemods/mod-core/target/manifests"
import { DEFAULT_TARGET, TargetIdSchema, type TargetId } from "@minemods/mod-core/target/ids"
import { targetWords } from "@minemods/mod-core/target/words"
import { BUILD_WARNING_SEVERITY_WORDS } from "./mcp-handoff"
import { ASSET_STANDARDS, CRITERIA, EXCUSES, REFUSAL_CAP, SEVERITIES, STANDARD_SUMMARY, coverage } from "@minemods/mod-core/acceptance"
import { MODEL_COMPLEXITY_PRESETS, type ModelComplexity } from "@minemods/studio-ai/model-quality"
import { BLOCK_SHAPE } from "@minemods/studio-ai/block-shape"
import { CROP_LIMITS } from "@minemods/mod-core/image-crop"
import { version } from "../../package.json"
import { ABILITY_REVIEW_GUIDE, CONCEPT_GUIDE, FINDING_CONTRASTS, FINDING_LABELS, FINDING_LINE, LOOKED_KINDS, MAKING_DISCIPLINE, MAKING_LIMITS, MAKING_MODELS, MAKING_SUMMARY, PICTURE_GUIDE, REFERENCE_GUIDE, REFERENCE_LIMITS, REFERENCE_ZOOM_GUIDE, REVIEWER_HANDOFF, SOLO_VOICE, SIX_VIEW_NAME, SIX_VIEW_WORDS, SIX_VIEWS, THREE_VIEW_GUIDE, THREE_VIEW_REVIEW_RULE, UNSATISFIED } from "@minemods/studio-ai/making"
import { DRAWN_KINDS, DRAWN_SUMMARY, SCRIPT_API, SCRIPT_EXAMPLE, SCRIPT_GUIDE, SCRIPT_LIMITS, SCRIPT_SUMMARY, SCRIPTED_KINDS } from "@minemods/studio-ai/script"
import { BLOCK_SOUNDS, CREATURE_SOUNDS, DATA_CAPABILITY, ORE_BASES, ORE_BIOME_GROUPS, ORE_DIMENSIONS, ORE_LIMITS, TOOL_TIERS } from "@minemods/mod-core/data-words"
import { BUILT_IN_MOTIONS } from "@minemods/mod-core/reconcile"
import { GAMEPLAY_API } from "@minemods/mod-core/gameplay"
import { CREATURE_TIER_CAPABILITY, DETAIL_WORDS } from "@minemods/mod-core/creature-tier"
import { PLAY_ORDER, PLAY_QUESTIONS, PLAYABLE_CAPABILITY } from "@minemods/mod-core/playable"
import { CLAIM_GUIDE } from "./mcp-guide-topics"
import { guideIndex } from "./mcp-guide"
import { MCP_BLUEPRINT_WORKFLOW, MCP_MAKING_ENDINGS, MCP_MAKING_REFUSALS, MCP_MAKING_WORKFLOW, MCP_SIX_VIEW_WORKFLOW, MCP_TOOLS } from "./mcp-handoff"

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

/** What an outside AI is told about 「审查」 as it is switched now. */
export const MCP_INSPECTION = {
  on: "审查开着：一版自评说做完以后，验收由另一个窗口里的审查 AI 来做。做东西的 AI 调用 await_inspection 等它的结论，不自己调用 final_review 写结论；审查的 AI 用 next_inspection 领下一样、用 final_review 写结论，只评不改。",
  off: "审查关着：用户不另请评审，没有另一个窗口来审查，你也不要另开子代理充当评审。做东西的 AI 自己用 final_review 取验收材料、自己对着核对并记下结论，independent 写 false（写 true 会被退回）；next_inspection 不会给出任何东西。",
} as const

// Derive the inventory from the same schemas and limits enforced by task execution.
// `capability` is the answer for today's only build target; `targets` carries the answer per target.
const modules = ASSET_KINDS.map((kind) => ({
  module: kind.id,
  ...(kind.id === "music" ? {summary:kind.summary} : {}),
  label: kind.label,
  capability: kind.capability,
  schema_fingerprint: fingerprint(z.toJSONSchema(getModuleSchema(kind.id), { target: "draft-7" })),
  instructions_fingerprint: fingerprint(kind.instructions),
  schema_tool: "module_schema",
  targets: kindTargets(kind.id),
  group: kind.group,
  owner: kind.owner,
  references: kind.references,
  verify: kind.verify,
}))

const contract = {
  protocol_version: 1,
  tools: MCP_TOOLS.map(([name, description, input_contract]) => ({ name, description, input_contract })),
  modules,
  limits: PROJECT_RUN_LIMITS,
  model_complexity_presets: MODEL_COMPLEXITY_PRESETS,
  // creature tier (10-12): every tier of a creature entry (the table has five since 史诗) and what each asks, from the table the app itself uses.
  creature_tiers: CREATURE_TIER_CAPABILITY,
  solid_body: { field: "hitbox.parts[].solid", core: "hitbox.core.solid", blockers: "hitbox.blockers", max_blockers: 8, default: false, instructions: SOLID_BODY_WORDS },
  // Every game version × loader Studio has a manifest for, from the manifests themselves; only a ready one can be picked
  // (create_project's `target`), and a project's own is in its view (`target`, `targets`). A project without one is the default.
  build_targets: listTargetManifests().map((manifest) => {
    const words = targetWords(TargetIdSchema.parse(manifest.id))
    return {
      id: manifest.id,
      minecraft: manifest.minecraft.version,
      loader: manifest.loader.kind,
      loader_version: manifest.loader.version,
      java_major: manifest.java.major,
      naming: words.naming.scheme,
      geckolib: words.geckolib,
      ready: manifest.ready,
      why: manifest.why,
      default: manifest.id === DEFAULT_TARGET,
    }
  }),
}

/** `inspection.review`: 「审查」 as the person has it switched now (the runner's `options.ai.review`); left out, on, as the runner reads it. */
export function getMcpCapabilities(complexity: ModelComplexity, inspection: { review?: boolean; target?: TargetId | undefined } = {}) {
  const review = inspection.review !== false
  return {
    ...contract,
    server: { name: "minemods-studio-external", version },
    contract_fingerprint: fingerprint(contract),
    asset_management: ASSET_ACTIONS,
    // The one standard commit_task holds every kind to, generated from the definitions that do the judging.
    acceptance: {
      summary: STANDARD_SUMMARY,
      criteria: CRITERIA.map((value) => ({ id: value.id, name: value.name, meaning: value.meaning, examples: value.examples, fix: value.fix })),
      // Per kind: what each criterion checks, and where it is honestly not measured yet.
      kinds: coverage(ASSET_KINDS.map((kind) => ASSET_STANDARDS[kind.id])),
      // How much a finding weighs, and the only things a brief may say that excuse a rule.
      severities: Object.values(SEVERITIES),
      excuses: Object.values(EXCUSES).map((value) => value.label),
      refusal_cap: REFUSAL_CAP,
      active_task_source: "claim_task.quality",
      refusal: `commit_task 没通过验收时任务保持 running，返回的文字逐条写着是哪一条标准、发现了什么、怎么改；update_task 返回的 drafts[taskId].quality 是同一份检查，passed 为 true 才会通过。同一个任务最多被退回 ${REFUSAL_CAP} 次，之后记为没做成。`,
    },
    // How the kinds with a look are made. The tool gives eyes and an order of work; it has no templates and no part kits.
    making: {
      summary: MAKING_SUMMARY,
      discipline: MAKING_DISCIPLINE,
      kinds: LOOKED_KINDS,
      workflow: MCP_MAKING_WORKFLOW,
      limits: {
        rounds: MAKING_LIMITS.rounds,
        pictures_per_look: MAKING_LIMITS.sheets,
        // A review is given the whole set at once, drawn by Studio; it may ask for a little more.
        pictures_per_review: MAKING_LIMITS.review_sheets,
        review_needs: MAKING_LIMITS.needs,
        pictures_per_need: MAKING_LIMITS.need_items,
        picture_pixels: MAKING_LIMITS.sheet,
        frames_per_strip: MAKING_LIMITS.frames,
        parts: MAKING_LIMITS.parts,
        // 边做边看: looks with `glance: true` that record nothing, per task.
        glances: MAKING_LIMITS.glances,
      },
      // 「审查」: who holds the review of a finished version. On, a second AI window does and the maker waits for it; off, the maker arranges it itself.
      inspection: {
        review,
        tools: ["await_inspection", "next_inspection"],
        rule: review ? MCP_INSPECTION.on : MCP_INSPECTION.off,
      },
      // The one line between what fails a review and what does not. Self-review and the reviewer use the same.
      findings: { blocking: FINDING_LABELS.blocking, advice: FINDING_LABELS.advice, line: FINDING_LINE, contrasts: FINDING_CONTRASTS },
      // What a review is of: this one asset against its sheet, never the whole request.
      review_scope: "评审只评这一样东西本身：对照它的部件说明和适用于这一类的验收标准。final_review 返回的 input.judging 写着验收的是什么，input.not_judged 写着不验收的（行为、别的资产、蓝图里写明不做的），request 只作背景。",
      pictures: PICTURE_GUIDE,
      // What commit_task answers when a step was skipped, word for word.
      refusals: MCP_MAKING_REFUSALS,
      // Nothing looked at is thrown away: how a making that ends without a pass turns out.
      endings: MCP_MAKING_ENDINGS,
      unsatisfied: `版数用完、最后一次验收没过或者 fail_task 时，看过的、没有硬伤的最新一版会存进工程，标明“${UNSATISFIED.mark}”和原因，交给用户验收；依赖它的内容不会被卡住。最后可不可以由用户决定。`,
      // Round 10: a creature with abilities is looked at and reviewed too, without a part sheet; one without is handed in directly.
      creatures: ABILITY_REVIEW_GUIDE,
      combat_design: CREATURE_COMBAT_GUIDE.trimStart() + PARTICLE_DESIGN_GUIDE,
      // Round 10: a look and a draft run the save's own checks and compile without writing, so nothing looked at is refused at the hand-in for a reason nobody was told.
      saveable: "look 的 findings 和 update_task 返回的 drafts[taskId].unsaveable 会写明这一版照现在的样子存不存得进工程，用的是 commit_task 拒绝时的同一句话；commit_task 因此拒绝时任务保持 running，不算失败。",
      models: MAKING_MODELS,
      model_pose: MODEL_POSE_SCRIPT + APPENDAGE_GUIDE,
      // Studio cannot start a fresh model for an outside client: independence is the client's to arrange and to declare.
      independent_review: review ? REVIEWER_HANDOFF : SOLO_VOICE.handoff,
      active_task_source: "claim_task.making",
      // Script modelling: a second, equal way to hand in a model, a texture or an animation.
      script: { summary: SCRIPT_SUMMARY, kinds: SCRIPTED_KINDS, tools: ["look", "update_task", "commit_task"], limits: { characters: SCRIPT_LIMITS.source, seconds: SCRIPT_LIMITS.seconds, memory_mb: SCRIPT_LIMITS.memory_mb }, api: SCRIPT_API.map((entry) => ({ call: entry[0], does: entry[1] })), example: SCRIPT_EXAMPLE, guide: SCRIPT_GUIDE },
      // 2D textures (Engineer E4): a block's or an item's own picture drawn by script, beside its document.
      particle: {guide:PARTICLE_GUIDE,shapes:"list_particle_shapes",look_options:"particle_emit 可传 count、shape、spread、velocity、motion、yaw、tint 和 seed。"},
      drawn: { summary: DRAWN_SUMMARY, kinds: DRAWN_KINDS, tools: ["look", "update_task", "commit_task"] },
      // Reference images: the person's own, and pictures the maker may draw of what it intends (`save_concepts`; a model, an item or a block; a drawing script can trace one with `api.trace`).
      // Six views follow the person's request; a real outside image tool may submit one without replacing a person's own picture.
      references: { guide: REFERENCE_GUIDE, concepts: CONCEPT_GUIDE, tool: "save_concepts", zoom: { tool: "view_reference", guide: REFERENCE_ZOOM_GUIDE, longest_side: CROP_LIMITS.side, most_enlarged: CROP_LIMITS.upscale, units: ["fraction", "pixels"] }, three_view: { name: SIX_VIEW_NAME, guide: THREE_VIEW_GUIDE, review: THREE_VIEW_REVIEW_RULE, slots: ["sheet", ...SIX_VIEWS], views: SIX_VIEW_WORDS, source: "claim_task.making.three_view", who: MCP_SIX_VIEW_WORKFLOW, prompt_tool: "get_six_view_prompt", finish_tool: "finish_six_view" }, limits: { user: REFERENCE_LIMITS.user, concept: REFERENCE_LIMITS.concept, three_view: REFERENCE_LIMITS.three_view, megabytes: REFERENCE_LIMITS.bytes / 1024 / 1024, shown_on_sheet: REFERENCE_LIMITS.shown, sheets_per_look: MAKING_LIMITS.reference_sheets }, formats: ["png", "jpeg", "webp"] },
      templates: "没有。Studio 不提供任何题材的模板、现成零件或配方；paint/features 和内置基础动作只是可选的写法，不是默认做法。",
    },
    // Gameplay (Engineer D): code an AI writes, as an asset kind with its own checks.
    gameplay: gameplayCapability(review, inspection.target),
    // Data-only gameplay (Engineer C): what reaches the game through data and fixed generic code, and where it stops.
    data_gameplay: {
      ...DATA_CAPABILITY,
      fields: { block: ["generation", "tool_tier", "drop", "drop_item", "experience", "sound", "shape"], entity: ["sounds"] },
      generation: { dimensions: Object.keys(ORE_DIMENSIONS), replaces: Object.fromEntries(Object.entries(ORE_BASES).map(([base, value]) => [base, value.dimension])), biome_groups: ORE_BIOME_GROUPS, limits: ORE_LIMITS },
      // A block's shape: the limits its boxes are held to (the same numbers the schema refuses over).
      shape: { limits: BLOCK_SHAPE },
      tool_tiers: Object.keys(TOOL_TIERS),
      block_sounds: BLOCK_SOUNDS,
      creature_sounds: CREATURE_SOUNDS,
      // The only animations generated code ever starts; anything else in a model needs a play_animation rule or gameplay code.
      animations_played: { always: BUILT_IN_MOTIONS, by_rule: "logic.action=play_animation 的 animation", by_gameplay: `玩法代码调用 ${GAMEPLAY_API.content}.${GAMEPLAY_API.motionMethod}(生物, "动作名")` },
      reconciliation: { tool: "get_mod_guide", at_build: `构建完成的 job output.warnings 逐条给出。${BUILD_WARNING_SEVERITY_WORDS}`, no_ai: true, no_game: true },
      build_outputs: ["jar 旁边的 模组说明.md", "jar 旁边 models 文件夹里每只生物的 .bbmodel（Blockbench 自带的 Bedrock Entity 格式，不用装插件）"],
    },
    // The model tier is a floor for detail, never a target. This is the button's own level; a creature's tier may raise its model above it (`creature_tiers`), and the task says the one it is made by.
    model_quality: {
      complexity,
      minimum: MODEL_COMPLEXITY_PRESETS[complexity],
      creature_tier_may_raise: DETAIL_WORDS.told,
      scope: "new_runs",
      active_task_source: "claim_task.quality",
    },
    // What the start-up text no longer carries, by topic: read with `get_guide`; each claimed task brings the topics of its kind.
    guide: { tool: "get_guide", topics: guideIndex({ complexity, review }), by_kind: CLAIM_GUIDE, active_task_source: "claim_task.guide" },
    // After a build: a background check of the mod in the test scene (no window; no look at the game).
    workflow: ["module_schema", "plan_run", "claim_task", "save_sheet", "look", "self_review", "final_review", "update_task", "commit_task", "build_project", "get_build", "check_scene", "get_scene_check"],
    // For a whole mod from one sentence. The plan stays a draft until the person confirms it in Studio.
    blueprint_workflow: MCP_BLUEPRINT_WORKFLOW,
    // Optional, before the plan: cards an AI proposes and only the person chooses from.
    idea_workflow: ["get_ideas", "propose_ideas", "get_ideas", "propose_blueprint"],
    // What the person said must hold is locked; a plan that breaks one is refused at `propose_blueprint`.
    locked_requirements: {
      rule: review
        ? "用户亲口提的要求逐字保存、逐条锁定。蓝图的每个条目要写明涉及哪条要求、怎么遵守；提交时附上只看得到要求和条目的评审的核对结论。违反、漏答、漏核对都会被拒绝，只有用户能在 Studio 里放开某一条。"
        : "用户亲口提的要求逐字保存、逐条锁定。蓝图的每个条目要写明涉及哪条要求、怎么遵守；提交时附上你自己只对着要求和条目逐条核对的结论（审查关着，没有别的评审）。违反、漏答、漏核对都会被拒绝，只有用户能在 Studio 里放开某一条。",
      check_source: "get_blueprint.requirements.check",
      // Studio has no model of its own in MCP mode: the comparison is the client's to run and to declare.
      independent_check: PLAN_CHECK_WORDS[review ? "independent" : "self"],
    },
    // The mod-level standard: every thing answers the questions that apply to its kind, or says why not.
    playable: {
      rule: PLAYABLE_CAPABILITY,
      questions: PLAY_ORDER.map((question) => ({ id: question, label: PLAY_QUESTIONS[question].label, asks: PLAY_QUESTIONS[question].asks })),
      applies: ASSET_KINDS.filter((kind) => kind.applies?.length).map((kind) => ({ kind: kind.id, questions: kind.applies })),
      paper_play_source: "get_blueprint.playable.paper_play",
    },
    // Every call that names a project is shown to the person in Studio's activity panel, refused or not.
    activity: "你对工程的每一次工具调用都会用大白话显示在 Studio 的动态边栏里，被拒绝的也会。",
    reverse_workflow: [
      "list_imports",
      "prepare_reverse_project",
      "get_reverse_state",
      "list_reverse_files",
      "start_reverse_task",
      "get_reverse_task",
      "submit_reverse_task",
      "apply_reverse_plan",
      "build_reverse_module",
    ],
    imported_asset_workflow: [
      "get_import_asset_selection",
      "extract_import_assets",
      "list_imported_assets",
      "read_imported_asset",
      "save_imported_asset",
      "build_import_asset_graph",
      "get_import_asset_graph",
      "start_import_asset_graph_analysis",
      "get_import_asset_graph_analysis",
      "submit_import_asset_graph_analysis",
    ],
    boundaries: [
      "runtime 表示模块可参与构建，不表示任意描述都受支持；必须读取 module_schema 的字段、枚举与依赖要求。",
      `${kindLabels("design", TargetIdSchema.options).join("、")}当前属于 design；entity 可通过 runtime.spawn 在指定原版群系生成，不需要创建新群系；独立的动画资产不进入构建，游戏里的动作来自模型自带的动作。`,
      "实体制作按 model → texture（可选）→ entity 装配，纹理必须匹配实际模型 UV；每个变体使用独立模型。",
      GESTURE_BOUNDARY,
      "提交没通过验收时保留 running 任务和草稿，按返回的说明修改后再次提交；这不是工具能力缺失。",
      `${LOOKED_KINDS.join("、")} 要看着做：没有部件说明、没有看过最终版本、自评没说做完或者没有通过独立验收，commit_task 一律拒绝；做不到通过也不用放弃，看过的、没有硬伤的最新一版会标明“${UNSATISFIED.mark}”交给用户验收。看图需要 Studio 开着；画不出图时如实报告，不要没看就交。`,
      "资产保存、构建成功和游戏内验收是不同阶段；只依据工具实际返回结果报告完成。",
      "蓝图由用户在 Studio 里确认，外部工具不能确认；未确认的蓝图不会开工，标为 out_of_scope 的条目不会制作。交了蓝图以后在这一轮里用 await_blueprint_decision 等他决定，确认了就马上 next_batch，不要让他回到这个窗口再说开始。",
    ],
  }
}
