import { startModelingServer } from "./server"

await startModelingServer({ port: Number(process.env.STUDIO_SERVICE_PORT ?? 4319) })
  .then(() => console.log("MineMods AI developer service is listening on loopback."))
  .catch(() => {
    console.error("SERVICE_START_FAILED")
    process.exitCode = 1
  })
