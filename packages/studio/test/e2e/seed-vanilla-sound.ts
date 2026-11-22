import {createHash} from "node:crypto"
import {mkdir,writeFile} from "node:fs/promises"
import path from "node:path"
import {vanillaAudio} from "../../src/main/vanilla-audio"

/** Copy one already installed sound to the isolated test runtime. Never change the installed game. */
const [runtime,destination]=process.argv.slice(2)
const src=await vanillaAudio(runtime!,"1.21.1","entity.cow.ambient")
if(!src) throw new Error("本机还没有牛的声音文件。")
const assets=path.join(destination!,"gradle-home","caches","fabric-loom","assets")
async function object(bytes:Buffer){
 const hash=createHash("sha1").update(bytes).digest("hex"),dir=path.join(assets,"objects",hash.slice(0,2))
 await mkdir(dir,{recursive:true});await writeFile(path.join(dir,hash),bytes)
 return {hash,size:bytes.length}
}
const ogg=await object(Buffer.from(src.split(",")[1]!,"base64"))
const index=await object(Buffer.from(JSON.stringify({"entity.cow.ambient":{sounds:["mob/cow/sample"]}})))
await mkdir(path.join(assets,"indexes"),{recursive:true})
await writeFile(path.join(assets,"indexes","1.21.1-17.json"),JSON.stringify({objects:{"minecraft/sounds.json":index,"minecraft/sounds/mob/cow/sample.ogg":ogg}}))
