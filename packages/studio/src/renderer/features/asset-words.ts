import { thingName } from "../words"
import {soundUsers} from "@minemods/mod-core/sound-moments"
import type { Project } from "@minemods/mod-core/project"
import { isItemOnlyModel } from "@minemods/mod-core/item-model-quality"
import { motionName } from "@minemods/studio-ai/making"
import { blockPaint } from "@minemods/studio-ai/block-shape"
import { GestureDocumentSchema, resolveGesture } from "@minemods/mod-core/gesture"
import { GESTURE_TICK } from "@minemods/mod-core/gesture-rig"
import { SOUND_MOMENTS, dataWords, hasCjk, type SoundMoment } from "@minemods/mod-core/data-words"
import { blockShapeWords, contentWords, referenceWords } from "@minemods/mod-core/content-words"
import { ENGAGEMENT_WORDS, creatureWords, projectStructureWords, usedAbilities, usedCombos } from "@minemods/mod-core/creature-life"
import { gameplayBySlug, gameplayHolds } from "@minemods/mod-core/gameplay-references"
import { creatureName } from "@minemods/mod-core/registry-name"
import { abilityIssues, abilityPlan, abilityPlays, abilityTimingIssues, abilityWords, bindingDetails, bindingLines, comboPlan, comboWords, creatureBindings, motionWords, type PlaysClip } from "@minemods/mod-core/creature-abilities"
import { gameplayPlays } from "@minemods/mod-core/gameplay-motions"
import { EFFECT_FACINGS, EFFECT_FLAW_LINE, effectLines, effectMeasure } from "@minemods/mod-core/effect"
import { emitterWhen, particleLabel } from "@minemods/mod-core/particle-emission"
import { particleLines, type ParticleDocument } from "@minemods/mod-core/particle"
import { abilityEffectIds, abilityEffectIssues, creatureTall, effectEventWords, effectEvents, effectLookup } from "@minemods/mod-core/effect-abilities"
import { hitboxFit, hitboxLines, hitboxPlain } from "@minemods/mod-core/creature-hitbox"
import { bossOwn, bossWords } from "@minemods/mod-core/creature-boss"
import { diveIssues, flightWords, habitsWords } from "@minemods/mod-core/creature-flight"
import { SOUND_CATEGORIES, creatureSoundIssues, isSoundAsset, soundFileFacts, soundLookup, soundMeasurementsWords, soundUseLines, soundUses } from "@minemods/mod-core/sound"
import { ABILITY_SOUNDS } from "@minemods/mod-core/ability-words"

type Document = Project["workspace"]["assets"][number]["document"]
type Tile = { id: string; asset_id: string | null; kind: string; preview: { source: "asset" | "content" | null } }
export type Words = {
  /** One plain sentence saying what it does, for things that are a rule rather than a look. */
  sentence: string | null
  /** `detail` is for 高级 only: the names and numbers as the document and the generated code spell them. */
  rows: { label: string; text: string; detail?: string; colours?: ReturnType<typeof particleColours> }[]
  /** Things the game needs that are still missing, said as a fact, not as an error. */
  notes: string[]
}

function particleColours(color: ParticleDocument["color"]): { value: string; at?: number }[] {
  if (color.start === color.end && !color.mid?.length) return [{ value: color.start }]
  return [{ value: color.start }, ...(color.mid ?? []), { value: color.end }]
}

const effects: Record<string, string> = { slowness: "变慢", blindness: "看不清", poison: "中毒", weakness: "变虚弱" }
const tools = { pickaxe: "用镐挖最快", axe: "用斧头砍最快", shovel: "用锹铲最快", none: "空手就能挖" }
const moves = {
  direct: "直直地走过来",
  stalk: "悄悄跟在后面，慢慢靠近",
  burst: "走走停停，突然冲一段",
  strafe: "绕着你转圈",
  leap: "靠近以后扑过来",
  retreat: "碰一下就往后退",
}
const moods = { passive: "不会主动攻击，被打了也只会跑", follow: "会跟着玩家走，不打人", hostile: "看见玩家就会主动攻击" }

const hearts = (points: number) => `${Number((points / 2).toFixed(1))} 颗心`
const seconds = (ticks: number) => `${Number((ticks / 20).toFixed(1))} 秒`
const percent = (chance: number) => `${Math.round(chance * 100)}%`
const hardness = (value: number) =>
  value <= 0 ? "一碰就碎" : value < 1 ? "很软，像泥土" : value <= 2.5 ? "和石头差不多" : value <= 10 ? "很硬，像矿石" : value >= 50 ? "几乎挖不动" : "非常硬"
const glow = (value: number) => (value <= 0 ? "不发光" : value < 8 ? "微微发光" : value < 15 ? "很亮，能照亮周围" : "和萤石一样亮")
const pace = (value: number) => (value <= 0 ? "站着不动" : value < 0.2 ? "走得很慢" : value < 0.3 ? "和玩家走路差不多" : value < 0.45 ? "比玩家快一点" : "跑得很快")

/**
 * The abilities of the creatures that wear a model (by the model's asset id), so its motions can be named with the ability that plays each (broad19: 「slam」 and 「冲锋」
 * sat in two lists and the person could not tell which motion an ability used). A creature is read from its document or from the project's own list; only a hostile one uses abilities.
 */
export function wornAbilities(project: Pick<Project, "entities" | "workspace">, modelAssetId: string | null | undefined) {
  if (!modelAssetId) return []
  const documents = project.workspace.assets.flatMap((asset) => (asset.document.kind === "entity" && asset.document.model_asset_id === modelAssetId ? [asset.document] : []))
  const listed = project.entities.filter((entity) => entity.model_asset_id === modelAssetId)
  return [...documents, ...listed].flatMap((entity) => usedAbilities(entity))
}

/**
 * Everything whose name can stand for a motion of a model: the abilities of the creatures that wear it, and the gameplays whose code plays one of its motions (written out by name).
 * The pages name a motion by the first of these when it has no word of its own (`motionWords`).
 */
