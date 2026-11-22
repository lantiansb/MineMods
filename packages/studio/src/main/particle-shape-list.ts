import { SHAPES, SHAPE_PARAMETERS, shapePixels } from "@minemods/studio-ai/particle-shapes"
import { encodePng } from "@minemods/mod-core/png"

export function particleShapeList() {
  const cell = 54,
    width = cell * SHAPES.length,
    height = cell * 3
  const pixels = new Uint8Array(width * height * 4)
  SHAPES.forEach((shape, col) => {
    for (let row = 0; row < 3; row++) {
      const tile = shapePixels({ shape, seed: row + 1 })
      for (let y = 0; y < cell; y++)
        for (let x = 0; x < cell; x++) {
          const tx = Math.floor((x - 3) / 3),
            ty = Math.floor((y - 3) / 3)
          const inside = tx >= 0 && tx < 16 && ty >= 0 && ty < 16
          const from = 4 * (ty * 16 + tx),
            alpha = inside ? tile.pixels[from + 3]! / 255 : 0
          const grey = Math.round(36 + ((inside ? tile.pixels[from]! : 36) - 36) * alpha)
          pixels.set([grey, grey, grey, 255], 4 * ((row * cell + y) * width + col * cell + x))
        }
    }
  })
  return {
    common: "side 可选 8、16、32，默认 16；seed 是整数，stage 为 0 到 1。",
    shapes: SHAPES.map((shape) => ({ shape, details: SHAPE_PARAMETERS[shape] })),
    pictures: [
      {
        label: "从左到右：" + SHAPES.join("、") + "。三行依次是种子 1、2、3。",
        url: "data:image/png;base64," + encodePng(pixels, width, height).toString("base64"),
      },
      ...SHAPES.map(shape=>{
        const tile=shapePixels({shape,seed:1}), side=112, width=3*side
        const rgba=new Uint8Array(width*side*4)
        for(let y=0;y<side;y++) for(let x=0;x<width;x++){
          const span=[12,48,96][Math.floor(x/side)]!, u=(x%side-side/2)/span+0.5, v=(y-side/2)/span+0.5
          const src=4*(Math.floor(v*tile.height)*tile.width+Math.floor(u*tile.width))
          const inside=u>=0 && u<1 && v>=0 && v<1, a=inside?tile.pixels[src+3]!/255:0
          const back=((Math.floor(x/12)+Math.floor(y/12))%2)?58:48
          const grey=inside?Math.round(back*(1-a)+tile.pixels[src]!*a):back
          rgba.set([grey,grey,grey,255],4*(y*width+x))
        }
        return {label:SHAPE_PARAMETERS[shape]+" · 0.25 格、1 格、2 格（每格 48 像素）",url:"data:image/png;base64,"+encodePng(rgba,width,side).toString("base64")}
      }),
    ],
  }
}
