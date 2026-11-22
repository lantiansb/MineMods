import { For, Show } from "solid-js"
import { RELEASE_DEFAULTS, RELEASE_LICENSES, type ReleaseLicense } from "@minemods/mod-core/release"
import { GLYPH_WORDS, LICENSE_WORDS, authorPlaceholder, type GlyphChoice, type ReleaseFields } from "./release-words"
import { advanced } from "./advanced"

/**
 * The 发布信息 part of 「模组信息」: author, version, licence and (under 高级) links. It is only the fields, controlled by the page that owns them:
 * the page has one Save for everything the mod says about itself, so there is no second copy of this form anywhere (round 19: it used to sit
 * folded inside the build panel, where nobody looked for it, with the icon nowhere at all).
 */
export function ReleaseFieldset(props: { fields: ReleaseFields; nickname: string; disabled: boolean; onChange: (key: keyof ReleaseFields, value: string) => void }) {
  const text = (key: "author" | "version" | "homepage" | "sources" | "issues", label: string, placeholder: string, max: number) => (
    <label class="field" data-field={key}>
      {label}
      <input aria-label={label} maxlength={max} spellcheck={false} autocomplete="off" disabled={props.disabled} placeholder={placeholder} value={props.fields[key]} onInput={(event) => props.onChange(key, event.currentTarget.value)} />
    </label>
  )
  return (
    <>
      {text("author", "作者", `不填就写「${authorPlaceholder(props.nickname)}」`, 80)}
      {text("version", "版本", `不填就是 ${RELEASE_DEFAULTS.version}，写成 1.0.0 这样三段数字`, 40)}
      <fieldset class="release-licenses" data-field="license">
        <legend>许可证：别人能拿这个模组做什么</legend>
        <For each={Object.keys(RELEASE_LICENSES) as ReleaseLicense[]}>
          {(license) => (
            <label>
              <input type="radio" name="release-license" checked={(props.fields.license || RELEASE_DEFAULTS.license) === license} disabled={props.disabled} onChange={() => props.onChange("license", license)} />
              <span>
                {LICENSE_WORDS[license]}
                <Show when={!props.fields.license && license === RELEASE_DEFAULTS.license}>（不选就用这个）</Show>
                <Show when={advanced()}>
                  <small> {license}</small>
                </Show>
              </span>
            </label>
          )}
        </For>
      </fieldset>
      <fieldset class="release-licenses" data-field="glyphs">
        <legend>{GLYPH_WORDS.legend}</legend>
        <For each={["sans", "serif", "off"] as GlyphChoice[]}>
          {(choice) => (
            <label>
              <input type="radio" name="release-glyphs" checked={(props.fields.glyphs || "sans") === choice} disabled={props.disabled} onChange={() => props.onChange("glyphs", choice)} />
              <span>
                {GLYPH_WORDS[choice]}
                <Show when={!props.fields.glyphs && choice === "sans"}>（不选就用这个）</Show>
              </span>
            </label>
          )}
        </For>
        <small>{GLYPH_WORDS.help}</small>
      </fieldset>
      <Show when={advanced()}>
        {text("homepage", "主页地址", "https://", 300)}
        {text("sources", "源码地址", "https://", 300)}
        {text("issues", "反馈地址", "https://", 300)}
      </Show>
    </>
  )
}