export function motionPlayers(project: Pick<Project, "entities" | "workspace">, modelAssetId: string | null | undefined): PlaysClip[] {
  if (!modelAssetId) return []
  // A creature is pointed at by its model's asset id or by its own id; a gameplay whose code is about either plays the motions of this model.
  const creatures = [...new Set([modelAssetId, ...project.entities.filter((entity) => entity.model_asset_id === modelAssetId).map((entity) => entity.id)])]
  return [...wornAbilities(project, modelAssetId), ...creatures.flatMap((id) => gameplayPlays(project, id))]
}

/** The titles animations saved on their own for a model carry, by motion name, where the title is in the person's language: the name those motions are listed by. */
export function savedMotionTitles(project: Pick<Project, "workspace">, modelAssetId: string | null | undefined) {
  const model = project.workspace.assets.find(asset => asset.id === modelAssetId)?.document
  const embedded = model?.kind === "model" ? model.animations.flatMap(clip => clip.display_name ? [[clip.name, clip.display_name] as const] : []) : []
  return new Map([...project.workspace.assets.flatMap((asset) => (modelAssetId && asset.document.kind === "animation" && asset.dependencies.includes(modelAssetId) && hasCjk(asset.title) ? [[asset.document.name, asset.title] as const] : [])), ...embedded])
}

/** One model's motions as the pages name them: `(clip, advanced) => name`. The same rule for the buttons, the lists and the headings (`motionWords`). */
export function motionNamer(project: Pick<Project, "entities" | "workspace">, modelAssetId: string | null | undefined) {
  const plays = motionPlayers(project, modelAssetId)
  const titles = savedMotionTitles(project, modelAssetId)
  return (clip: string, advanced = false) => motionWords(clip, plays, { title: titles.get(clip), advanced })
}

/**
 * What one saved thing is, in words a player uses. Numbers stay in, but always next to what they mean.
 * `name` turns "namespace:name" into the name the player knows it by.
 */
