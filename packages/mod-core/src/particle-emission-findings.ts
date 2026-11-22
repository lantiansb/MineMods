// Structured reasons from the emission rule, shared by the receipt and its presentation.
export const EMISSION_FINDINGS = {
  dark: { severity: "advice", label: "在暗处" },
  vanilla_options: { severity: "defect", label: "原版粒子不支持设置" },
  ignored_velocity: { severity: "defect", label: "初速度不会生效" },
  missing_velocity: { severity: "advice", label: "缺初速度" },
  area: { severity: "advice", label: "估面积" },
} as const
export type EmissionFinding = keyof typeof EMISSION_FINDINGS
