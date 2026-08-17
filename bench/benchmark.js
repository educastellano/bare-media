import performance from 'bare-performance'
import process from 'bare-process'

export default async function benchmark(run) {
  const baseline = maxRss()
  const cpuBefore = process.cpuUsage()
  const start = performance.now()

  await run()

  const duration = performance.now() - start
  const cpu = process.cpuUsage(cpuBefore)
  const cpuDuration = (cpu.user + cpu.system) / 1000
  const peak = maxRss()

  console.log(
    JSON.stringify({
      duration,
      cpuDuration,
      cpuUtilization: (cpuDuration / duration) * 100,
      baseline,
      peak,
      delta: peak - baseline
    })
  )
}

function maxRss() {
  return process.resourceUsage().maxRSS * 1024
}