export function describeAsset(project: Project, item: Tile, name: (reference: string) => string, advanced = false): Words {
  // The overview says where the record is; nothing is guessed from the shape of the id.
  const legacy = item.preview.source === "content" ? item.id.slice(item.id.indexOf(":") + 1) : undefined
  const document: Document | undefined = item.preview.source === "asset" ? project.workspace.assets.find((value) => value.id === item.asset_id)?.document : undefined
  const none: Words = { sentence: null, rows: [], notes: [] }
  // A material as the card says it: a thing by its name in 「」, a tag as 「任意木板」.
  const plainly = (reference: string) => (reference.startsWith("#") ? referenceWords(reference, project.mod_id, () => null) : `「${name(reference)}」`)

  const entity = document?.kind === "entity" ? document : item.kind === "entity" ? project.entities.find((value) => value.id === legacy) : undefined
  if (entity) {
    const title = (id: string) => thingName(project.workspace.assets.find(asset => asset.id === id)) ?? null
    const motionNameForEntity = motionNamer(project, entity.model_asset_id)
    const motion = (clip: string) => motionNameForEntity(clip).replace(/^招式：(.+)$/, "「$1」的动作")
    const runtime = entity.runtime
    const drop = runtime?.death_drop
    // G2: its abilities in plain words, and which motion of its model is started by what (the binding list).
    const abilities = usedAbilities(entity)
    // Where its lair is, when a boss has one; a creature read from the project shares its id with its model.
    const lairWords = creatureWords.lair(project, entity, "id" in entity ? entity.id : entity.model_asset_id)
    // A creature's document names its model asset; a creature read from the project shares its id with it.
    const modelled = project.workspace.assets.find((asset) => asset.document.kind === "model" && (asset.id === entity.model_asset_id || ("id" in entity && asset.id === entity.id)))?.document
    const bones = modelled?.kind === "model" ? boneTitles(modelled.bones, undefined, false) : new Map<string, string>()
    const clips = modelled?.kind === "model" ? modelled.animations : null
    // H3: the effects its abilities show, by the name each has in this project.
    const shown = effectLookup(project)
    // 任务二 §9: the sounds of its own it plays, by the name each has in this project.
    const findSound = soundLookup(project)
    const heard = (id: string) => {
      const asset = findSound(id)
      return asset && { ...asset, title: thingName(asset) }
    }
    const particleNames = { aliases: entity.particles, title: (id: string) => project.workspace.assets.find(a => a.id === id && a.document.kind === "particle")?.title ?? null }
    const voiced = { name: entity.name, sounds: entity.sounds, abilities }
    const own = soundUses(voiced).some((use) => isSoundAsset(use.sound))
    // K1: how its collision boxes hold its model as it stands (its motions are measured when it is looked at, not for a card).
    const boxed = modelled?.kind === "model" ? hitboxFit(entity.hitbox, { bones: modelled.bones, animations: [] }, entity.flight) : null
    const solidParts = [...(entity.hitbox?.core.solid ? ["身体中心"] : []), ...(entity.hitbox?.parts ?? []).filter((part) => part.solid).map((part) => `「${part.name}」`)].join("、")
    // Gameplay code that is about this creature, read from the project: where its generic temper and target can be taken over, the card says by which gameplay.
    const heldBy = "id" in entity ? entity.id : entity.model_asset_id
    const held = creatureWords.held(heldBy ? gameplayHolds(project, creatureName({ id: heldBy, identifier: entity.identifier })) : [])
    const bindings = clips ? creatureBindings({ abilities, boss: entity.behavior === "hostile" ? entity.boss : null, flight: entity.flight, habits: entity.habits }, clips, project.logic.filter((rule) => rule.entity_id === entity.model_asset_id || ("id" in entity && rule.entity_id === entity.id)), (id) => shown(id)?.title ?? null) : null
    return {
      sentence: null,
      rows: [
        { label: "生命", text: `${entity.health} 点（${hearts(entity.health)}）` },
        // r29b: the name the game knows it by (/summon, its spawn egg), shown once it names itself; in 高级 always.
        ...(heldBy && (entity.identifier || advanced) ? [{ label: "注册名", text: `${project.mod_id}:${creatureName({ id: heldBy, identifier: entity.identifier })}${entity.identifier ? "" : "（自动起的）"}` }] : []),
        { label: "脾气", text: entity.behavior === "hostile" && held.target ? `${moods.hostile}（默认；${held.target}，见下面「受玩法影响」）` : moods[entity.behavior] },
        { label: "打人", text: abilities.length ? `用招式打（下面 ${abilities.length} 个），不再一碰就掉血` : entity.attack_damage > 0 ? `打一下掉 ${entity.attack_damage} 点血（${hearts(entity.attack_damage)}）` : "不会打人" },
        ...(entity.particles && Object.keys(entity.particles).length ? [{ label: "粒子别名", text: Object.keys(entity.particles).map(alias => particleLabel({ alias }, particleNames)).join("、") }] : []),
        ...(entity.emitters ?? []).map(e => ({
          label: "持续发射",
          text: `${emitterWhen(e.when)}从${e.bone ? `「${e.bone}」` : "脚下"}每 ${e.every_ticks} 刻冒 ${e.count} 颗${particleLabel(e.particle, particleNames)}`,
        })),
        ...abilities.map((ability) => ({
          label: `招式「${ability.name}」`,
          text: [abilityPlays(ability, clips, motion), abilityWords.summary(ability, "\n", (slug) => gameplayBySlug(project, slug)?.title ?? null, motion, entity.stagger, { ...particleNames, displayNames: true, bone: id => bones.get(id) ?? "指定部件" }), abilityWords.events(ability, particleNames), ...effectEvents(ability).map((found) => effectEventWords(found.event, shown(found.event.effect)?.title ?? null))].filter(Boolean).join("\n"),
          detail: ((plan) => `id ${ability.id} · clip ${ability.clip} · wind-up to tick ${plan.windup} · hits at tick ${plan.hits.map((hit) => hit.tick).join(", ")} · ends at tick ${plan.length} · cooldown ${plan.cooldown} ticks · weight ${ability.start.weight}${ability.hits.flatMap((hit) => (hit.type === "gameplay" ? [` · gameplay ${hit.gameplay}.${hit.action} at tick ${plan.hits[ability.hits.indexOf(hit)]!.tick}`] : [])).join("")}${effectEvents(ability).map((found) => ` · effect ${found.event.effect} at tick ${plan.events.find((event) => event.index === found.index)!.tick} (${found.event.where})`).join("")}`)(abilityPlan(ability)),
        })),
        // Combos (连招): its abilities played one after another, on the combo's own clock.
        ...usedCombos(entity).map((combo) => ({
          label: `连招「${combo.name}」`,
          text: [comboWords.summary(combo, abilities, "\n", true, entity.stagger), comboWords.timeline(combo, abilities)].join("\n"),
          detail: ((plan) => `id ${combo.id} · steps ${plan.steps.map((step) => `${step.ability.id}@${step.start}`).join(", ")} · ends at tick ${plan.end} · cooldown ${plan.cooldown} ticks · gap ${plan.gap} · damage ×${plan.damage} · weight ${combo.start.weight}`)(comboPlan(combo, abilities)),
        })),
        { label: "怎么动", text: `${pace(entity.speed)}${runtime && entity.behavior !== "passive" ? `，${moves[runtime.movement]}` : ""}` },
        ...(runtime?.armor ? [{ label: "护甲", text: `${runtime.armor} 点（铁甲一整套是 15 点）` }] : []),
        {
          label: "哪里出现",
          text:
            [
              ...(runtime?.spawn
                ? [`${creatureWords.places(runtime.spawn)}，一次出现 ${runtime.spawn.min === runtime.spawn.max ? runtime.spawn.min : `${runtime.spawn.min}–${runtime.spawn.max}`} 只${runtime.spawn.light === "bright" ? "，只在亮处" : runtime.spawn.light === "dark" ? "，只在暗处" : ""}${runtime.spawn.above_sea ? `，只在比海平面高 ${runtime.spawn.above_sea} 格以上的地方` : ""}${runtime.spawn.cap ? `，${runtime.spawn.cap.radius} 格内最多 ${runtime.spawn.cap.count} 只` : ""}${runtime.spawn.time || runtime.spawn.weather ? `，${creatureWords.moments(runtime.spawn).join("；")}` : ""}${runtime.spawn.near ? `，只在${runtime.spawn.near.structures.map(projectStructureWords(project)).join("或")}${runtime.spawn.near.distance ? `周围 ${runtime.spawn.near.distance} 格以内` : "的范围里"}` : ""}`]
                : []),
              // A boss's lair is another way it is met in the world (the same sentence the guide and the standard use).
              ...(lairWords ? [lairWords] : []),
              // r29: put in a boss's lair as the lair is made.
              ...((guarded) => (guarded ? [guarded.words] : []))(creatureWords.garrison(project, runtime?.garrison)),
            ].join("\n") || "不会自己出现，要用刷怪蛋或指令放出来",
        },
        ...(runtime?.explosion
          ? [
              {
                label: "会爆炸",
                text: `靠近后 ${seconds(runtime.explosion.fuse_ticks)}炸开，波及 ${runtime.explosion.radius} 格，${runtime.explosion.damage_blocks ? "会炸坏方块" : "不会炸坏方块"}${runtime.explosion.effects.length ? `，被炸到会${runtime.explosion.effects.map((effect) => effects[effect.effect]).join("、")}` : ""}`,
              },
            ]
          : []),
        // E1: a creature that is told to stay put says so, with the reason its document gives.
        ...(entity.stationary ? [{ label: "闲着时", text: `故意不走动：${entity.stationary.reason}` }] : []),
        // H1: how a hostile creature comes to fight, when its document says it.
        ...(entity.behavior === "hostile" && entity.engagement ? [{ label: "打谁", text: `${ENGAGEMENT_WORDS[entity.engagement]}${held.target ? `；但${held.target}` : ""}` }] : []),
        // Gameplay code that is about it: which gameplay, and which hand it has on it. What it does is in that gameplay's own words.
        ...(held.lines.length ? [{ label: "受玩法影响", text: [held.lead, ...held.lines].join("\n"), detail: held.detail.join("\n") }] : []),
        // What lures a follower, when its document names it (without, it is wheat); said in the words its guide and facets use.
        ...(entity.behavior === "follow" && entity.tempt?.length ? [{ label: "拿什么引它", text: creatureWords.lure(entity.tempt, project) }] : []),
        // Boss runtime (10-12): a hostile creature that is the main character of a fight, in the words the spec uses.
        ...(entity.behavior === "hostile" && entity.boss ? [{ label: "Boss", text: bossWords.summary(entity.boss, abilities, "\n", { ...bossOwn(entity), ...particleNames, displayNames: true, title, motion, block: name, bone: id => bones.get(id) ?? "指定部件" }, entity.flight) }] : []),
        // Flight and habits (10-12): what the creature does in the air and how it lives, in the words a player can check in the game.
        ...(entity.flight ? [{ label: "飞行", text: flightWords.summary(entity.flight) }] : []),
        ...(entity.habits ? [{ label: "习性", text: habitsWords.summary(entity.habits, "\n") }] : []),
        { label: "掉什么", text: [...(entity.loot?.length ? [creatureWords.loot(entity.loot, project)] : []), ...(drop ? [`被玩家打败时有 ${percent(drop.chance)} 的机会掉「${name(drop.block_identifier)}」`] : [])].join("；") || "这里没有设置掉落" },
        ...(entity.experience ? [{ label: "经验", text: `打败它给 ${entity.experience} 点经验` }] : []),
        // Borrowed vanilla sounds, one fact per moment that was chosen: 「受伤时是「铁傀儡受伤」的声音」.
        ...(entity.sounds
          ? [
              {
                label: "声音",
                text: [...(Object.keys(SOUND_MOMENTS) as SoundMoment[]).flatMap((moment) => (entity.sounds![moment] ? [dataWords.creatureSound(moment, entity.sounds![moment]!, (id) => heard(id)?.title ?? null)] : [])), dataWords.voice(entity.sounds)].filter(Boolean).join("；") || "和所有生物通用的一样",
              },
            ]
          : []),
        // 任务二 §9: with sounds of its own, every moment and ability event that makes a sound, and which sound it is.
        ...(own ? [{ label: "哪一刻放哪个声音", text: soundUseLines(voiced, heard, ABILITY_SOUNDS).join("\n") }] : []),
        ...(bindings ? [{ label: "动作去向", text: bindingLines(bindings, false, motion).join("\n"), detail: bindingDetails(bindings).join("\n") }] : []),
        // K1: its collision boxes, when its document states them: the one for its body and each further one by name; the measured numbers behind 高级.
        ...(entity.hitbox
          ? [{ label: "碰撞箱", text: `身体的箱子宽 ${entity.hitbox.core.width} 格、高 ${entity.hitbox.core.height} 格${entity.hitbox.parts?.length ? `；另外给${entity.hitbox.parts.map((part) => `「${part.name}」`).join("")}各加了一个箱子，打中它们就是打中它（${entity.hitbox.parts.some((part) => part.bone) ? "写了骨骼的箱子在它站着、走路和出招时跟着那根骨骼动，其余只跟着身体的朝向转" : "箱子只跟着身体的朝向转"}）` : "，没有另外分部位"}${entity.hitbox.blockers?.length ? `。${entity.hitbox.blockers.map(box => `「${box.name}」`).join("、")}只挡路，可以站上去` : ""}${solidParts ? `。${solidParts}实心，能挡路，也能站上去` : ""}`, ...(boxed ? { detail: hitboxLines(boxed).slice(1).join("\n") } : {}) }]
          : []),
      ],
      // What is wrong with its abilities against its model, said as a fact.
      notes: [...abilityIssues(entity, clips, modelled?.kind === "model" ? modelled : null), ...(modelled?.kind === "model" ? abilityTimingIssues(entity, modelled) : []), ...diveIssues({ name: entity.name, behavior: entity.behavior, flight: entity.flight, abilities }), ...abilityEffectIssues({ name: entity.name, abilities }, shown, modelled?.kind === "model" ? creatureTall(modelled) : null, modelled?.kind === "model" ? modelled : null), ...creatureSoundIssues(voiced, heard)].map((issue) => `${issue.text}${issue.fix}`).concat(boxed ? hitboxPlain(boxed) : []),
    }
  }

  const block = document?.kind === "block" ? document : item.kind === "block" ? project.blocks.find((value) => value.id === legacy) : undefined
  if (block) {
    const lucky = block.lucky
    return {
      sentence: null,
      rows: [
        // A block of boxes is not a whole block; say so, so the words match the picture beside them.
        ...(block.shape ? [{ label: "外形", text: blockShapeWords(block.shape) }] : []),
        { label: "硬度", text: `${hardness(block.hardness)}（${block.hardness}）` },
        { label: "发光", text: block.luminance > 0 ? `${glow(block.luminance)}（亮度 ${block.luminance}，最亮 15）` : glow(0) },
        { label: "怎么挖", text: block.tool_tier && block.tool !== "none" ? dataWords.tier(block.tool_tier, block.tool) : tools[block.tool] },
        { label: "挖掉以后", text: block.drop === "item" && block.drop_item ? dataWords.drop(block.drop_item, name) : block.drop === "self" ? "掉它自己" : "什么都不掉" },
        ...(block.experience ? [{ label: "经验", text: dataWords.experience(block.experience) }] : []),
        ...(block.generation ? [{ label: "哪里能挖到", text: dataWords.generation(block.generation) }] : []),
        ...(block.sound ? [{ label: "声音", text: dataWords.blockSound(block.sound) }] : []),
        ...(contentWords.standing(block) ? [{ label: "站上去", text: contentWords.standing(block) }] : []),
        ...(lucky
          ? [
              {
                label: "右键打开",
                text: [
                  `随机出一种结果，一共 ${lucky.outcomes.length} 种：`,
                  ...lucky.outcomes.map((outcome) => {
                    const gifts = outcome.items.map((gift) => `${name(gift.item)} ${gift.min === gift.max ? gift.min : `${gift.min}–${gift.max}`} 个`)
                    const harm = outcome.effects.map((effect) => `${effects[effect.effect] ?? effect.effect} ${seconds(effect.duration_ticks)}`)
                    return `${outcome.weight}% 的机会：${[...gifts, ...harm].join("、")}`
                  }),
                ].join("\n"),
              },
            ]
          : []),
      ],
      // Only a block that nothing paints is one plain colour: a block with a shape is painted by the shape's sheet, whatever its `texture` holds.
      notes: [...(blockPaint(block) === "colour" ? ["还没有画图案，游戏里每一面都是这一种颜色。"] : []), ...(block.generation && block.drop === "none" ? ["它会在世界里生成，可是挖掉以后什么都不掉。"] : [])],
    }
  }

  const thing = document?.kind === "item" ? document : item.kind === "item" ? project.items.find((value) => value.id === legacy) : undefined
  if (thing)
    return {
      sentence: null,
      rows: [
        { label: "一格能叠", text: thing.max_stack === 1 ? "不能叠，一格一个" : `${thing.max_stack} 个` },
        ...(thing.model_asset_id ? [{ label: "外观", text: `使用模型「${project.workspace.assets.find(asset => asset.id === thing.model_asset_id)?.title ?? "关联模型"}」和它的纹理` }] : []),
        // What it is besides an ordinary item, in the words the mod guide uses.
        ...(thing.tool ? [{ label: "工具", text: contentWords.tool(thing.tool, plainly) }] : []),
        ...(thing.food ? [{ label: "食物", text: contentWords.food(thing.food) }] : []),
        ...(thing.fuel ? [{ label: "燃料", text: contentWords.fuel(thing.fuel) }] : []),
      ],
      notes: thing.texture || thing.model_asset_id ? [] : ["还没有画图案，游戏里是一块纯色。"],
    }

  const recipe = document?.kind === "recipe" ? document : item.kind === "recipe" ? project.recipes.find((value) => value.id === legacy) : undefined
  if (recipe) {
    const counts = recipe.pattern.filter((value): value is string => value !== null).reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())
    const parts = [...counts].map(([reference, count]) => `${count} 个「${name(reference)}」`)
    // Only a shaped recipe is laid out on the crafting grid; a furnace, a stonecutter or a shapeless one is said by its own kind.
    if (recipe.type && recipe.type !== "shaped") return { sentence: `${contentWords.recipe(recipe, plainly)}。`, rows: [], notes: [] }
    return {
      // "A、B 和 C", the way a list is said aloud.
      sentence: `在工作台上，用 ${parts.length > 1 ? `${parts.slice(0, -1).join("、")}和 ${parts.at(-1)}` : parts[0]}，做出 ${recipe.count} 个「${name(recipe.result)}」。`,
      rows: [],
      notes: [],
    }
  }

  const rule = document?.kind === "logic" ? document : item.kind === "logic" ? project.logic.find((value) => value.id === legacy) : undefined
  if (rule) {
    const creature =
      project.workspace.assets.find((value) => value.document.kind === "entity" && value.document.model_asset_id === rule.entity_id)?.title ??
      project.entities.find((value) => value.id === rule.entity_id)?.name ??
      "它"
    const when = rule.trigger === "hurt" ? `${creature}被打` : rule.trigger === "player_near" ? `玩家走近${creature}` : `玩家拿着「${name(rule.item ?? "")}」走近${creature}`
    const then = rule.action === "look" ? "转头看着玩家" : rule.action === "follow" ? "跟着玩家走" : rule.animation ? `做「${animationName(rule.animation)}」的动作` : "做一个动作"
    return {
      sentence: `当${when}的时候，它会${then}。`,
      rows: [],
      notes: rule.enabled ? [] : ["这条规则现在是关着的，游戏里不会生效。"],
    }
  }

  if (document?.kind === "gesture") return castWords(document)
  // Gameplay: the card's own block says what it does; here only what kind of thing is saved.
  if (document?.kind === "gameplay")
    return {
      sentence: null,
      rows: [
        { label: "会做的事", text: `${document.behaviours.length} 条，见上面` },
        { label: "代码", text: `AI 写的 ${document.sources.length} 个 Java 文件${document.data.length ? `，${document.data.length} 个数据文件` : ""}，共 ${document.sources.reduce((sum, file) => sum + file.content.split("\n").length, 0)} 行` },
      ],
      notes: ["能编译不等于玩法是对的：对不对要你自己进游戏试。"],
    }
  // Boss 能力 11: a particle in a player's words: each of its parameters, and which abilities show it.
  if (document?.kind === "particle") {
    const [pictures, life, fall, size, colour, glow] = particleLines(document)
    const opacity = colour!.slice(colour!.indexOf("；") + 1)
    return {
      sentence: null,
      rows: [
        { label: "图", text: pictures!.replace(/^图：/, ""), detail: `frames ${document.frames.length} · frames_by ${document.frames_by}` },
        { label: "寿命", text: life!.replace(/^寿命：/, ""), detail: `lifetime ${document.lifetime}` },
        { label: "下落", text: fall!.replace(/^下落：/, ""), detail: `gravity ${document.gravity}` },
        { label: "大小", text: size!.replace(/^大小：/, ""), detail: `size ${document.size.start} → ${document.size.end}` },
        { label: "颜色", text: opacity, colours: particleColours(document.color), detail: `color ${document.color.start} → ${document.color.end} · opacity ${document.opacity.start} → ${document.opacity.end}` },
        { label: "发光和旋转", text: glow!, detail: `emissive ${document.emissive} · spin ${document.spin}` },
      ],
      notes: [],
    }
  }
  // H3: an effect in a player's words: how long it is there, how it stays, and which abilities show it.
  if (document?.kind === "effect") {
    const play = document.play
    const found = effectMeasure(document)
    const users = project.workspace.assets.flatMap((asset) => (asset.document.kind === "entity" ? usedAbilities(asset.document).filter((ability) => abilityEffectIds([ability]).includes(item.asset_id ?? "")).map((ability) => `「${thingName(asset)}」的招式「${ability.name}」`) : []))
    const coded = project.workspace.assets.filter((asset) => asset.document.kind === "gameplay" && asset.document.uses.includes(item.asset_id ?? "")).map((asset) => `玩法「${thingName(asset)}」`)
    return {
      sentence: null,
      rows: [
        { label: "搭了多少块", text: `${document.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)} 块小方块`, detail: `bones ${document.bones.length} · clips ${document.animations.map((value) => value.name).join(", ")}` },
        { label: "存在多久", text: `${Number(play.lifetime.toFixed(2))} 秒，一出现就从头播它自己的动作${found && found.motion.unseen ? "（可是看不出它在变）" : ""}`, detail: `play.clip ${play.clip} · ${found?.ticks ?? "?"} ticks` },
        { label: "怎么待着", text: `${play.follow ? "跟着放出它的那一方走" : "留在出现的地方"}，${EFFECT_FACINGS[play.facing]}${play.on_ground ? "，贴在地面上" : ""}；${play.ends_with_owner ? "那一招被打断或者放出它的那一方死了，它立刻消失" : "到时间才消失"}` },
        ...(play.bright || play.opacity < 1 ? [{ label: "画法", text: [...(play.bright ? ["不受明暗影响，一直最亮"] : []), ...(play.opacity < 1 ? ["整个半透明"] : [])].join("；"), detail: `bright ${play.bright} · opacity ${play.opacity}` }] : []),
        { label: "谁在用它", text: [...users, ...coded].join("、") || "还没有招式或玩法用它，游戏里不会出现" },
      ],
      notes: effectLines(document).filter((line) => EFFECT_FLAW_LINE.test(line)),
    }
  }
  // 任务二 §9: a sound in a player's words: what each file measures, what the game shows and who plays it.
  if (document?.kind === "sound") {
    const facts = document.files.map((file) => {
      try {
        return soundFileFacts(file.data)
      } catch {
        return null
      }
    })
    const places = new Map<string,string[]>()
    for(const user of soundUsers(project,item.asset_id??item.id)){
      const title = thingName(project.workspace.assets.find(a => user.entity ? a.document.kind === "entity" && a.document.model_asset_id === user.entity : a.id === user.owner)) ?? user.title
      const entries=places.get(title)??[]
      entries.push(user.where)
      places.set(title,entries)
    }
    const users=[...places].map(([title,where])=>"「"+title+"」"+where.join("、"))
    return {
      sentence: null,
      rows: [
        ...(advanced ? [{ label: "注册名", text: `${project.mod_id}:${document.name}` }] : []),
        ...document.files.map((file, index) => ({
          label: document.files.length > 1 ? `第 ${index + 1} 个文件` : "文件",
          text: ((found) => (found ? `${Number(found.seconds.toFixed(2))} 秒${advanced ? `，${found.channels === 1 ? "单声道" : `${found.channels} 个声道`}，${found.sample_rate} Hz，${Math.ceil(found.bytes / 1024)} KB` : ""}` : "读不出来"))(facts[index]),
          ...(document.files.length > 1 ? { detail: `weight ${file.weight ?? 1}` } : {}),
        })),
        ...document.files.flatMap((file, index) => file.measurements ? [{ label: `第 ${index + 1} 个文件的合成测量`, text: soundMeasurementsWords(file.measurements) }] : []),
        ...(document.files.length > 1 ? [{ label: "怎么放", text: `每次从 ${document.files.length} 个文件里随机挑一个` }] : []),
        { label: "字幕", text: document.subtitle ? `${document.subtitle.zh} / ${document.subtitle.en}` : "不显示字幕" },
        { label: "音量", text: `${document.volume}，音调 ${document.pitch}；${document.category ? `招式放它时归「${SOUND_CATEGORIES[document.category].name}」这条音量` : "跟着放它的生物归哪条音量"}` },
        { label: "谁在用它", text: users.join("；") || "还没有生物或招式用它，游戏里听不到" },
      ],
      notes: [],
    }
  }
  if (document?.kind === "model") {
    const named = motionNamer(project, item.asset_id)
    return {
      sentence: null,
      rows: [
        { label: "头会怎么看", text: document.look ? `会单独转头，由 ${document.look.bones.length} 根骨骼分担` : "头跟着身体一起转", detail: document.look?.bones.map(part => part.bone).join("、") },
        { label: "待机摆动", text: document.sway?.length ? `${document.sway.length} 串骨骼会自己动` : "没有单独设置摆动" },
        { label: "会调整动作强弱", text: document.animations.filter(clip => Object.values(clip.weights ?? {}).some(keys => keys?.length)).map(clip => named(clip.name)).join("、") || "没有单独调整的动作" },
        { label: "搭了多少块", text: `${document.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)} 块小方块，分成 ${document.bones.length} 个部件` },
        item.asset_id && isItemOnlyModel(project, item.asset_id)
          ? { label: "用途", text: "静态物品外观，可在关联物品中调整持握" }
          : { label: "会的动作", text: document.animations.length ? `${document.animations.map((value) => named(value.name)).join("、")}，点左边的按钮可以看` : "还不会动", detail: document.animations.length ? `clips ${document.animations.map((value) => value.name).join(", ")}` : undefined },
      ],
      notes: [],
    }
  }
  if (document?.kind === "texture")
    return {
      sentence: null,
      rows: [{ label: "大小", text: `${document.width} × ${document.height} 格，用了 ${new Set(document.pixels).size} 种颜色` }],
      notes: [],
    }
  if (document?.kind === "animation")
    return {
      sentence: null,
      rows: [{ label: "动作", text: `${seconds(document.length * 20)}一遍，${document.loop ? "一直重复" : "只做一次"}；动到 ${document.channels.length} 个部分` }],
      notes: [],
    }
  if (document?.kind === "worldview") return { sentence: document.summary || null, rows: document.entries.slice(0, 6).map((entry) => ({ label: entry.title, text: entry.body })), notes: [] }
  if (document?.kind === "biome" || document?.kind === "dimension" || document?.kind === "terrain") return { ...none, sentence: document.description || null }
  return none
}

