import { For, Index, Show, createEffect, createMemo, createSignal } from "solid-js"
import { BOOK_DEFAULT_COLOR, BOOK_FRAME_CLEAR, BOOK_INK, BOOK_LIMITS, BOOK_PAGE, BOOK_TEXT_BOXES, bookCoverLayout, bookInks, bookIssues, bookPageLayout, charCount, coverInk, marginCapacity, marginScale, textureTone, type BookDocument, type BookLanguage, type BookPage } from "@minemods/mod-core/book"
import type { Project } from "@minemods/mod-core/project"
import { Fold } from "../fold"
import "./book-pages.css"

type Texture = { id: string; title: string; width: number; height: number; palette: string[]; pixels: number[] }
const textures = (project: Project): Texture[] =>
  project.workspace.assets.flatMap((asset) => (asset.document.kind === "texture" ? [{ id: asset.id, title: asset.title, width: asset.document.width, height: asset.document.height, palette: asset.document.palette, pixels: asset.document.pixels }] : []))

/** A texture of the project drawn as the page draws it: stretched to its box (216×108 for a page's picture, the whole panel for a look's); `clear` is drawn see-through. */
function Picture(props: { texture: Texture | undefined; clear?: string; label?: string }) {
  let canvas!: HTMLCanvasElement
  createEffect(() => {
    const texture = props.texture
    if (!texture) return
    canvas.width = texture.width
    canvas.height = texture.height
    const context = canvas.getContext("2d")
    if (!context) return
    const image = context.createImageData(texture.width, texture.height)
    const clear = props.clear?.toLowerCase()
    texture.pixels.forEach((index, at) => {
      const color = texture.palette[index] ?? "#000000"
      image.data.set([parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), color.toLowerCase() === clear ? 0 : 255], at * 4)
    })
    context.putImageData(image, 0, 0)
  })
  return (
    <Show when={props.texture} fallback={<div class="bk-picture bk-missing">找不到这张图</div>}>
      <canvas class="bk-picture" ref={canvas} role="img" aria-label={`${props.label ?? "配图"}：${props.texture?.title ?? ""}`} />
    </Show>
  )
}

const shade = (color: string, by: number) => `#${[1, 3, 5].map((at) => Math.round(parseInt(color.slice(at, at + 2), 16) * by).toString(16).padStart(2, "0")).join("")}`
const unit = (value: number) => `calc(var(--bk-u) * ${value})`

/**
 * The book as the game draws it (`common/book.ts`, with the numbers of `BOOK_PAGE`): the cover, then one page at a time with its title, picture, text and
 * the note at its foot. Lines are broken by the game's own font widths, so what is on a line here is what is on it in the game; a line past what the
 * page holds is marked red. The arrows, or the arrow keys while the book has focus, turn the page.
 */
