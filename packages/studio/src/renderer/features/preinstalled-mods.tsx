import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { ModSearch, ModsAdded, PreinstalledMod } from "../../api"
import { advanced } from "../advanced"
import { ask } from "../confirm-dialog"
import { Button, Icon } from "../ui"
import { SEARCH_MAX, SETUP_WORDS, addedLines, downloads, forget, modIcon, plainError, remember, searchQuery, type PendingMod } from "./project-setup-model"
import "./project-setup.css"

// How long typing has to pause before Modrinth is asked: about the gap between two words typed, so one search goes
// out per word instead of one per letter, and short enough that the list follows without a press.
const SEARCH_PAUSE_MS = 400

type Hit = ModSearch["hits"][number]

/**
 * 「预装模组」: mods that go into the test scene beside the person's own. With `projectId` they are the project's own
 * (listed, added from Modrinth or from the computer, taken out again); on the create page, before the project exists,
 * a press only remembers the mod in `pending` and the create flow adds it once the project is made.
 */
export function PreinstalledMods(props: {
  projectId?: string
  targetId: string
  pending?: readonly PendingMod[]
  onPending?: (list: PendingMod[]) => void
}) {
  const [mods, setMods] = createSignal<PreinstalledMod[]>([])
  const [typed, setTyped] = createSignal("")
  const [found, setFound] = createSignal<ModSearch | null>(null)
  const [searching, setSearching] = createSignal(false)
  const [searchProblem, setSearchProblem] = createSignal("")
  const [lines, setLines] = createSignal<string[]>([])
  const [working, setWorking] = createSignal(false)
  // Modrinth projects added from this card while it is open: a mod's own id in the list is not its Modrinth id.
  const [addedHere, setAddedHere] = createSignal<string[]>([])
  const ticket = { asked: 0 }
  const read = (projectId: string) =>
    window.studio.listPreinstalledMods({ projectId }).then(
      (value) => props.projectId === projectId && setMods(value.mods),
      (cause: unknown) => setLines([plainError(cause, SETUP_WORDS.actionFailed, advanced())]),
    )
  // By value, both: they are read off a view that is new at every save, and neither the list nor a search on the network starts over for that.
  const openProject = createMemo(() => props.projectId)
  const target = createMemo(() => props.targetId)
  createEffect(
    on(
      openProject,
      (projectId) => {
        setMods([])
        setLines([])
        setAddedHere([])
        if (projectId) void read(projectId)
      },
    ),
  )
  const search = (query: string, offset = 0) => {
    const asked = ++ticket.asked
    setSearchProblem("")
    if (!query) {
      setFound(null)
      return setSearching(false)
    }
    setSearching(true)
    void window.studio
      .searchMods({ query, targetId: props.targetId, offset })
      .then(
        (result) => {
          if (asked !== ticket.asked) return
          setFound(offset ? { hits: [...(found()?.hits ?? []), ...result.hits], total: result.total } : result)
        },
        (cause: unknown) => asked === ticket.asked && setSearchProblem(plainError(cause, SETUP_WORDS.searchFailed, advanced())),
      )
      .finally(() => asked === ticket.asked && setSearching(false))
  }
  // Another game version or loader is another set of files: the same words are asked again for it.
  createEffect(
    on(
      [() => searchQuery(typed()), target] as const,
      ([query]) => {
        const timer = window.setTimeout(() => search(query), SEARCH_PAUSE_MS)
        onCleanup(() => window.clearTimeout(timer))
      },
      { defer: true },
    ),
  )
  const answered = (result: ModsAdded, projectId: string) => {
    setLines(addedLines(result))
    return read(projectId)
  }
  const work = (operation: (projectId: string) => Promise<unknown>) => {
    const projectId = props.projectId
    if (!projectId || working()) return
    setWorking(true)
    setLines([])
    void operation(projectId)
      .catch((cause: unknown) => setLines([plainError(cause, SETUP_WORDS.actionFailed, advanced())]))
      .finally(() => setWorking(false))
  }
  const remembered = (hit: Hit) => (props.pending ?? []).some((value) => value.modrinthId === hit.projectId) || addedHere().includes(hit.projectId)
  const add = (hit: Hit) => {
    if (!props.projectId) return props.onPending?.(remember(props.pending ?? [], { modrinthId: hit.projectId, title: hit.title }))
    work(async (projectId) => {
      const result = await window.studio.addModrinthMod({ projectId, modrinthId: hit.projectId }).catch(
        (cause: unknown): ModsAdded => ({ added: [], skipped: [{ name: hit.title, why: plainError(cause, SETUP_WORDS.actionFailed, advanced()) }] }),
      )
      if (result.added.length) setAddedHere((values) => [...values, hit.projectId])
      await answered(result, projectId)
    })
  }
  const fromComputer = () =>
    work(async (projectId) => {
      const files = await window.studio.chooseModFiles()
      if (!files.length) return
      await answered(await window.studio.addModFiles({ projectId, tokens: files.map((file) => file.token) }), projectId)
    })
  const removeMod = async (mod: PreinstalledMod) => {
    if (!(await ask({ title: SETUP_WORDS.removeTitle(mod.name), text: SETUP_WORDS.removeText, confirm: SETUP_WORDS.remove, cancel: SETUP_WORDS.keep }))) return
    work(async (projectId) => setMods((await window.studio.removePreinstalledMod({ projectId, file: mod.file })).mods))
  }
  return (
    <section class="setup-card mods-card" aria-label={SETUP_WORDS.mods}>
      <header class="setup-card-head">
        <h3>{SETUP_WORDS.mods}</h3>
        <Show when={props.projectId}>
          <Button disabled={working()} onClick={fromComputer}>
            <Icon name="folder" />
            {SETUP_WORDS.fromComputer}
          </Button>
        </Show>
      </header>
      <p class="setup-note">{SETUP_WORDS.modsMeaning}</p>
      <p class="setup-note">{SETUP_WORDS.modsBuiltIn(props.targetId.slice(0, props.targetId.indexOf("-")))}</p>
      <Show
        when={props.projectId}
        fallback={
          <Show when={props.pending?.length}>
            <ul class="mod-chips" aria-label={SETUP_WORDS.mods}>
              <For each={props.pending}>
                {(mod) => (
                  <li class="mc-slot">
                    <span>{mod.title}</span>
                    <button type="button" aria-label={`${SETUP_WORDS.remove}「${mod.title}」`} onClick={() => props.onPending?.(forget(props.pending ?? [], mod.modrinthId))}>
                      <Icon name="close" />
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <p class="setup-note">{SETUP_WORDS.later}</p>
          </Show>
        }
      >
        <Show when={mods().length} fallback={<p class="setup-note">{SETUP_WORDS.modsNone}</p>}>
          <ul class="mod-list">
            <For each={mods()}>
              {(mod) => (
                <li>
                  <div class="mod-list-copy">
                    <strong>
                      {mod.name} <small>{mod.version}</small>
                    </strong>
                    <span>
                      {mod.from === "modrinth" ? SETUP_WORDS.fromModrinth : SETUP_WORDS.fromFile}
                      {mod.required ? ` · ${SETUP_WORDS.required}` : ""}
                      {advanced() ? ` · ${mod.file}` : ""}
                    </span>
                  </div>
                  <Button disabled={working()} onClick={() => void removeMod(mod)}>
                    {SETUP_WORDS.remove}
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <label class="search mod-search">
        <Icon name="search" />
        <input
          aria-label={SETUP_WORDS.searchLabel}
          placeholder={SETUP_WORDS.searchHint}
          maxlength={SEARCH_MAX}
          spellcheck={false}
          value={typed()}
          onInput={(event) => setTyped(event.currentTarget.value)}
          onKeyDown={(event) => {
            // On the create page the box sits in the create form: Enter searches now instead of making the project.
            if (event.key !== "Enter") return
            event.preventDefault()
            search(searchQuery(typed()))
          }}
        />
      </label>
      <Show when={searching() && !found()}>
        <p class="setup-note">{SETUP_WORDS.searching}</p>
      </Show>
      <Show when={searchProblem()}>
        <p class="java-problem">{searchProblem()}</p>
      </Show>
      <Show when={found() && searchQuery(typed())}>
        <Show when={found()!.hits.length} fallback={<p class="setup-note">{SETUP_WORDS.searchNothing}</p>}>
          <ul class="mod-results">
            <For each={found()!.hits}>
              {(hit) => (
                <li>
                  <ModIcon icon={hit.icon} />
                  <div class="mod-result-copy">
                    <strong title={hit.title}>{hit.title}</strong>
                    <span>
                      {hit.author} · {downloads(hit.downloads)}
                    </span>
                    <p title={hit.description}>{hit.description}</p>
                  </div>
                  <Button primary={!remembered(hit)} disabled={working() || remembered(hit)} onClick={() => add(hit)}>
                    {remembered(hit) ? SETUP_WORDS.added : SETUP_WORDS.add}
                  </Button>
                </li>
              )}
            </For>
          </ul>
          <Show when={found()!.hits.length < found()!.total}>
            <Button disabled={searching()} onClick={() => search(searchQuery(typed()), found()!.hits.length)}>
              {searching() ? SETUP_WORDS.searching : SETUP_WORDS.more}
            </Button>
          </Show>
        </Show>
      </Show>
      <Show when={working()}>
        <p class="setup-note">{SETUP_WORDS.working}</p>
      </Show>
      <Show when={lines().length}>
        <ul class="mod-lines" role="status">
          <For each={lines()}>{(line) => <li>{line}</li>}</For>
        </ul>
      </Show>
    </section>
  )
}

/** A mod's picture from Modrinth, or the empty slot when it has none or it does not load. */
function ModIcon(props: { icon: string | null }) {
  const [broken, setBroken] = createSignal(false)
  return (
    <Show when={!broken() && modIcon(props.icon)} fallback={<span class="mod-icon mc-slot" aria-hidden="true" />}>
      {(source) => <img class="mod-icon mc-slot" src={source()} alt="" loading="lazy" onError={() => setBroken(true)} />}
    </Show>
  )
}
