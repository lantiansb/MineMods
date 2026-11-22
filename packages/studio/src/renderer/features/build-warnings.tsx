import { createMemo, createResource, For, Show } from "solid-js"
import { z } from "zod"
import { BUILD_WARNING_LABELS, BuildWarningSchema, type BuildWarning, type BuildWarningSeverity } from "@minemods/mod-core/build-warnings"
import { EMISSION_FINDINGS } from "@minemods/mod-core/particle-emission-findings"
import { Fold } from "../fold"
import { groupBuildWarnings, type BuildWarningRow } from "./build-warning-groups"
import "./build-warnings.css"

const order = ["defect", "advice"] as const
const BuildWarningsOutput = z.object({ warnings: z.array(BuildWarningSchema).min(1) })

function summary(row: BuildWarningRow, severity: BuildWarningSeverity) {
  const first = row.warnings[0]!
  if (first.rule !== "particle_emission") return <>{first.text} · {row.warnings.length} 处{BUILD_WARNING_LABELS[severity]}</>
  const reasons = new Map<string, number>()
  for (const warning of row.warnings) {
    if (!warning.emission) continue
    const label = EMISSION_FINDINGS[warning.emission].label
    reasons.set(label, (reasons.get(label) ?? 0) + 1)
  }
  const detail = [...reasons].map(([label, count]) => count + " 处" + label).join("、")
  return <>「{row.move?.title}」的粒子 · {row.warnings.length} 处{BUILD_WARNING_LABELS[severity]}{detail ? "（" + detail + "）" : ""}</>
}

function WarningDetail(props: { warning: BuildWarning; advanced: boolean }) {
  return (
    <div class="pack-warning-detail">
      <p>{props.warning.text}</p>
      <Show when={props.warning.fix}><p>{props.warning.fix}</p></Show>
      <Show when={props.warning.refs?.length}>
        <ul class="pack-warning-refs">
          <For each={props.warning.refs}>{ref => <li title={String(ref.id)}>{ref.title}<Show when={props.advanced && String(ref.id) !== ref.title}> · {ref.id}</Show></li>}</For>
        </ul>
      </Show>
    </div>
  )
}

/** The saved receipt is available independently of the Java and game setup in the rest of the drawer. */
export function BuildWarningResult(props: { projectId: string; jobId: string | null; currentId: string | null; currentWarnings: BuildWarning[]; advanced: boolean }) {
  const projectId = createMemo(() => props.projectId)
  const jobId = createMemo(() => props.jobId)
  const [earlier] = createResource(
    () => {
      const job = jobId()
      return job && job !== props.currentId ? { projectId: projectId(), jobId: job } : false
    },
    async (input) => {
      const job = await window.studio.getJob(input).catch(() => null)
      if (job?.kind !== "build" || job.state !== "completed") return
      return BuildWarningsOutput.safeParse(job.output).data?.warnings
    },
  )
  const warnings = () => {
    if (!jobId()) return
    if (jobId() === props.currentId) return props.currentWarnings.length ? props.currentWarnings : undefined
    return earlier.loading ? undefined : earlier()
  }
  return (
    <Show when={warnings()} keyed>
      {(rows) => (
        <section class="build-step">
          <h3>打包提醒</h3>
          <BuildWarnings warnings={rows} advanced={props.advanced} />
        </section>
      )}
    </Show>
  )
}

export function BuildWarnings(props: { warnings: readonly BuildWarning[]; advanced: boolean }) {
  const groups = createMemo(() => groupBuildWarnings(props.warnings))
  return (
    <section class="pack-warnings" aria-label="打包提醒">
      <For each={order}>{(severity) => (
        <Show when={groups()[severity].count > 0}>
          <Fold class="pack-warning-level" state={severity} open={severity === "defect"} summary={<>{groups()[severity].count} 处{BUILD_WARNING_LABELS[severity]}</>}>
            <ul class="pack-warning-list">
              <For each={groups()[severity].rows}>{row => (
                <li class="pack-warning-row">
                  <Show when={row.warnings.length > 1} fallback={<WarningDetail warning={row.warnings[0]!} advanced={props.advanced} />}>
                    <Fold summary={summary(row, severity)}>
                      <ul class="pack-warning-list">
                        <For each={row.warnings}>{warning => <li><WarningDetail warning={warning} advanced={props.advanced} /></li>}</For>
                      </ul>
                    </Fold>
                  </Show>
                </li>
              )}</For>
            </ul>
          </Fold>
        </Show>
      )}</For>
    </section>
  )
}
