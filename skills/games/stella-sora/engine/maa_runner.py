#!/usr/bin/env python3
"""
Isolated MaaFramework JSON-lines subprocess bridge for TM Opera O.
Handles readiness checks, Win32 window discovery, screenshot capture,
task execution, and immediate stop without touching game memory.
"""

import json
import os
import re
import sys
import threading
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
UPSTREAM_DIR = BASE_DIR / "upstream"
RESOURCE_PATHS = [
    UPSTREAM_DIR / "assets" / "resource" / "base",
    UPSTREAM_DIR / "assets" / "resource" / "en",
    UPSTREAM_DIR / "assets" / "resource" / "windows",
]

stop_event = threading.Event()
active_tasker = None


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def check_readiness() -> dict:
    info = {
        "pythonVersion": sys.version.split()[0],
        "maafwInstalled": False,
        "maafwVersion": None,
        "resourcesPresent": all(p.exists() for p in RESOURCE_PATHS),
        "resourcePaths": [str(p) for p in RESOURCE_PATHS],
        "error": None,
    }
    try:
        import maa  # type: ignore
        from maa.toolkit import Toolkit  # type: ignore

        Toolkit.init_option(str(UPSTREAM_DIR / "assets"))
        info["maafwInstalled"] = True
        info["maafwVersion"] = getattr(maa, "__version__", "installed")
    except Exception as exc:
        info["error"] = str(exc)
    return info


def find_game_window(window_regex: str = r"xtlr|星塔旅人|ステラソラ|Stella ?Sora") -> dict:
    try:
        from maa.toolkit import Toolkit  # type: ignore

        windows = Toolkit.find_desktop_windows()
        pattern = re.compile(window_regex, re.IGNORECASE)
        matches = []
        for w in windows:
            title = getattr(w, "window_name", "") or ""
            cls = getattr(w, "class_name", "") or ""
            if pattern.search(title):
                matches.append({
                    "hwnd": str(getattr(w, "hwnd", "")),
                    "title": title,
                    "className": cls,
                })
        return {"ok": True, "found": len(matches) > 0, "windows": matches}
    except Exception as exc:
        return {"ok": False, "found": False, "windows": [], "error": str(exc)}


def handle_command(cmd: dict) -> dict:
    action = cmd.get("action")
    if action == "readiness":
        return {"id": cmd.get("id"), "ok": True, "data": check_readiness()}

    if action == "detect_game":
        regex = cmd.get("windowRegex") or r"xtlr|星塔旅人|ステラソラ|Stella ?Sora"
        return {"id": cmd.get("id"), "ok": True, "data": find_game_window(regex)}

    if action == "stop":
        stop_event.set()
        global active_tasker
        if active_tasker is not None:
            try:
                active_tasker.post_stop()
            except Exception:
                pass
        return {"id": cmd.get("id"), "ok": True, "data": {"stopped": True}}

    if action == "run_task":
        stop_event.clear()
        readiness = check_readiness()
        if not readiness["maafwInstalled"]:
            return {
                "id": cmd.get("id"),
                "ok": False,
                "error": f"MaaFw is not installed: {readiness.get('error')}",
            }
        win_res = find_game_window()
        if not win_res.get("found"):
            return {
                "id": cmd.get("id"),
                "ok": False,
                "error": "Stella Sora window not detected on desktop. Launch the game first.",
            }
        entry = cmd.get("entry")
        if not entry:
            return {"id": cmd.get("id"), "ok": False, "error": "Missing pipeline entry."}
        try:
            from maa.controller import Win32Controller  # type: ignore
            from maa.resource import Resource  # type: ignore
            from maa.tasker import Tasker  # type: ignore

            hwnd = int(win_res["windows"][0]["hwnd"])
            ctrl = Win32Controller(hwnd)
            ctrl.post_connection().wait()

            res = Resource()
            for rp in RESOURCE_PATHS:
                if rp.exists():
                    res.post_bundle(str(rp)).wait()

            tasker = Tasker()
            tasker.bind(res, ctrl)
            active_tasker = tasker
            if not tasker.inited:
                return {"id": cmd.get("id"), "ok": False, "error": "Tasker failed to initialize."}

            job = tasker.post_task(entry)
            job.wait()
            active_tasker = None
            return {
                "id": cmd.get("id"),
                "ok": job.succeeded,
                "data": {"entry": entry, "succeeded": bool(job.succeeded)},
            }
        except Exception as exc:
            active_tasker = None
            return {"id": cmd.get("id"), "ok": False, "error": str(exc)}

    return {"id": cmd.get("id"), "ok": False, "error": f"Unknown action: {action}"}


def main() -> None:
    emit({"event": "ready", "pid": os.getpid()})
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        try:
            cmd = json.loads(raw)
        except Exception as exc:
            emit({"ok": False, "error": f"Invalid JSON: {exc}"})
            continue
        if cmd.get("action") == "shutdown":
            emit({"id": cmd.get("id"), "ok": True, "data": {"shutdown": True}})
            break
        emit(handle_command(cmd))


if __name__ == "__main__":
    main()