export function BookPreview(props: { document: BookDocument; project: Project; page?: number; onPage?: (page: number) => void }) {
  const [own, setOwn] = createSignal(0)
  const [language, setLanguage] = createSignal<BookLanguage>("zh")
  const count = () => props.document.pages.length
  const page = () => Math.max(0, Math.min(count(), props.page ?? own()))
  const go = (next: number) => {
    const value = Math.max(0, Math.min(count(), next))
    setOwn(value)
    props.onPage?.(value)
  }
  const color = () => props.document.cover_color ?? BOOK_DEFAULT_COLOR
  const pictures = createMemo(() => textures(props.project))
  const english = () => !!props.document.name_en || props.document.pages.some((value) => value.title_en || value.body_en || value.margin_en)
  const sheet = () => (page() ? props.document.pages[page() - 1] : undefined)
  const laid = createMemo(() => (sheet() ? bookPageLayout(sheet()!, language(), props.document.margin_small) : null))
  // The look (r29): its pictures as the game draws them, its inks, and what the check says of it (a picture gone, stretched, an ink hard to read).
  const look = () => props.document.look
  const texture = (id: string | undefined) => (id ? pictures().find((value) => value.id === id) : undefined)
  const coverArt = () => texture(look()?.cover)
  const paperId = () => (page() % 2 === 0 ? (look()?.paper_even ?? look()?.paper) : look()?.paper)
  const paper = () => texture(paperId())
  const inks = () => bookInks(look())
  const scale = () => marginScale(props.document)
  const ink = () => (coverArt() ? coverInk(textureTone(coverArt()!, BOOK_TEXT_BOXES.cover_title) ?? BOOK_INK.paper) : coverInk(color()))
  const lookProblems = createMemo(() => {
    if (!look()) return []
    const find = (id: string) => {
      const value = texture(id)
      return value ? { width: value.width, height: value.height, title: value.title, texture: value } : null
    }
    return bookIssues({ id: "", title: props.document.name, document: props.document }, find).filter((issue) => issue.field.startsWith("look.")).map((issue) => `${issue.text}${issue.fix}`)
  })
  const cover = createMemo(() => bookCoverLayout((language() === "en" ? props.document.name_en : undefined) ?? props.document.name))
  const problems = createMemo(() => {
    const value = laid()
    if (!page()) return [...(cover().over && !look()?.title_in_cover ? [`书名在封面上排成 ${cover().lines.length} 行，封面只放得下 ${BOOK_PAGE.cover.lines} 行。`] : []), ...lookProblems()]
    if (!value) return []
    return [
      ...(value.body.over ? [`正文排成 ${value.body.lines.length} 行，${sheet()!.image ? "有图的页" : "这一页"}只放得下 ${value.body.room} 行，多了 ${value.body.over} 行（标红的几行）。`] : []),
      ...(value.margin.over ? [`页边小字排成 ${value.margin.lines.length} 行，页脚只放得下 ${value.margin.room} 行。`] : []),
      ...(value.title.over ? [`标题比一行宽了 ${value.title.over} 个像素。`] : []),
      ...lookProblems(),
    ]
  })
  const bodyTop = () => BOOK_PAGE.body_top + (sheet()?.image ? BOOK_PAGE.image.height + BOOK_PAGE.image.gap : 0)
  return (
    <div class="bk-preview" aria-label="书翻开的样子">
      <div class="bk-bar">
        <button type="button" class="studio-button" disabled={page() === 0} onClick={() => go(page() - 1)} aria-label="上一页">‹ 上一页</button>
        <span role="status">{page() ? `第 ${page()} / ${count()} 页` : "封面"}</span>
        <button type="button" class="studio-button" disabled={page() === count()} onClick={() => go(page() + 1)} aria-label="下一页">下一页 ›</button>
        <Show when={english()}>
          <span class="bk-language" role="group" aria-label="按哪种游戏语言看">
            <button type="button" class="studio-button" aria-pressed={language() === "zh"} onClick={() => setLanguage("zh")}>中文</button>
            <button type="button" class="studio-button" aria-pressed={language() === "en"} onClick={() => setLanguage("en")}>英文</button>
          </span>
        </Show>
      </div>
      <div
        class="bk-panel"
        tabindex="0"
        aria-label="书页，按左右键翻页"
        style={{ "--bk-edge": shade(color(), 0.55), "--bk-cover": color(), "--bk-ink": ink(), "--bk-body": inks().body, "--bk-heading": inks().title, "--bk-faint": inks().margin, "--bk-scale": scale(), width: unit(BOOK_PAGE.panel.width), height: unit(BOOK_PAGE.panel.height) }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); go(page() + 1) }
          if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); go(page() - 1) }
        }}
      >
        <Show
          when={sheet()}
          fallback={
            <div class="bk-cover" classList={{ "bk-art": !!look()?.cover }}>
              <Show
                when={look()?.cover}
                fallback={
                  <>
                    <div class="bk-spine" />
                    <div class="bk-rule" style={{ top: unit(18) }} />
                    <div class="bk-rule" style={{ top: unit(BOOK_PAGE.panel.height - 19) }} />
                  </>
                }
              >
                <div class="bk-whole"><Picture texture={coverArt()} label="封面图" /></div>
              </Show>
              <Show when={!look()?.title_in_cover}>
                <div class="bk-cover-title" style={{ top: unit(BOOK_PAGE.cover.title_top) }}>
                  <Index each={cover().lines}>{(line, at) => <div classList={{ "bk-over": at >= BOOK_PAGE.cover.lines }}>{line()}</div>}</Index>
                </div>
                <Show when={props.document.author}><div class="bk-author" style={{ top: unit(BOOK_PAGE.cover.author_top) }}>{props.document.author}</div></Show>
              </Show>
            </div>
          }
        >
          {(value) => (
            <div class="bk-sheet" classList={{ "bk-art": !!paperId() }}>
              <Show when={paperId()}>
                <Show when={paper()} fallback={<div class="bk-whole bk-picture bk-missing">找不到这张底图</div>}>
                  <div class="bk-whole"><Picture texture={paper()} label="内页底图" /></div>
                </Show>
              </Show>
              <Show when={look()?.frame}>
                <div class="bk-whole"><Picture texture={texture(look()?.frame)} clear={look()?.clear_color ?? BOOK_FRAME_CLEAR} label="页边框" /></div>
              </Show>
              <Show when={laid()!.text.title}><div class="bk-line bk-title" style={{ top: unit(BOOK_PAGE.title_top) }} classList={{ "bk-over": laid()!.title.over > 0 }}>{laid()!.text.title}</div></Show>
              <Show when={value().image}>
                <div class="bk-image" style={{ top: unit(BOOK_PAGE.body_top), left: unit(BOOK_PAGE.text.left + (BOOK_PAGE.text.width - BOOK_PAGE.image.width) / 2), width: unit(BOOK_PAGE.image.width), height: unit(BOOK_PAGE.image.height) }}>
                  <Picture texture={pictures().find((texture) => texture.id === value().image)} />
                </div>
              </Show>
              <Index each={laid()!.body.lines}>
                {(line, at) => <div class="bk-line" style={{ top: unit(bodyTop() + at * BOOK_PAGE.line) }} classList={{ "bk-over": at >= laid()!.body.room }}>{line() || " "}</div>}
              </Index>
              <Index each={laid()!.margin.lines}>
                {(line, at) => <div class="bk-line bk-margin" style={{ top: unit(BOOK_PAGE.margin.top + at * BOOK_PAGE.line * scale()) }} classList={{ "bk-over": at >= laid()!.margin.room }}>{line()}</div>}
              </Index>
              <div class="bk-number" style={{ top: unit(props.document.margin_small ? BOOK_PAGE.number_top_small : BOOK_PAGE.number_top) }}>{`${page()} / ${count()}`}</div>
            </div>
          )}
        </Show>
      </div>
      <Show when={problems().length} fallback={<p class="bk-fit">{page() ? `这一页放得下。正文 ${laid()?.body.lines.length ?? 0} / ${laid()?.body.room ?? 0} 行。` : "封面放得下。"}</p>}>
        <ul class="bk-problems" role="alert"><For each={problems()}>{(line) => <li>{line}</li>}</For></ul>
      </Show>
    </div>
  )
}

