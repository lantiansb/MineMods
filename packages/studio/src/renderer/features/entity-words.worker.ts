import { describeAsset } from "./asset-words"

type Input = { project: Parameters<typeof describeAsset>[0]; item: Parameters<typeof describeAsset>[1]; names: Record<string, string> }

// A large boss's motion and collider measurements are CPU work, independent of the UI and of the game.
self.onmessage = ({ data }: MessageEvent<Input>) => {
  self.postMessage(describeAsset(data.project, data.item, (reference) => data.names[reference] ?? reference))
}