type Cast = Extract<Document, { kind: "gesture" }>
// The base motions are described for the right hand.
const hands = { right: "右手出手", left: "换成左手出手（上面说的左右要反过来看）", both: "两只手一起" }
const time = (ticks: number) => `${Number((ticks * GESTURE_TICK).toFixed(2))} 秒`

/**
 * A cast action in plain words: which motion it is and what it is for, how long each stretch takes, how it
 * is played, what the player sees of it themselves, and what cast actions cannot do today, said as facts.
 */
export function castWords(cast: Cast): Words {
  // Asked first, so a document that cannot be played gives fewer rows instead of an error.
  const made = GestureDocumentSchema.safeParse(cast).success ? resolveGesture(cast) : null
  const ticks = made?.timeline.ticks
  const tuned = [
    ...(made && made.speed !== 1 ? [made.speed > 1 ? "比原来的动作快一些" : "比原来的动作慢一些"] : []),
    ...(made && made.strength !== 1 ? [made.strength > 1 ? "身体带得更猛" : "身体带得更收"] : []),
  ]
  return {
    sentence: made?.base?.description ?? null,
    rows: [
      { label: "动作", text: made?.base ? `「${made.base.name}」，${hands[made.hand ?? "right"]}${tuned.length ? `；${tuned.join("，")}` : ""}` : "AI 专门为它写的一套动作，没有用现成的基础动作" },
      ...(ticks
        ? [{ label: "多长", text: `一共 ${time(ticks.windup + ticks.hold + ticks.release + ticks.recover)}：起手 ${time(ticks.windup)}${ticks.hold ? `，蓄力 ${time(ticks.hold)}` : ""}，出手 ${time(ticks.release)}，再用 ${time(ticks.recover)}收回` }]
        : []),
      { label: "怎么播放", text: `按 ${cast.trigger.key.toUpperCase()} 键播放，按一次做一遍` },
      { label: "瞄准", text: cast.aim ? "手臂会跟着准星抬高或压低，看哪里就朝哪里施法" : "手臂不跟准星，总是朝正前方" },
      { label: "左撇子", text: cast.mirror_for_left_handed ? "把主手设成左手的玩家，会自动换成另一边来做" : "左撇子玩家也用同一边来做" },
      {
        label: "自己看到",
        text: cast.first_person.arms ? `自己的两条手臂做同一套动作，${cast.first_person.items ? "手里拿的东西也在" : "手里拿的东西会先藏起来"}` : "第一人称下不显示手臂，自己看不到这个动作，只有别人看得到",
      },
    ],
    notes: [
      "现在只能按键播放，还不能由技能触发。",
      "只动头、身体、手臂和腿，手指、手肘和膝盖弯不了；不带粒子、声音或伤害。",
      "这里的画面是按游戏的镜头算出来的，还没有在游戏里对照过。",
    ],
  }
}

