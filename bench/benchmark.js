import performance from 'bare-performance'
import process from 'bare-process'

export default async function benchmark(run) {
  const baseline = rss()
  const cpuBefore = process.cpuUsage()
  const start = performance.now()

  const resultKeptFromGC = await run()

  const duration = performance.now() - start
  const cpu = process.cpuUsage(cpuBefore)
  const cpuDuration = (cpu.user + cpu.system) / 1000
  const current = rss()
  const peak = maxRss()

  console.log(
    JSON.stringify({
      duration,
      cpuDuration,
      cpuUtilization: (cpuDuration / duration) * 100,
      baseline,
      current,
      peak,
      delta: current - baseline
    })
  )

  return resultKeptFromGC
}

function rss() {
  return process.memoryUsage().rss
}

function maxRss() {
  return process.resourceUsage().maxRSS * 1024
}
