import { For, Show, on, createEffect, createMemo, createSignal } from "solid-js"
import type { Project } from "@minemods/mod-core/project"
import { CardShell } from "./project-assets"
import { ProjectArt } from "./project-art"
import { recentWorlds, worldLine, worldWaits } from "./home-worlds-model"
import { readOverview } from "./overview-cache"
import { Icon } from "../ui"
import "./home-worlds.css"

type Entry = { directory: string; project: Project }

/** 「接着做」 on the title screen: the game's 「选择世界」, one row per project, the newest first. A row opens its project, as a card of the full list does. */
export function HomeWorlds(props: { entries: readonly Entry[]; all: boolean; onOpen: (projectId: string) => void; onAll: () => void }) {
  const worlds = createMemo(() => recentWorlds(props.entries))
  const [waits, setWaits] = createSignal<Record<string, number>>({})
  // What waits in each is read from the project itself; a project that cannot be read now simply says nothing about it.
  createEffect(on(worlds, (entries) => {
    entries.forEach((world) => {
      void readOverview(world.project.id, world.project.revision, true).then(
        (overview) => setWaits((known) => ({ ...known, [world.project.id]: overview.production?.to_review ?? 0 })),
        () => undefined,
      )
    })
  }))
  return (
    <section class="mm-worlds" aria-label="接着做">
      <div class="mm-worlds-head">
        <h2>接着做</h2>
        <button type="button" class="mm-worlds-all" aria-expanded={props.all} onClick={props.onAll}>
          全部工程（{props.entries.length}）
        </button>
      </div>
      {/* The game's list goes by up and down: so does this one, and from the last row back to the first. */}
      <div
        class="mm-worlds-list"
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(".mm-world")]
          const at = rows.indexOf(document.activeElement as HTMLElement)
          event.preventDefault()
          rows[(at + (event.key === "ArrowDown" ? 1 : rows.length - 1 + (at < 0 ? 1 : 0))) % rows.length]?.focus()
        }}
      >
        <For each={worlds()}>
          {(world, index) => (
            <button type="button" class="mm-world project-card" classList={{ sel: index() === 0 }} title={world.project.name} onClick={() => props.onOpen(world.project.id)}>
              <span class="mc-slot mm-world-slot">
                <ProjectArt project={world.project} />
                <span class="mm-world-play" aria-hidden="true">
                  <svg viewBox="0 0 8 8" shape-rendering="crispEdges">
                    <path fill="#ffffff" d="M2 1h1v6h-1zM3 2h1v4h-1zM4 3h1v2h-1z" />
                  </svg>
                </span>
              </span>
              <span class="mm-world-words">
                <strong>{world.project.name}</strong>
                <small>{worldLine(world.project)}</small>
                <Show when={worldWaits(waits()[world.project.id])}>{(line) => <small class="mm-world-waits">{line()}</small>}</Show>
              </span>
            </button>
          )}
        </For>
      </div>
    </section>
  )
}

/** 「打开或导入工程」: the two ways in that used to be two buttons, each the same action it was. */
export function OpenOrImport(props: { onOpen: () => void; onImport: () => void; onClose: () => void }) {
  return (
    <CardShell title="打开或导入工程" manageFocus onClose={props.onClose}>
      <div class="mm-open-ways">
        <button type="button" class="title-way" onClick={props.onOpen}>
          <Icon name="folder" />
          <span>
            打开工程
            <small>选择本机上的工程目录</small>
          </span>
        </button>
        <button type="button" class="title-way" onClick={props.onImport}>
          <Icon name="download" />
          <span>
            导入工程
            <small>打开别人分享的 .minemods 文件</small>
          </span>
        </button>
      </div>
    </CardShell>
  )
}