/** The name a player would give an animation; the saved name is kept when there is no better one. The same words the making loop writes on its pictures. */
export const animationName = motionName

/** When a rule fires, in a couple of words, for the small tile that has no room for the whole sentence. */
export function ruleCaption(project: Project, item: Tile) {
  const legacy = item.preview.source === "content" ? item.id.slice(item.id.indexOf(":") + 1) : undefined
  const document = item.preview.source === "asset" ? project.workspace.assets.find((value) => value.id === item.asset_id)?.document : undefined
  const rule = document?.kind === "logic" ? document : project.logic.find((value) => value.id === legacy)
  if (!rule) return null
  return rule.trigger === "hurt" ? "被打时" : rule.trigger === "player_near" ? "走近时" : "拿着东西走近时"
}

const remarks: Record<string, string[]> = {
  entity: ["太容易打败了", "太难打了", "走得太快", "掉的东西太少"],
  model: ["头太大了", "身体太瘦", "想要更可爱一点", "手脚再长一点", "细节再多一点"],
  texture: ["颜色再暗一点", "颜色再亮一点", "眼睛不明显", "花纹太乱了"],
  animation: ["动得太快了", "动得太僵硬", "幅度再大一点"],
  block: ["颜色再暗一点", "花纹再明显一点", "想让它发光", "太容易挖掉了"],
  item: ["颜色再亮一点", "看不出是什么", "轮廓再清楚一点"],
  recipe: ["材料太贵了", "太容易做出来了", "一次多做几个"],
  logic: ["反应太慢了", "不想让它这样做", "换一个动作"],
  gesture: ["动作再快一点", "动作再慢一点", "蓄力再久一点", "出手再猛一点", "换成另一只手", "换一个动作"],
  gameplay: ["进游戏试了，没有触发", "和说明写的不一样", "数值太强了", "数值太弱了", "还想让它多做一件事"],
  effect: ["出现得太突然", "消失得太突然", "再大一点", "再小一点", "留得再久一点", "颜色再亮一点"],
}

