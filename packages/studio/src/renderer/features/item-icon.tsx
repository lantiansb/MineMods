import { Show } from "solid-js"

const vanilla: Record<string, { texture: string; block?: boolean }> = {
  "minecraft:copper_ingot": { texture: new URL("../assets/minecraft/1.21.1/item/copper_ingot.png", import.meta.url).href },
  "minecraft:redstone": { texture: new URL("../assets/minecraft/1.21.1/item/redstone.png", import.meta.url).href },
  "minecraft:iron_ingot": { texture: new URL("../assets/minecraft/1.21.1/item/iron_ingot.png", import.meta.url).href },
  "minecraft:gold_ingot": { texture: new URL("../assets/minecraft/1.21.1/item/gold_ingot.png", import.meta.url).href },
  "minecraft:diamond": { texture: new URL("../assets/minecraft/1.21.1/item/diamond.png", import.meta.url).href },
  "minecraft:stick": { texture: new URL("../assets/minecraft/1.21.1/item/stick.png", import.meta.url).href },
  "minecraft:coal": { texture: new URL("../assets/minecraft/1.21.1/item/coal.png", import.meta.url).href },
  "minecraft:oak_planks": { texture: new URL("../assets/minecraft/1.21.1/block/oak_planks.png", import.meta.url).href, block: true },
  "minecraft:cobblestone": { texture: new URL("../assets/minecraft/1.21.1/block/cobblestone.png", import.meta.url).href, block: true },
  "minecraft:glass": { texture: new URL("../assets/minecraft/1.21.1/block/glass.png", import.meta.url).href, block: true },
}

export function ItemIcon(props: { id: string; color?: string; texture?: string }) {
  const asset = () => vanilla[props.id]
  return <Show when={asset()} fallback={<Show when={props.texture} fallback={<span class="custom-item-icon" style={{ background: props.color ?? "#89969b" }} aria-hidden="true" />}><img class="vanilla-item-texture" src={props.texture} alt="" draggable={false} /></Show>}>
    <Show when={asset()?.block} fallback={<img class="vanilla-item-texture" src={asset()?.texture} alt="" draggable={false} data-vanilla-item={props.id} />}>
      <span class="vanilla-block-icon" aria-hidden="true"><span class="vanilla-block-cube"><img class="cube-face top" src={asset()?.texture} alt="" draggable={false} /><img class="cube-face front" src={asset()?.texture} alt="" draggable={false} /><img class="cube-face side" src={asset()?.texture} alt="" draggable={false} /></span></span>
    </Show>
  </Show>
}
