export class WorkerClosingError extends Error {
  constructor() {
    super("应用正在关闭，无法接受新任务。")
  }
}

/** Drain already accepted RPCs before disposal so no late RPC can start a job after cancellation. */
export function createWorkerLifecycle(dispose: () => Promise<void>) {
  const pending = new Set<Promise<unknown>>()
  const state: { closing: boolean; shutdown?: Promise<void> } = { closing: false }
  return {
    accept<T>(operation: () => Promise<T>): Promise<T> {
      if (state.closing) return Promise.reject(new WorkerClosingError())
      const result = Promise.resolve().then(operation)
      pending.add(result)
      return result.finally(() => {
        pending.delete(result)
      })
    },
    shutdown() {
      state.closing = true
      state.shutdown ??= Promise.allSettled([...pending]).then(dispose)
      return state.shutdown
    },
  }
}

/** True means cleanup acknowledged; false means cleanup failed or exceeded its bound. */
export async function shutdownWithin(dispose: () => Promise<void>, force: () => void, timeoutMs = 10000) {
  const deadline: { timer?: ReturnType<typeof setTimeout> } = {}
  const completed = await Promise.race([
    Promise.resolve()
      .then(dispose)
      .then(
        () => true,
        () => false,
      ),
    new Promise<boolean>((resolve) => {
      deadline.timer = setTimeout(() => resolve(false), timeoutMs)
    }),
  ]).finally(() => clearTimeout(deadline.timer))
  if (!completed) force()
  return completed
}
