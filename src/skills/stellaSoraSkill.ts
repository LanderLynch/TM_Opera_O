import { StellaSoraEngineManager, StellaSoraStatusSnapshot } from "./stellaSora/engineManager";

export type StellaSoraIntent =
  | { type: "activate" }
  | { type: "open_and_check" }
  | { type: "run_workflows"; workflowIds: string[] }
  | { type: "adaptive_mode"; enabled: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "progress" };

export function parseStellaSoraCommand(input: string): StellaSoraIntent | null {
  const lower = (input || "").toLowerCase().trim();
  if (!lower.includes("stella sora")) return null;

  if (/\b(stop|halt|emergency|hentikan|matikan)\b/i.test(lower)) {
    return { type: "stop" };
  }
  if (/\b(pause|jeda)\b/i.test(lower)) {
    return { type: "pause" };
  }
  if (/\b(resume|lanjut)\b/i.test(lower)) {
    return { type: "resume" };
  }
  if (/\b(progress|report|status|laporan|progres)\b/i.test(lower) && !/\b(open|run|activate)\b/i.test(lower)) {
    return { type: "progress" };
  }
  if (/\badaptive\b/i.test(lower)) {
    const off = /\b(off|disable|stop)\b/i.test(lower);
    return { type: "adaptive_mode", enabled: !off };
  }
  if (/\b(open|launch|buka)\b/i.test(lower) && /\b(check|running|cek)\b/i.test(lower)) {
    return { type: "open_and_check" };
  }
  if (/\b(run|jalankan|start|mulai|daily|harian)\b/i.test(lower)) {
    const workflows = ["login-check", "mailbox", "friend-gifts", "daily-missions", "shop"];
    if (/\b(event|events|activity)\b/i.test(lower)) {
      workflows.push("events");
    }
    if (/\btower\b/i.test(lower)) {
      workflows.push("tower");
    }
    return { type: "run_workflows", workflowIds: workflows };
  }
  if (/\b(activate|aktifkan|init|enable|skill)\b/i.test(lower)) {
    return { type: "activate" };
  }

  return null;
}

export async function handleStellaSoraCommand(
  manager: StellaSoraEngineManager,
  command: string
): Promise<{ summary: string; status: StellaSoraStatusSnapshot }> {
  const intent = parseStellaSoraCommand(command) || { type: "activate" };

  switch (intent.type) {
    case "activate": {
      const status = await manager.activate();
      const engineTxt = status.engineReady ? "MaaFw ready" : `MaaFw unavailable (${status.readiness?.error || "check python"})`;
      const gameTxt = status.gameState?.isRunning
        ? `Running (${status.gameState.windowTitle})`
        : status.gameState?.installedInSteam
          ? "Installed in Steam (not running)"
          : "Not installed yet";
      return {
        summary: `Stella Sora Skill activated (no workflows auto-executed). Engine: ${engineTxt}. Game: ${gameTxt}. Compatibility: ${status.compatibilityStatus}.`,
        status,
      };
    }

    case "open_and_check": {
      await manager.activate();
      let game = await manager.processManager.detect();
      let launchMsg = "";
      if (!game.isRunning && game.installedInSteam) {
        const launch = await manager.processManager.launchViaSteam();
        launchMsg = launch.message + " ";
        game = await manager.processManager.detect();
      }
      const status = manager.getStatus();
      return {
        summary: `${launchMsg}Stella Sora running: ${game.isRunning ? `Yes (${game.windowTitle})` : "No"}${game.installedInSteam ? "" : " (not installed in Steam yet)"}.`,
        status,
      };
    }

    case "run_workflows": {
      const res = await manager.runWorkflows(intent.workflowIds);
      return { summary: res.report, status: res.status };
    }

    case "adaptive_mode": {
      await manager.activate();
      const status = manager.setAdaptiveMode(intent.enabled);
      return {
        summary: `Stella Sora Adaptive Mode ${intent.enabled ? "enabled" : "disabled"}. Any UI-change workflow proposals require user approval before overwriting.`,
        status,
      };
    }

    case "pause": {
      const status = manager.pause();
      return { summary: "Stella Sora Automation paused.", status };
    }

    case "resume": {
      const status = manager.resume();
      return { summary: "Stella Sora Automation resumed.", status };
    }

    case "stop": {
      const status = await manager.stop();
      return { summary: "Stella Sora Automation stopped immediately.", status };
    }

    case "progress": {
      const status = manager.getStatus();
      return { summary: manager.getProgressReport(), status };
    }
  }
}
