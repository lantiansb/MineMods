import { For, type JSX } from "solid-js"

const icons = {
  entity:
    "M8 13c-2 0-4 3-4 5s2 3 4 2l4-1 4 1c2 1 4 0 4-2s-2-5-4-5c-2-2-6-2-8 0ZM7 5a2 3 0 1 0 0 6 2 3 0 0 0 0-6Zm10 0a2 3 0 1 0 0 6 2 3 0 0 0 0-6Z",
  world: "M3 5c3-2 6-2 9 0 3-2 6-2 9 0v15c-3-2-6-2-9 0-3-2-6-2-9 0V5Zm9 0v15",
  biome: "m12 3-6 8h3l-5 6h6v4h4v-4h6l-5-6h3l-6-8Z",
  dimension: "M20 10a8 8 0 1 0-8 10M3 18C0 15 9 5 19 4c7 0 0 11-10 15-5 2-7 1-6-1Z",
  terrain: "m2 20 7-14 5 8 3-5 5 11H2Zm5-10 2 3 2-3",
  home: "M3 10l9-7 9 7v10H3V10Zm6 10v-7h6v7",
  cube: "m12 3 9 5v8l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v8",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  folder: "M3 7h7l2 2h9v11H3V7Zm0 0V4h7l2 3",
  play: "m8 4 12 8-12 8V4Z",
  check: "m5 12 4 4L19 6",
  copy: "M8 8h12v13H8V8Zm8-4V2H3v14h2",
  link: "m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 6v6l4 2",
  document: "M5 3h10l4 4v14H5V3Zm10 0v5h4M9 12h6M9 16h6",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  close: "m6 6 12 12M6 18 18 6",
  texture: "M3 3h18v18H3V3Zm0 12 5-5 5 5 3-3 5 5M15 7h1",
  logic: "M4 3h16v18H4V3Zm4 5h8M8 12h8M8 16h5",
  recipe: "M3 3h18v18H3V3Zm6 0v18M15 3v18M3 9h18M3 15h18",
  tool: "m4 20 9-9M14 3a6 6 0 0 0-3 8 6 6 0 0 0 8-3l-4 1-2-2 1-4Z",
  search: "M20 20l-5-5M17 10a7 7 0 1 0-14 0 7 7 0 0 0 14 0Z",
  share:
    "M7 12l10-6M7 12l10 6M6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  item: "M9 3h6M10 3v7l-5 8q-1 3 3 3h8q4 0 3-3l-5-8V3",
  undo: "M8 5 3 10l5 5M3 10h10a7 7 0 0 1 7 7",
  gesture: "M8 20v-5L4 9a2 2 0 0 1 3-2l3 3V4a2 2 0 0 1 4 0v4h4a2 2 0 0 1 2 2l-2 10H8Z",
  effect: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM19 3v4m-2-2h4",
  sound: "M3 9h4l5-4v14l-5-4H3V9Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  music: "M9 18V6l11-3v12M9 18c0 3-6 4-6 1s6-4 6-1Zm11-3c0 3-6 4-6 1s6-4 6-1Z",
  particle: "M5 5h2v2H5V5Zm11 2h3v3h-3V7ZM9 12h4v4H9v-4Zm8 6h2v2h-2v-2ZM4 18h1v1H4v-1Z",
  bossbar: "M3 10h18v5H3v-5Zm12 0v5M5 7l2-3 5 3 5-3 2 3",
  fixture: "M4 20h16M7 20v-4h10v4M12 16V9m-4 0h8l-1-5H9L8 9Z",
} as const
export function Icon(props: { name: keyof typeof icons; class?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={icons[props.name]} />
    </svg>
  )
}
/**
 * The four faces a person can pick in 个人设置. Each is our own drawing on an 8×8 grid (a riveted robot, a sprout, a snow cat,
 * a night owl): one letter a colour, a dot nothing. None is a player skin or a creature of the game's, or drawn from one.
 */
export const FACES = {
  copper: {
    name: "小铜",
    colors: { o: "#8a4a2b", l: "#d98d5f", g: "#3fbf6a", w: "#eafff0", d: "#4a2616", y: "#f2c14e" },
    rows: ["...yy...", "oooooooo", "ollllllo", "olgwlgwo", "olgglggo", "ollllllo", "olddddlo", "oooooooo"],
  },
  forest: {
    name: "小芽",
    colors: { d: "#2f7a36", e: "#58b04a", g: "#8fd16a", k: "#1d3a1c", p: "#f2a2a8" },
    rows: ["...de...", "..ddee..", ".gggggg.", "gggggggg", "gkggggkg", "gpggggpg", "gggkkggg", ".gggggg."],
  },
  snow: {
    name: "雪团",
    colors: { w: "#f3f6f8", s: "#c4ced6", b: "#3f7fc4", p: "#e58a9a", i: "#f7c9d0" },
    rows: ["w......w", "wi....iw", "wwwwwwww", "wwwwwwww", "wbwwwwbw", "wwwppwww", "swwwwwws", ".wwwwww."],
  },
  night: {
    name: "夜鸮",
    colors: { n: "#3a2f63", m: "#5b4a8a", y: "#f4d03f", k: "#16121f", o: "#e8842c" },
    rows: ["n......n", "nnnnnnnn", "nyynnyyn", "nyknnkyn", "nnnoonnn", "nmmoommn", "nmnmmnmn", ".nnnnnn."],
  },
} as const
export type FaceId = keyof typeof FACES
export function Avatar(props: { tone?: string }) {
  const face = () => FACES[(props.tone && props.tone in FACES ? props.tone : "copper") as FaceId]
  return (
    <svg class="avatar" viewBox="0 0 8 8" shape-rendering="crispEdges" role="img" aria-label={`头像：${face().name}`}>
      <For each={face().rows.flatMap((row, y) => [...row].map((letter, x) => ({ x, y, fill: (face().colors as Record<string, string>)[letter] })).filter((cell) => cell.fill))}>
        {(cell) => <rect x={cell.x} y={cell.y} width="1" height="1" fill={cell.fill} />}
      </For>
    </svg>
  )
}
export function Button(props: {
  children: JSX.Element
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
  class?: string
  type?: "button" | "submit"
}) {
  return (
    <button
      type={props.type ?? "button"}
      class={`studio-button ${props.primary ? "primary" : ""} ${props.class ?? ""}`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