/** Ready-made remarks a person can tap instead of typing, by the kind of thing they are looking at. */
export function remarkIdeas(kind: string) {
  return remarks[kind] ?? ["和我想的不一样", "再简单一点", "再丰富一点"]
}

/**
 * Round 18: with 高级 off the pages still showed names an AI wrote as identifiers (`pick`, `root`, `appear`,
 * `leg_front_left`). A name written in plain letters, digits and joiners only is one of those: the documents use
 * it, a person has no use for it. A name in the person's own language is a name and stays.
 */
export const isIdentifier = (name: string) => /^[\x21-\x7e]+$/.test(name.trim())
export const PART_UNNAMED = "一个部分"

/** A motion as a page names it, with no creature at hand: the player's word where there is one (待机, 走路…), else the name the document gives it; under 高级 the document's name is kept beside the word. */
export const motionTitle = (name: string, advanced: boolean) => motionWords(name, null, { advanced })

type Part = { name: string; what: string }
/** A part sheet row's title: `what` says what the part is; `name` is "the name the documents will use" and is the title only when it is a plain-language name, or under 高级. */
export const partTitle = (part: Part, advanced: boolean) => (advanced || !isIdentifier(part.name) ? part.name || part.what || PART_UNNAMED : part.what || PART_UNNAMED)
/** Whether the row has anything to say under its title: when `what` became the title, it is not said twice. */
export const partDetail = (part: Part, advanced: boolean) => (partTitle(part, advanced) === part.what ? "" : part.what)

