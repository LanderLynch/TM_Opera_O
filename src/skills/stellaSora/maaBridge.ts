import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as path from "path";

export interface MaaReadinessInfo {
  pythonVersion: string;
  maafwInstalled: boolean;
  maafwVersion: string | null;
  resourcesPresent: boolean;
  resourcePaths: string[];
  error: string | null;
}

export interface MaaWindowMatch {
  hwnd: string;
  title: string;
  className: string;
}

export interface MaaBridgeResponse<T = unknown> {
  id?: string;
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Isolated JSON-lines IPC bridge between Electron/TypeScript and MaaFramework's
 * Python subprocess (skills/games/stella-sora/engine/maa_runner.py).
 */
export class MaaBridge {
  private readonly runnerPath: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuf = "";
  private pending = new Map<
    string,
    { resolve: (res: MaaBridgeResponse) => void; timer: NodeJS.Timeout | null }
  >();

  constructor(skillRootDir: string) {
    this.runnerPath = path.join(skillRootDir, "engine", "maa_runner.py");
  }

  public isRunning(): boolean {
    return Boolean(this.proc && !this.proc.killed && this.proc.exitCode === null);
  }

  public async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.isRunning()) return { ok: true };

    return new Promise((resolve) => {
      try {
        const proc = spawn("python", ["-u", this.runnerPath], { stdio: "pipe" });
        proc.unref();
        let settled = false;

        const readyTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({ ok: false, error: "MaaBridge startup timed out." });
          }
        }, 10_000);

        proc.stdout.on("data", (chunk: Buffer | string) => {
          this.stdoutBuf += String(chunk);
          const lines = this.stdoutBuf.split(/\r?\n/);
          this.stdoutBuf = lines.pop() || "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            try {
              const msg = JSON.parse(line) as MaaBridgeResponse & { event?: string };
              if (msg.event === "ready" && !settled) {
                settled = true;
                clearTimeout(readyTimer);
                resolve({ ok: true });
                continue;
              }
              if (msg.id && this.pending.has(msg.id)) {
                const entry = this.pending.get(msg.id)!;
                this.pending.delete(msg.id);
                if (entry.timer) clearTimeout(entry.timer);
                entry.resolve(msg);
              }
            } catch {}
          }
        });

        proc.on("error", (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(readyTimer);
            resolve({ ok: false, error: err.message });
          }
        });

        proc.on("exit", () => {
          this.proc = null;
          for (const [, entry] of this.pending) {
            if (entry.timer) clearTimeout(entry.timer);
            entry.resolve({ ok: false, error: "MaaBridge subprocess exited." });
          }
          this.pending.clear();
        });

        this.proc = proc;
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  public async sendCommand<T = unknown>(
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<MaaBridgeResponse<T>> {
    if (!this.isRunning()) {
      const started = await this.start();
      if (!started.ok) {
        return { ok: false, error: started.error || "Failed to start MaaBridge." };
      }
    }

    const id = `maa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return new Promise((resolve) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              resolve({ id, ok: false, error: `MaaBridge command "${action}" timed out.` });
            }, timeoutMs)
          : null;

      this.pending.set(id, {
        resolve: resolve as (res: MaaBridgeResponse) => void,
        timer,
      });
      try {
        this.proc!.stdin.write(JSON.stringify({ id, action, ...params }) + "\n");
      } catch (err) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        resolve({ id, ok: false, error: String(err) });
      }
    });
  }

  public async checkReadiness(): Promise<MaaBridgeResponse<MaaReadinessInfo>> {
    return await this.sendCommand<MaaReadinessInfo>("readiness", {}, 15_000);
  }

  public async detectGameWindow(
    windowRegex = "xtlr|星塔旅人|ステラソラ|Stella ?Sora"
  ): Promise<MaaBridgeResponse<{ found: boolean; windows: MaaWindowMatch[] }>> {
    return await this.sendCommand("detect_game", { windowRegex }, 10_000);
  }

  public async runPipelineTask(entry: string, timeoutMs = 0): Promise<MaaBridgeResponse> {
    return await this.sendCommand("run_task", { entry }, timeoutMs);
  }

  public async emergencyStop(): Promise<MaaBridgeResponse> {
    if (!this.isRunning()) return { ok: true, data: { stopped: true } };
    return await this.sendCommand("stop", {}, 5_000);
  }

  public async shutdown(): Promise<void> {
    if (!this.isRunning()) return;
    try {
      await this.sendCommand("shutdown", {}, 3_000);
    } catch {}
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill("SIGTERM");
      } catch {}
    }
    this.proc = null;
  }
}
