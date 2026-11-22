import { Fold } from "../fold"
import { For, Show, createResource, createSignal } from "solid-js"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { Project } from "@minemods/mod-core/project"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { creatureParticleSheets } from "../../main/particle-looks"
import type { LookJob, LookPictures, LookScene } from "../../main/look-job"

type Creature = Extract<ModuleDocument, { kind: "entity" }>
type PictureWindow = Window & { renderLook: (job: LookJob) => Promise<LookPictures> }

export function EmitterPictures(props: {
  owner: Creature
  project: Project
  design: ModelDesign
  preview: LookScene["preview"]
}) {
  const [open, setOpen] = createSignal(false)
  const [windowForPictures, setWindow] = createSignal<PictureWindow>()
  const [pictures] = createResource(
    () =>
      open() &&
      windowForPictures() && {
        renderer: windowForPictures()!,
        owner: props.owner,
        project: props.project,
        design: props.design,
        preview: props.preview,
      },
    async ({ renderer, owner, project, design, preview }) => {
      const lookup = (id: string) => {
        const asset = project.workspace.assets.find((a) => a.id === id)
        return asset?.document.kind === "particle" ? { title: asset.title, document: asset.document } : null
      }
      const result = creatureParticleSheets(owner, design, lookup, 4, undefined, true)
      const rendered = await renderer.renderLook({ scenes: [{ design, preview }], sheets: result.sheets })
      if (!rendered.ok) throw Error(rendered.reason)
      return rendered.pictures
    },
  )
  return (
    <Fold summary={"常驻发射的图（" + props.owner.emitters?.length + " 处）"} onToggle={setOpen}>
      <Show when={open()}>
        <iframe
          title="绘制常驻发射"
          tabindex="-1"
          aria-hidden="true"
          style={{ position: "absolute", width: "1px", height: "1px", opacity: 0, "pointer-events": "none" }}
          src="./look.html"
          onLoad={(e) => setWindow(e.currentTarget.contentWindow as PictureWindow)}
        />
        <Show when={pictures.loading}>
          <p>正在画常驻发射…</p>
        </Show>
        <Show when={pictures.error}>
          <p>常驻发射的图暂时无法显示。</p>
        </Show>
        <For each={pictures()}>
          {(picture) => <img alt={picture.label} src={picture.url} style={{ width: "100%", height: "auto" }} />}
        </For>
      </Show>
    </Fold>
  )
}