/**
 * The bones of a model by what a person would call them: the part sheet's description of the part with that
 * name, else its place in the list. Under 高级 every bone keeps the name its document gives it.
 */
export function boneTitles(bones: readonly { name: string }[], parts: readonly Part[] | undefined, advanced: boolean) {
  const described = new Map((parts ?? []).map((part) => [part.name, part.what]))
  return new Map(bones.map((bone, index) => [bone.name, advanced || !isIdentifier(bone.name) ? bone.name : described.get(bone.name) || `第 ${index + 1} 个部件`]))
}

/**
 * A sentence an AI or a measurement wrote, with the identifiers it quotes put in plain words: a part quoted as
 * 「name」 becomes what the sheet says it is, and a motion named at the start of the line becomes the player's
 * word for it. Anything it does not recognise is left as written; under 高级 nothing is changed.
 */
export function plainNames(line: string, parts: readonly Part[] | undefined, advanced: boolean) {
  if (advanced) return line
  const named = (parts ?? []).filter((part) => isIdentifier(part.name) && part.what)
  const quoted = named.reduce((text, part) => text.split(`「${part.name}」`).join(`「${part.what}」`), line)
  return quoted.replace(/^([A-Za-z][A-Za-z0-9_.-]*)(?=：)/, (name) => motionTitle(name, false))
}

