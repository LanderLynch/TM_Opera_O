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

    if action == "capture_screenshot":
        win_res = find_game_window()
        if not win_res.get("found"):
            return {"id": cmd.get("id"), "ok": False, "error": "Stella Sora window not found for screenshot."}
        try:
            from maa.controller import Win32Controller  # type: ignore
            import base64
            import io

            hwnd = int(win_res["windows"][0]["hwnd"])
            ctrl = Win32Controller(hwnd)
            ctrl.post_connection().wait()
            job = ctrl.post_screencap()
            job.wait()
            img = job.get()
            out_path = cmd.get("outPath")
            if out_path and img is not None:
                from PIL import Image  # type: ignore
                Image.fromarray(img).save(str(out_path))
                return {"id": cmd.get("id"), "ok": True, "data": {"savedPath": str(out_path), "title": win_res["windows"][0]["title"]}}
            return {"id": cmd.get("id"), "ok": img is not None, "data": {"title": win_res["windows"][0]["title"]}}
        except Exception as exc:
            return {"id": cmd.get("id"), "ok": False, "error": str(exc)}

    if action == "probe_click":
        mode = cmd.get("mode") or "maa_win32"
        win_res = find_game_window()
        if not win_res.get("found"):
            return {"id": cmd.get("id"), "ok": False, "error": "Stella Sora window not found for input probe."}
        try:
            import ctypes
            import ctypes.wintypes as wt
            import tempfile
            import time
            import numpy as np  # type: ignore
            from PIL import Image  # type: ignore
            from maa.controller import Win32Controller  # type: ignore

            user32 = ctypes.windll.user32
            hwnd = int(win_res["windows"][0]["hwnd"])
            title = win_res["windows"][0]["title"]

            class POINT(ctypes.Structure):
                _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

            class MOUSEINPUT(ctypes.Structure):
                _fields_ = [
                    ("dx", ctypes.c_long),
                    ("dy", ctypes.c_long),
                    ("mouseData", wt.DWORD),
                    ("dwFlags", wt.DWORD),
                    ("time", wt.DWORD),
                    ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
                ]

            class INPUT_UNION(ctypes.Union):
                _fields_ = [("mi", MOUSEINPUT)]

            class INPUT(ctypes.Structure):
                _fields_ = [("type", wt.DWORD), ("union", INPUT_UNION)]

            def get_cursor() -> dict:
                pt = POINT()
                user32.GetCursorPos(ctypes.byref(pt))
                return {"x": int(pt.x), "y": int(pt.y)}

            ctrl = Win32Controller(hwnd)
            ctrl.post_connection().wait()

            before_job = ctrl.post_screencap()
            before_job.wait()
            before_img = before_job.get()
            if before_img is None:
                return {"id": cmd.get("id"), "ok": False, "error": "Failed to capture before-click screenshot."}

            h_px, w_px = before_img.shape[0], before_img.shape[1]
            target_x = int(cmd.get("x") or (w_px // 2))
            target_y = int(cmd.get("y") or (h_px // 2))

            out_dir = Path(cmd.get("outDir") or tempfile.gettempdir())
            out_dir.mkdir(parents=True, exist_ok=True)
            ts = int(time.time() * 1000)
            before_path = out_dir / f"probe_{mode}_{ts}_before.png"
            after_path = out_dir / f"probe_{mode}_{ts}_after.png"
            Image.fromarray(before_img).save(str(before_path))

            fg_before = (user32.GetForegroundWindow() == hwnd)
            cursor_before = get_cursor()
            dispatched = False
            send_count = 0

            if mode == "maa_win32":
                click_job = ctrl.post_click(target_x, target_y)
                click_job.wait()
                dispatched = bool(click_job.succeeded)
            elif mode == "win32_sendinput":
                user32.SetForegroundWindow(hwnd)
                time.sleep(0.08)
                pt_screen = POINT(target_x, target_y)
                user32.ClientToScreen(hwnd, ctypes.byref(pt_screen))
                user32.SetCursorPos(pt_screen.x, pt_screen.y)
                time.sleep(0.05)

                extra = ctypes.c_ulong(0)
                down = INPUT(type=0, union=INPUT_UNION(mi=MOUSEINPUT(0, 0, 0, 0x0002, 0, ctypes.pointer(extra))))
                up = INPUT(type=0, union=INPUT_UNION(mi=MOUSEINPUT(0, 0, 0, 0x0004, 0, ctypes.pointer(extra))))
                arr = (INPUT * 2)(down, up)
                send_count = int(user32.SendInput(2, ctypes.byref(arr), ctypes.sizeof(INPUT)))
                dispatched = (send_count == 2)
            else:
                return {"id": cmd.get("id"), "ok": False, "error": f"Unknown probe mode: {mode}"}

            time.sleep(0.7)
            fg_after = (user32.GetForegroundWindow() == hwnd)
            cursor_after = get_cursor()

            after_job = ctrl.post_screencap()
            after_job.wait()
            after_img = after_job.get()
            diff_pct = 0.0
            if after_img is not None:
                Image.fromarray(after_img).save(str(after_path))
                diff_pct = float(np.mean(np.abs(after_img.astype(np.int16) - before_img.astype(np.int16))) / 255.0 * 100.0)

            return {
                "id": cmd.get("id"),
                "ok": True,
                "data": {
                    "mode": mode,
                    "hwnd": str(hwnd),
                    "windowTitle": title,
                    "targetClientXY": {"x": target_x, "y": target_y},
                    "foregroundBefore": fg_before,
                    "foregroundAfter": fg_after,
                    "cursorBefore": cursor_before,
                    "cursorAfter": cursor_after,
                    "dispatched": dispatched,
                    "sendInputCount": send_count,
                    "pixelDiffPercent": round(diff_pct, 3),
                    "screenChanged": diff_pct >= 0.8,
                    "beforePath": str(before_path),
                    "afterPath": str(after_path),
                },
            }
        except Exception as exc:
            return {"id": cmd.get("id"), "ok": False, "error": str(exc)}

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