type Pages = BookPage[]
const counter = (text: string | undefined, limit: number) => `${charCount(text ?? "")} / ${limit} 字`

/**
 * 书页: every page of a book written in the form, one card each, with the book drawn beside it as the game draws it (following the card being written).
 * A page can be added, removed and moved up or down; its picture is one of the project's textures.
 */
export function BookPages(props: { document: BookDocument; project: Project; disabled: boolean; edit: (key: string, value: unknown) => void }) {
  const [current, setCurrent] = createSignal(1)
  const pages = (): Pages => props.document.pages ?? []
  const set = (next: Pages) => props.edit("pages", next)
  const put = (index: number, field: keyof BookPage, value: string) => set(pages().map((page, at) => (at === index ? { ...page, [field]: field === "body" || value ? value : undefined } : page)))
  const move = (index: number, by: number) => {
    const next = [...pages()]
    const [taken] = next.splice(index, 1)
    next.splice(index + by, 0, taken!)
    set(next)
    setCurrent(index + by + 1)
  }
  const remove = (index: number) => {
    const left = pages().length - 1
    set(pages().filter((_, at) => at !== index))
    setCurrent(Math.max(1, Math.min(current(), left)))
  }
  const add = () => {
    const next = pages().length + 1
    set([...pages(), { title: `第 ${next} 页`, body: "" }])
    setCurrent(next)
  }
  const pictures = createMemo(() => textures(props.project))
  return (
    <section class="ae-section mc-window wide bk-pages" aria-label="书页">
      <h3>书页</h3>
      <p class="bk-help">{`一页一张卡片。正文没有图时最多 ${BOOK_LIMITS.body} 字，有图时最多 ${BOOK_LIMITS.body_image} 字；另外按游戏里的字宽排：一行 30 个汉字，没图 ${BOOK_PAGE.body_lines} 行，有图 6 行，换行和空行也占一行。排不下的在右边标红。`}</p>
      <div class="bk-columns">
        <div class="bk-cards">
          <Index each={pages()}>
            {(page, index) => {
              const laid = () => bookPageLayout(page(), "zh", props.document.margin_small)
              const limit = () => (page().image ? BOOK_LIMITS.body_image : BOOK_LIMITS.body)
              return (
                <fieldset class="bk-card" classList={{ current: current() === index + 1 }} disabled={props.disabled} onFocusIn={() => setCurrent(index + 1)}>
                  <legend>{`第 ${index + 1} 页`}</legend>
                  <div class="bk-card-actions">
                    <button type="button" class="studio-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`第 ${index + 1} 页上移`}>上移</button>
                    <button type="button" class="studio-button" disabled={index === pages().length - 1} onClick={() => move(index, 1)} aria-label={`第 ${index + 1} 页下移`}>下移</button>
                    <button type="button" class="studio-button" disabled={pages().length === 1} onClick={() => remove(index)} aria-label={`删掉第 ${index + 1} 页`}>删掉这一页</button>
                  </div>
                  <label class="field" data-field={`pages.${index}.title`}>
                    <span>页标题 <small>{counter(page().title, BOOK_LIMITS.title)}</small></span>
                    <input value={page().title ?? ""} onInput={(event) => put(index, "title", event.currentTarget.value)} />
                  </label>
                  <label class="field" data-field={`pages.${index}.image`}>
                    <span>配图（横幅，建议 432×216）</span>
                    <select value={page().image ?? ""} onChange={(event) => put(index, "image", event.currentTarget.value)}>
                      <option value="">不配图</option>
                      <For each={pictures()}>{(texture) => <option value={texture.id}>{`${texture.title}（${texture.width}×${texture.height}${texture.width === texture.height * 2 ? "" : "，不是 2:1，会被拉伸"}）`}</option>}</For>
                    </select>
                  </label>
                  <label class="field" data-field={`pages.${index}.body`} classList={{ bad: laid().body.over > 0 || charCount(page().body) > limit() }}>
                    <span>正文 <small>{`${counter(page().body, limit())} · ${laid().body.lines.length} / ${laid().body.room} 行`}</small></span>
                    <textarea rows={6} value={page().body} onInput={(event) => put(index, "body", event.currentTarget.value)} />
                    <Show when={laid().body.over > 0}><small class="bk-bad">{`多了 ${laid().body.over} 行：删掉一些字，或者挪到下一页。`}</small></Show>
                  </label>
                  <label class="field" data-field={`pages.${index}.margin`} classList={{ bad: laid().margin.over > 0 }}>
                    <span>页边小字 <small>{`${counter(page().margin, BOOK_LIMITS.margin)} · ${laid().margin.lines.length} / ${laid().margin.room} 行（一行 ${marginCapacity(props.document.margin_small).perLine} 个汉字）`}</small></span>
                    <input value={page().margin ?? ""} onInput={(event) => put(index, "margin", event.currentTarget.value)} />
                  </label>
                  <Fold class="bk-english" summary="英文（不写就显示中文）">
                    <label class="field"><span>英文页标题</span><input value={page().title_en ?? ""} onInput={(event) => put(index, "title_en", event.currentTarget.value)} /></label>
                    <label class="field"><span>英文正文</span><textarea rows={4} value={page().body_en ?? ""} onInput={(event) => put(index, "body_en", event.currentTarget.value)} /></label>
                    <label class="field"><span>英文页边小字</span><input value={page().margin_en ?? ""} onInput={(event) => put(index, "margin_en", event.currentTarget.value)} /></label>
                  </Fold>
                </fieldset>
              )
            }}
          </Index>
          <button type="button" class="studio-button" disabled={props.disabled || pages().length >= BOOK_LIMITS.pages} onClick={add}>{pages().length >= BOOK_LIMITS.pages ? `已经 ${BOOK_LIMITS.pages} 页了` : "加一页"}</button>
        </div>
        <div class="bk-side">
          <BookPreview document={props.document} project={props.project} page={current()} onPage={(page) => setCurrent(page)} />
        </div>
      </div>
    </section>
  )
}
