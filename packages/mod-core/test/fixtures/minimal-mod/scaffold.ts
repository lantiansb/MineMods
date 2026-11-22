import path from "node:path"
import { fileURLToPath } from "node:url"
import { scaffoldProject } from "../../../src/fabric/scaffold"

// Supply a fresh destination as an argument. Bun drives this fixture helper;
// production scaffold code also runs under Node after standard TS bundling.
const directory = process.argv[2]
if (!directory) throw new Error("Usage: bun scaffold.ts <new-project-directory>")
const result = await scaffoldProject({
  templateDirectory: fileURLToPath(new URL("../../../../../templates/fabric-1.21", import.meta.url)),
  directory: path.resolve(directory),
  modId: "minimal_mod",
  name: 'MineMods "minimal" $fixture',
  packageName: "studio.fixture.minimal",
  description: "Fabric and GeckoLib compatibility fixture",
})
console.log(JSON.stringify({ directory: result.directory, files: result.files.length, profile: result.profile.id }))
