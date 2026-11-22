import { z } from "zod"
import type { ModelComplexity } from "@minemods/studio-ai/model-quality"
import {
  ProjectRunSchema,
  RoutePlanSchema,
  RouteTaskSchema,
  RunTaskSchema,
  validateRoutePlan,
} from "@minemods/mod-core/workspace-runs"

export { ModuleKindSchema } from "@minemods/mod-core/workspace-runs"
export { ProjectRunSchema, RoutePlanSchema, RouteTaskSchema, RunTaskSchema, validateRoutePlan }

export type RoutePlan = z.infer<typeof RoutePlanSchema>
export type RouteTask = z.infer<typeof RouteTaskSchema>
export type RunTask = z.infer<typeof RunTaskSchema>
export type ProjectRun = z.infer<typeof ProjectRunSchema>
export type { ModelComplexity }
