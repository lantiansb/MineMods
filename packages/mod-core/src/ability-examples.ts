/** The three authoring examples also seed the playable verification project. */
export function abilityExamples(spike = "ab221100-0000-4000-8000-000000000004") {
  const common = { cast: { type: "instant", seconds: 0, cooldown: 4 }, reach: 8 }
  const ring = { type: "area", at: 0.6, shape: { type: "arc", inner: 2, reach: 5, angle: 360, low: -1, high: 2 }, hits: "everyone", damage: 6, knockback: 0, effects: [] }
  const smash = { type: "break", at: 0.6, where: "self", hit: null, forward: 0, up: 0, left: 0, radius: 2, height: 2, hardness: 1, drops: false }
  return [
    { kind: "ability", name: "环形震地", english_name: "Ring Quake", ...common, length: 1.2, hits: [ring],
      particles: { sparks: "flame" },
      moves: [{ type: "leap", at: 0.1, land: 0.6, height: 1.5, aim: "target", max_distance: 2 }],
      events: [{ ...smash, up: -1, height: 3 }, { type: "shockwave", at: 0.6, where: "self", hit: null, forward: 0, left: 0, from_radius: 2, to_radius: 5, seconds: 0.5, width: 1, height: 1.2, color: "#B8DAF0", glow: true, damage: 0, knockback: 0, hits: "everyone", effects: [] },
        { type: "particle", at: 0.6, particle: { alias: "sparks" }, where: "self", bone: "weapon", count: 45, forward: 0, up: 0.4, left: 0, spread: 0.6 },
        { type: "sound", at: 0.6, sound: "entity.iron_golem.attack", sound_alias: "impact", volume: 1, pitch: 1 }], bindings: [] },
    { kind: "ability", name: "冰刺法杖", english_name: "Frost Spire", ...common, hits: [ring], moves: [],
      events: [{ type: "effect", at: 0.6, effect: spike, where: "self", hit: null, forward: 3, up: 0, left: 0 }],
      bindings: [{ type: "item", item: "frost_wand", use: "click" }] },
    { kind: "ability", name: "地刺陷阱", english_name: "Spike Trap", ...common,
      hits: [{ ...ring, at: 0, shape: { type: "sphere", radius: 2, forward: 0, up: 0.5, left: 0 }, damage: 0 }], moves: [],
      events: [smash, { type: "hazard", at: 0, where: "self", hit: null, forward: 0, left: 0, radius: 2, seconds: 2, color: "#EA8224", glow: true, damage: 3, hits: "everyone", effects: [], every_ticks: 20, particle: "flame", count: 5 }],
      bindings: [{ type: "block", block: "spike_trap", trigger: "step", who: "living" }] },
  ]
}
