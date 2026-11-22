import * as os from "os";

export interface SystemMetrics {
  cpuPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  ramAvailableGb: number;
  ramPercent: number;
  appMemoryMb: number;
  uptimeMinutes: number;
}

let prevIdle = 0;
let prevTotal = 0;
let lastSampleAt = 0;
let cachedMetrics: SystemMetrics = {
  cpuPercent: 0,
  ramUsedGb: 0,
  ramTotalGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
  ramAvailableGb: Number((os.freemem() / 1024 ** 3).toFixed(1)),
  ramPercent: 0,
  appMemoryMb: 0,
  uptimeMinutes: Math.round(os.uptime() / 60),
};

function readCpuTimes(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

export function getSystemMetrics(): SystemMetrics {
  const now = Date.now();
  if (now - lastSampleAt < 1800 && lastSampleAt > 0) {
    return cachedMetrics;
  }
  lastSampleAt = now;

  const { idle, total } = readCpuTimes();
  let cpuPercent = cachedMetrics.cpuPercent;
  if (prevTotal > 0 && total > prevTotal) {
    const idleDiff = idle - prevIdle;
    const totalDiff = total - prevTotal;
    cpuPercent = Math.max(0, Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)));
  }
  prevIdle = idle;
  prevTotal = total;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsage = process.memoryUsage();

  cachedMetrics = {
    cpuPercent,
    ramUsedGb: Number((usedMem / 1024 ** 3).toFixed(1)),
    ramTotalGb: Number((totalMem / 1024 ** 3).toFixed(1)),
    ramAvailableGb: Number((freeMem / 1024 ** 3).toFixed(1)),
    ramPercent: Math.round((usedMem / totalMem) * 100),
    appMemoryMb: Math.round(memUsage.rss / (1024 * 1024)),
    uptimeMinutes: Math.round(os.uptime() / 60),
  };
  return cachedMetrics;
}
