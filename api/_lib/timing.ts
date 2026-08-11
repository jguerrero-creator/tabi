// Stage-by-stage timing for the AI extraction pipeline (TABI-8). A real Edge timeout kills the
// function mid-flight, so a single summary logged right before `return` never actually gets
// emitted on the run that matters — the 504 case. Each call here logs its own duration the
// instant its promise settles, so Vercel's runtime logs show exactly which stage was still in
// flight when the kill happened, instead of leaving it to guesswork ("probably a latency spike").
export async function timed<T>(logPrefix: string, stage: string, promise: Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    return await promise
  } finally {
    console.log(`${logPrefix}: [timing] ${stage} took ${Date.now() - start}ms`)
  }
}
