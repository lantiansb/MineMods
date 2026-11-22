import { z } from "zod"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { budgetFaults } from "@minemods/studio-ai/budget"

const Bone = ModelDesignSchema.shape.bones.element
const Animation = ModelDesignSchema.shape.animations.element
const Command = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("model.begin"), arguments: z.strictObject({ name: z.string().min(1).max(80), texture_size: ModelDesignSchema.shape.texture_size, texel_size: ModelDesignSchema.shape.texel_size, budget: ModelDesignSchema.shape.budget }) }),
  z.strictObject({ name: z.literal("model.upsert_bone"), arguments: Bone }),
  z.strictObject({ name: z.literal("model.upsert_animation"), arguments: Animation }),
  z.strictObject({ name: z.literal("model.finish"), arguments: ModelDesignSchema }),
])
const Request = z.strictObject({ jsonrpc: z.literal("2.0"), id: z.number().int().nonnegative(), method: z.literal("tools/call"), params: Command })

export type ModelProgress = {
  sequence: number
  draft: ModelDesign
  events: { sequence: number; tool: string; label: string }[]
  complete: boolean
}

/** Portable, DOM-free model tools. Draft operations never write project assets. */
export function createModelCoreSession(previous: ModelDesign | null) {
  const state: ModelProgress = { sequence: 0, draft: previous ? structuredClone(previous) : { name: "正在制作", texture_size: 128, bones: [], animations: [] }, events: [], complete: false }
  const tools = ["model.begin", "model.upsert_bone", "model.upsert_animation", "model.finish"] as const
  return {
    listTools: () => [...tools],
    read: (): ModelProgress => structuredClone(state),
    call(input: unknown) {
      const request = Request.parse(input)
      if (request.id !== state.sequence) throw new Error("Model tool sequence conflict")
      if (state.complete) throw new Error("Model tool session is complete")
      const command = request.params
      if (command.name === "model.begin") {
        state.draft = previous ? structuredClone(previous) : { ...command.arguments, bones: [], animations: [] }
        state.complete = false
      }
      if (state.complete) throw new Error("Model tool session is complete")
      if (command.name === "model.upsert_bone") {
        const bones = [...state.draft.bones.filter(bone => bone.name !== command.arguments.name), command.arguments]
        // Engineer H2: held to the draft's own geometry tier (the default when it names none: 64 bones, 256 cubes, as before), and said with the numbers.
        const over = budgetFaults({ ...state.draft, bones }).find((fault) => fault.limit === "bones" || fault.limit === "cubes" || fault.limit === "bone_cubes")
        if (over) throw new Error(over.words)
        bones.forEach(bone => {
          const visited = new Set([bone.name])
          let parent = bone.parent
          while (parent) {
            if (visited.has(parent)) throw new Error("Model draft contains a parent cycle")
            visited.add(parent)
            parent = bones.find(candidate => candidate.name === parent)?.parent ?? null
          }
        })
        state.draft = { ...state.draft, bones }
      }
      if (command.name === "model.upsert_animation") {
        const animations = [...state.draft.animations.filter(animation => animation.name !== command.arguments.name), command.arguments]
        const over = budgetFaults({ ...state.draft, animations }).find((fault) => fault.limit === "animations" || fault.limit === "keys" || fault.limit === "total_keys")
        if (over) throw new Error(over.words)
        state.draft = { ...state.draft, animations }
      }
      if (command.name === "model.finish") { state.draft = command.arguments; state.complete = true }
      state.sequence += 1
      const label = command.name === "model.upsert_bone" ? `搭建 ${command.arguments.name} · ${command.arguments.cubes.length} 个体块` : command.name === "model.upsert_animation" ? `制作动作 ${command.arguments.name}` : command.name === "model.finish" ? "模型、贴图和动作校验完成" : "开始制作"
      state.events = [...state.events.slice(-127), { sequence: state.sequence, tool: command.name, label }]
      return { jsonrpc: "2.0" as const, id: request.id, result: { sequence: state.sequence, content: [{ type: "text", text: label }] } }
    },
  }
}