type Redone = { title: string; facts: { saved: boolean }; reason: string | null; review?: { note: string } | null }
/** What a thing is sent back with when the person adds nothing: what they last said of it, else the first line of why it stands as it does. At most what the API takes of a remark. */
export const retryWords = (item: Redone, limit = 500) => (item.review?.note || (item.reason ?? "").split("\n")[0] || "").slice(0, limit)
/**
 * When a remark that sends something back is carried out, said the way it really goes. Whatever was sent back is handed out before anything
 * new, but only when the next batch is started (`startBatch`): a batch that is still being made is a fixed set of tasks, some of which may be
 * made on the version about to be redone, so rework is not slipped into it. While a batch is live the redo therefore starts after it, and the
 * words say that instead of promising 「先」 (broad18: the page said the AI would redo first, and it only could once the batch had ended).
 */
export type RedoWho = { external: boolean; aiConfigured: boolean; running: boolean }
const RECORD_ONLY = "现在没连上 AI，只会先把你的话记下来。连上以后再让它重做。"
/** Before the remark is sent: what will happen. `what` is the thing to do, e.g. 「按你说的重做这一样」. */
export function redoPromise(who: RedoWho, what: string) {
  if (who.external)
    return who.running
      ? `会先记下来。你的 AI 手上这一批还没做完，要等它做完；下一次领任务时它会先${what}，别的新东西排在后面。`
      : `会先记下来。回到你的 AI 窗口说一句「继续」，它会先${what}，别的不动。`
  if (!who.aiConfigured) return RECORD_ONLY
  return who.running ? `AI 做完手上这几样，就${what}，别的不动。` : `AI 会${what}，别的不动。做好以后再请你看。`
}
/** After it was sent, on the thing itself: where it stands. */
export function redoStanding(who: RedoWho, saved: boolean) {
  const what = saved ? "重做这个" : "把这个再做一次"
  if (who.external)
    return who.running
      ? `已记下。你的 AI 手上这一批还没做完，等它做完，下一次领任务时就会先${what}。`
      : `已记下，回到你的 AI 窗口说一句「继续」，它会先${what}。`
  if (!who.aiConfigured) return "已经记下了。现在没连上 AI，连上以后就能让它重做。"
  return who.running ? "已经排上了。AI 做完手上这几样，就来重做它，别的不动。" : "已经记下了，还没有开始重做。"
}
/** After a walk through everything waiting for a verdict that sent some things back. */
export function redoAfterWalk(who: RedoWho) {
  if (who.external)
    return who.running
      ? "要改的已经记下了。你的 AI 手上这一批还没做完，等它做完，下一次领任务时就会先重做这些，别的新东西排在后面。"
      : "要改的已经记下了。回到你的 AI 窗口说一句「继续」，它会先重做这些，别的不动。"
  if (!who.aiConfigured) return "要改的已经记下了。连上 AI 以后，就能让它重做。"
  return who.running
    ? "要改的已经排上了。AI 做完手上这几样，就来重做这些，别的不动。重做好以后，会再出现在「等你验收」里。"
    : "要改的已经交给 AI 重做，别的不动。重做好以后，会再出现在「等你验收」里。"
}
/** The sentence a person pastes to their own AI to have one thing made again. */
export function redoSentence(projectName: string, item: Redone) {
  const words = retryWords(item)
  return item.facts.saved
    ? `MineMods 工程「${projectName}」里的「${item.title}」我在 Studio 里看过了，要改${words ? `：${words}` : ""}。请继续：先把它重做好，再接着做别的。`
    : `MineMods 工程「${projectName}」里的「${item.title}」上次没做成，请继续：先把它再做一次${words ? `（${words}）` : ""}，再接着做别的。`
}
