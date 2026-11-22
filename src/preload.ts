import { contextBridge, ipcRenderer, webUtils } from "electron";

const METHODS = [
  "sapaan_awal",
  "tanya_opera_o",
  "lihat_layar",
  "ingat",
  "get_pending_reminder",
  "set_tts",
  "tes_reminder",
  "get_models",
  "get_current_model",
  "ganti_model",
  "tanya_dari_radial",
  "lihat_layar_radial",
  "ingat_radial",
  "get_pending_chat",
  "minimalkan",
  "tutup",
  "buka_chat",
  "buka_radial",
  "buka_radial_prompt",
  "tutup_radial",
  "keluar",
  "refresh_app",
  "set_ignore_mouse",
  "set_ignore_mouse_chat",
  "move_radial",
  "start_drag_radial",
  "stop_drag_radial",
  "notch_media",
  "get_notch_status",
  "get_task_progress",
  "get_api_usage",
  "set_pecut_quota",
  "start_drag_chat",
  "stop_drag_chat",
  "seek_media",
  "open_settings",
  "close_settings",
  "get_settings",
  "save_settings",
  "get_memories",
  "delete_memory_item",
  "clear_all_memories",
  "open_drive_folder",
];

const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
for (const name of METHODS) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke("api", name, ...args);
}

contextBridge.exposeInMainWorld("pywebview", { api });

contextBridge.exposeInMainWorld("agent", {
  start: (goal: string) => ipcRenderer.invoke("agent:start", goal),
  pause: () => ipcRenderer.invoke("agent:pause"),
  resume: () => ipcRenderer.invoke("agent:resume"),
  cancel: () => ipcRenderer.invoke("agent:cancel"),
  emergencyStop: () => ipcRenderer.invoke("agent:emergency-stop"),
  getStatus: () => ipcRenderer.invoke("agent:get-status"),
  approvalResponse: (approved: boolean) => ipcRenderer.invoke("agent:approval-response", approved),
});

contextBridge.exposeInMainWorld("shelf", {
  add: (payload: { type: "text"; text: string; name?: string } | { type: "file"; path: string }) =>
    ipcRenderer.invoke("shelf:add", payload),
  paste: () => ipcRenderer.invoke("shelf:paste"),
  importDialog: () => ipcRenderer.invoke("shelf:import"),
  importPaths: (paths: string[]) => ipcRenderer.invoke("shelf:import-paths", paths),
  list: () => ipcRenderer.invoke("shelf:list"),
  get: (id: string) => ipcRenderer.invoke("shelf:get", id),
  search: (query: string, filter?: string) => ipcRenderer.invoke("shelf:search", query, filter),
  open: (id: string) => ipcRenderer.invoke("shelf:open", id),
  copy: (id: string) => ipcRenderer.invoke("shelf:copy", id),
  delete: (id: string) => ipcRenderer.invoke("shelf:delete", id),
  getStorageInfo: () => ipcRenderer.invoke("shelf:get-storage-info"),
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
});

contextBridge.exposeInMainWorld("notch", {
  getModulesState: () => ipcRenderer.invoke("notch:get-modules-state"),
  dismissNotification: (id: string) => ipcRenderer.invoke("notch:dismiss-notification", id),
  markNotificationsRead: (id?: string) => ipcRenderer.invoke("notch:mark-read", id),
  setShelfOpen: (open: boolean) => ipcRenderer.invoke("notch:set-shelf-open", open),
});
