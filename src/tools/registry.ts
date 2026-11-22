import * as fs from "fs";
import * as path from "path";
import { ApplicationManager } from "../applications/applicationManager";
import { ApplicationAction } from "../applications/applicationTypes";
import {
  createLiveWordDocument,
  findInstalledAppMatches,
  organizeFolder,
  resolveUserFolder,
  scanInstalledApps,
} from "../pcController";
import { ensureForegroundWindow } from "../desktop/foregroundManager";
import { sendShortcut, typeText } from "../desktop/keyboard";
import { clickMouse, MouseButton, scrollMouse } from "../desktop/mouse";
import { listOpenWindows } from "../desktop/windowManager";
import { inspectWindowUITree, invokeUIElementByName } from "../desktop/windowsUIAutomation";
import { guardScreenCoordinates, isProtectedPath } from "../safety/actionGuard";
import { ShelfStore } from "../shelf/shelfStore";
import { AgentTool, ToolContext, ToolResult } from "./toolTypes";
import { validateToolArguments } from "./validation";

export interface ToolRuntimeDependencies {
  getActiveWindowTitle: () => Promise<string>;
  captureScreenBase64?: () => Promise<string | null>;
  openExternalUrl: (url: string) => Promise<void>;
  searchWeb?: (query: string) => Promise<string>;
  shelfStore?: ShelfStore;
  openFilePath?: (filePath: string) => Promise<void>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  public register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  public list(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  public describeForPrompt(): string {
    return this.list()
      .map((t) => {
        const req = t.parameterSchema.required?.join(", ") || "none";
        const props = Object.entries(t.parameterSchema.properties)
          .map(([k, v]) => `${k}: ${v.type}${v.enum ? ` (${v.enum.join("|")})` : ""} — ${v.description}`)
          .join("; ");
        return `- ${t.name} [${t.permissionLevel}]: ${t.description} | required: [${req}] | args: { ${props} }`;
      })
      .join("\n");
  }

  public validate(name: string, args: unknown): Record<string, unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool "${name}".`);
    }
    return validateToolArguments(name, tool.parameterSchema, args);
  }

  public async execute(
    name: string,
    args: unknown,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: null, evidence: "", error: `Unknown tool "${name}"` };
    }
    const validated = validateToolArguments(name, tool.parameterSchema, args);
    return await tool.execute(validated, ctx);
  }
}

export function createDefaultToolRegistry(deps: ToolRuntimeDependencies): ToolRegistry {
  const registry = new ToolRegistry();
  const appManager = new ApplicationManager(deps.searchWeb);

  registry.register({
    name: "get_current_time",
    description: "Get the current local date, day of week, and time on this Windows PC.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const now = new Date();
      return {
        success: true,
        output: {
          iso: now.toISOString(),
          local: now.toLocaleString("id-ID"),
        },
        evidence: `Local time read: ${now.toLocaleString("id-ID")}`,
      };
    },
  });

  registry.register({
    name: "get_active_window",
    description: "Observe the currently active desktop window title behind TM Opera O.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const title = await deps.getActiveWindowTitle();
      return {
        success: true,
        output: { activeWindow: title || "" },
        evidence: title ? `Observed foreground window: "${title}"` : "No foreground window title detected.",
      };
    },
  });

  registry.register({
    name: "scan_installed_apps",
    description: "List installed Windows and Steam applications matching an optional filter.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Optional substring to filter app names." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const apps = await scanInstalledApps(false);
      const q = String(args.filter || "").toLowerCase().trim();
      const filtered = q ? apps.filter((a) => a.name.toLowerCase().includes(q)) : apps.slice(0, 40);
      return {
        success: true,
        output: filtered.map((a) => ({ name: a.name, source: a.source, label: a.label })),
        evidence: `Found ${filtered.length} installed app(s)${q ? ` matching "${q}"` : ""}.`,
      };
    },
  });

  registry.register({
    name: "launch_installed_app",
    description: "Find and launch an installed Windows or Steam application by name.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["appName"],
      properties: {
        appName: { type: "string", minLength: 2, maxLength: 80, description: "Application or game name." },
        variantHint: { type: "string", description: "Optional variant like 'steam' or 'launcher'." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const appName = String(args.appName);
      const hint = String(args.variantHint || appName);
      const res = await findInstalledAppMatches(appName, hint);
      if (res.status === "launched" && res.chosen) {
        return {
          success: true,
          output: res.chosen,
          evidence: `Launched "${res.chosen.label}"`,
        };
      }
      if (res.status === "multiple" && res.options) {
        return {
          success: false,
          output: res.options,
          evidence: `Multiple variants found: ${res.options.map((o) => o.label).join(", ")}`,
          error: "Ambiguous application match; user variant choice needed.",
        };
      }
      return {
        success: false,
        output: null,
        evidence: `No installed application matched "${appName}".`,
        error: `Application "${appName}" is not installed.`,
      };
    },
    async verify(args, result) {
      if (!result.success) return { verified: false, evidence: result.evidence };
      await new Promise((r) => setTimeout(r, 900));
      const active = await deps.getActiveWindowTitle();
      return {
        verified: true,
        evidence: `Post-launch active window observed: "${active || "unknown"}" (launched ${String(args.appName)})`,
      };
    },
  });

  registry.register({
    name: "open_browser_url",
    description: "Open a specific https:// or http:// URL in the user's default browser.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", minLength: 8, maxLength: 500, description: "Full http/https URL to open." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const url = String(args.url).trim();
      if (!/^https?:\/\//i.test(url)) {
        return { success: false, output: null, evidence: "Rejected non-http(s) URL.", error: "Invalid URL scheme." };
      }
      await deps.openExternalUrl(url);
      return {
        success: true,
        output: { url },
        evidence: `Opened URL in default browser: ${url}`,
      };
    },
  });

  if (deps.captureScreenBase64) {
    const captureFn = deps.captureScreenBase64;
    registry.register({
      name: "capture_screenshot",
      description: "Capture a fresh screenshot of the primary display to observe screen state.",
      permissionLevel: "autonomous",
      parameterSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        const b64 = await captureFn();
        if (!b64) {
          return { success: false, output: null, evidence: "Screenshot returned empty.", error: "Capture failed." };
        }
        return {
          success: true,
          output: { bytesApprox: Math.round((b64.length * 3) / 4), hasImage: true },
          evidence: `Captured desktop screenshot (${Math.round((b64.length * 3) / 4)} bytes).`,
        };
      },
    });
  }

  if (deps.searchWeb) {
    const searchFn = deps.searchWeb;
    registry.register({
      name: "search_web_info",
      description: "Search online news and Wikipedia for factual information.",
      permissionLevel: "autonomous",
      parameterSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 2, maxLength: 200, description: "Search query." },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const q = String(args.query);
        const text = await searchFn(q);
        return {
          success: Boolean(text),
          output: { query: q, summary: text },
          evidence: text ? `Retrieved web search snippets for "${q}".` : `No web results found for "${q}".`,
        };
      },
    });
  }

  registry.register({
    name: "create_word_document",
    description: "Create and live-type a formatted Microsoft Word document using Word COM.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["judul", "isi"],
      properties: {
        mode: { type: "string", enum: ["kop_surat", "freeform"], description: "Document layout mode." },
        judul: { type: "string", minLength: 1, maxLength: 200, description: "Document title." },
        isi: { type: "array", description: "Array of paragraph strings." },
        instansi: { type: "string", description: "Header organization name (for kop_surat)." },
        alamat: { type: "string", description: "Header address (for kop_surat)." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const isi = Array.isArray(args.isi) ? args.isi.map((x) => String(x)) : [];
      if (isi.length === 0) {
        return { success: false, output: null, evidence: "Empty paragraph array.", error: "isi must be non-empty." };
      }
      await createLiveWordDocument({
        mode: args.mode === "kop_surat" ? "kop_surat" : "freeform",
        instansi: String(args.instansi || "PT SEMESTA OPERA INDONESIA"),
        subInstansi: "",
        alamat: String(args.alamat || ""),
        judul: String(args.judul),
        isi,
      });
      return {
        success: true,
        output: { judul: args.judul, paragraphs: isi.length },
        evidence: `Triggered Word COM live document "${String(args.judul)}" (${isi.length} paragraphs).`,
      };
    },
  });

  registry.register({
    name: "preview_folder_organization",
    description: "Dry-run preview of files that would be organized in a user folder (no files moved).",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["folder"],
      properties: {
        folder: { type: "string", minLength: 2, maxLength: 260, description: "Folder name (downloads, desktop, documents) or path." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const resolved = resolveUserFolder(String(args.folder));
      if (!resolved || !fs.existsSync(resolved)) {
        return {
          success: false,
          output: null,
          evidence: `Folder "${String(args.folder)}" not found.`,
          error: "Folder not found.",
        };
      }
      const files = fs
        .readdirSync(resolved, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith(".") && e.name.toLowerCase() !== "desktop.ini")
        .map((e) => path.join(resolved, e.name));
      return {
        success: true,
        output: { folder: resolved, fileCount: files.length, sample: files.slice(0, 10) },
        evidence: `Dry-run preview: ${files.length} top-level file(s) in ${resolved}.`,
      };
    },
  });

  // ---- MILESTONE 2: HYBRID DESKTOP CONTROL TOOLS ----
  registry.register({
    name: "list_open_windows",
    description: "List visible open desktop windows with their titles and screen bounding boxes.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const wins = await listOpenWindows();
      return {
        success: true,
        output: wins.slice(0, 25),
        evidence: `Listed ${wins.length} visible open window(s).`,
      };
    },
  });

  registry.register({
    name: "focus_window",
    description: "Bring an open window matching a title substring to the foreground and verify focus.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["titleQuery"],
      properties: {
        titleQuery: { type: "string", minLength: 2, maxLength: 120, description: "Window title substring." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const res = await ensureForegroundWindow(String(args.titleQuery));
      if (!res.ok || !res.window) {
        return {
          success: false,
          output: null,
          evidence: res.reason || "Window not found.",
          error: res.reason || "Could not focus window.",
        };
      }
      return {
        success: true,
        output: res.window,
        evidence: `Focused window "${res.window.title}" at (${res.window.left}, ${res.window.top}).`,
      };
    },
    async verify(args, result) {
      if (!result.success) return { verified: false, evidence: result.evidence };
      const active = await deps.getActiveWindowTitle();
      const matched = active.toLowerCase().includes(String(args.titleQuery).toLowerCase());
      return {
        verified: matched,
        evidence: `Foreground check after focus: "${active}" (expected "${String(args.titleQuery)}").`,
      };
    },
  });

  registry.register({
    name: "inspect_ui_tree",
    description: "Inspect interactive Windows UI Automation elements (buttons, inputs, tabs) inside a window.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["windowTitle"],
      properties: {
        windowTitle: { type: "string", minLength: 2, maxLength: 120, description: "Target window title substring." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const elements = await inspectWindowUITree(String(args.windowTitle));
      return {
        success: elements.length > 0,
        output: elements,
        evidence: `UI Automation found ${elements.length} interactive element(s) in "${String(args.windowTitle)}".`,
        error: elements.length === 0 ? "No UI Automation elements found." : undefined,
      };
    },
  });

  registry.register({
    name: "ui_click_element",
    description: "Click/invoke a named UI element in a target window using Windows UI Automation (falls back to bounding-box click).",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["windowTitle", "elementName"],
      properties: {
        windowTitle: { type: "string", minLength: 2, maxLength: 120, description: "Target window title substring." },
        elementName: { type: "string", minLength: 1, maxLength: 120, description: "Element Name or AutomationId." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const winQ = String(args.windowTitle);
      const elQ = String(args.elementName);
      await ensureForegroundWindow(winQ);
      const res = await invokeUIElementByName(winQ, elQ);
      if (!res.invoked || !res.element) {
        return {
          success: false,
          output: null,
          evidence: `Element "${elQ}" not found in "${winQ}".`,
          error: "UI element not found.",
        };
      }
      if (res.method === "focus") {
        await clickMouse(res.element.x, res.element.y, "left");
      }
      return {
        success: true,
        output: res.element,
        evidence: `Interacted with "${res.element.name}" (${res.element.controlType}) via ${res.method}.`,
      };
    },
  });

  registry.register({
    name: "mouse_click",
    description: "Move cursor to screen coordinates (x, y) and click (left, right, or double).",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["x", "y"],
      properties: {
        x: { type: "number", description: "Screen X coordinate." },
        y: { type: "number", description: "Screen Y coordinate." },
        button: { type: "string", enum: ["left", "right", "double"], description: "Mouse button." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const x = Number(args.x);
      const y = Number(args.y);
      const guard = guardScreenCoordinates(x, y);
      if (!guard.ok) {
        return { success: false, output: null, evidence: guard.reason || "Out of bounds.", error: guard.reason };
      }
      const btn = (args.button as MouseButton) || "left";
      const ok = await clickMouse(x, y, btn);
      return {
        success: ok,
        output: { x, y, button: btn },
        evidence: ok ? `Clicked ${btn} at (${x}, ${y}).` : "Mouse click failed.",
      };
    },
  });

  registry.register({
    name: "mouse_scroll",
    description: "Scroll the mouse wheel vertically (positive = up, negative = down).",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["delta"],
      properties: {
        delta: { type: "number", minimum: -2400, maximum: 2400, description: "Scroll delta (e.g. -360 to scroll down)." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const delta = Number(args.delta);
      const ok = await scrollMouse(delta);
      return {
        success: ok,
        output: { delta },
        evidence: ok ? `Scrolled mouse wheel by ${delta}.` : "Mouse scroll failed.",
      };
    },
  });

  registry.register({
    name: "keyboard_type",
    description: "Type text into the currently focused window/input field.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", minLength: 1, maxLength: 1000, description: "Text to type." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const text = String(args.text);
      const ok = await typeText(text);
      return {
        success: ok,
        output: { length: text.length },
        evidence: ok ? `Typed ${text.length} character(s) into focused window.` : "Keyboard typing failed.",
      };
    },
  });

  registry.register({
    name: "keyboard_shortcut",
    description: "Send an allowed keyboard shortcut fast (e.g. enter, tab, esc, ctrl+c, ctrl+v, ctrl+z, ctrl+l, ctrl+t, ctrl+w, alt+tab, alt+f4).",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["shortcut"],
      properties: {
        shortcut: { type: "string", minLength: 2, maxLength: 30, description: "Shortcut string." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const shortcut = String(args.shortcut);
      const res = await sendShortcut(shortcut);
      return {
        success: res.ok,
        output: { shortcut },
        evidence: res.ok ? `Sent shortcut "${shortcut}".` : res.error || "Shortcut rejected.",
        error: res.error,
      };
    },
  });

  // ---- MILESTONE 4 & 5: APPLICATION ADAPTERS & CROSS-APP WORKFLOW TOOLS ----
  registry.register({
    name: "operate_application",
    description:
      "Operate Discord, WhatsApp Web, Chrome, Word, or any Windows app via its adapter (launch, focus, navigate, read, prepare_draft, create_document, save_document, click, type). Never use for sending external messages.",
    permissionLevel: "autonomous",
    parameterSchema: {
      type: "object",
      required: ["app", "actionType"],
      properties: {
        app: { type: "string", minLength: 2, maxLength: 80, description: "App name/id (discord, whatsapp, chrome, word, or any app)." },
        actionType: {
          type: "string",
          enum: ["launch", "focus", "navigate", "read", "prepare_draft", "create_document", "save_document", "click", "type"],
          description: "Adapter action to perform.",
        },
        target: { type: "string", description: "Channel, contact, URL, element name, or filename." },
        content: { type: "string", description: "Draft text or document content." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const adapter = appManager.resolveAdapter(String(args.app));
      const action: ApplicationAction = {
        type: args.actionType as ApplicationAction["type"],
        target: args.target ? String(args.target) : undefined,
        content: args.content ? String(args.content) : undefined,
      };
      const res = await adapter.execute(action);
      return {
        success: res.success,
        output: res.data ?? null,
        evidence: `[${adapter.displayName}] ${res.evidence}`,
        error: res.error,
      };
    },
    async verify(args, result) {
      const adapter = appManager.resolveAdapter(String(args.app));
      const action: ApplicationAction = {
        type: args.actionType as ApplicationAction["type"],
        target: args.target ? String(args.target) : undefined,
        content: args.content ? String(args.content) : undefined,
      };
      return await adapter.verify(action, {
        success: result.success,
        data: result.output,
        evidence: result.evidence,
        error: result.error,
      });
    },
  });

  registry.register({
    name: "send_external_message",
    description: "Send a message in Discord or WhatsApp Web AFTER explicit user approval.",
    permissionLevel: "confirm",
    parameterSchema: {
      type: "object",
      required: ["app", "recipient", "message"],
      properties: {
        app: { type: "string", enum: ["discord", "whatsapp"], description: "Target messaging app." },
        recipient: { type: "string", minLength: 1, maxLength: 120, description: "Channel or contact name." },
        message: { type: "string", minLength: 1, maxLength: 2000, description: "Exact message to send." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const adapter = appManager.resolveAdapter(String(args.app));
      const res = await adapter.execute({
        type: "send_message",
        target: String(args.recipient),
        content: String(args.message),
      });
      return {
        success: res.success,
        output: res.data ?? null,
        evidence: res.evidence,
        error: res.error,
      };
    },
    async verify(args, result) {
      const adapter = appManager.resolveAdapter(String(args.app));
      return await adapter.verify(
        { type: "send_message", target: String(args.recipient), content: String(args.message) },
        { success: result.success, data: result.output, evidence: result.evidence, error: result.error }
      );
    },
  });

  registry.register({
    name: "execute_folder_organization",
    description: "Organize files in an approved user folder into category subfolders (requires confirmation).",
    permissionLevel: "confirm",
    parameterSchema: {
      type: "object",
      required: ["folder"],
      properties: {
        folder: { type: "string", minLength: 2, maxLength: 260, description: "Folder name or path." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const resolved = resolveUserFolder(String(args.folder));
      if (!resolved) {
        return { success: false, output: null, evidence: "Folder not found.", error: "Folder not found." };
      }
      if (isProtectedPath(resolved)) {
        return { success: false, output: null, evidence: `Blocked protected system path: ${resolved}`, error: "Protected path." };
      }
      const res = organizeFolder(resolved);
      return {
        success: true,
        output: res,
        evidence: res.summary,
      };
    },
  });

  // ---- SHELF INTEGRATION TOOLS ----
  if (deps.shelfStore) {
    const shelf = deps.shelfStore;

    registry.register({
      name: "shelf_save_text",
      description: "Save a text note, snippet, or reference into the persistent local Shelf.",
      permissionLevel: "autonomous",
      parameterSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 50000, description: "Text content to save." },
          name: { type: "string", maxLength: 80, description: "Optional short title." },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const res = shelf.addText(String(args.text), args.name ? String(args.name) : undefined);
        return {
          success: res.ok,
          output: res.item || null,
          evidence: res.ok ? `Saved text item "${res.item?.name}" to Shelf.` : res.error || "Failed.",
          error: res.error,
        };
      },
    });

    registry.register({
      name: "shelf_search",
      description: "Search items saved in the local Shelf by filename, content, or type.",
      permissionLevel: "autonomous",
      parameterSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          type: { type: "string", enum: ["all", "image", "document", "text"], description: "Optional type filter." },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const q = String(args.query || "");
        const filter = (args.type as "all" | "image" | "document" | "text") || "all";
        const items = shelf.search(q, filter);
        return {
          success: true,
          output: items.map((i) => ({ id: i.id, name: i.name, type: i.type, size: i.size })),
          evidence: `Found ${items.length} Shelf item(s) matching "${q}".`,
        };
      },
    });

    registry.register({
      name: "shelf_open",
      description: "Open a stored Shelf item using its default Windows application.",
      permissionLevel: "autonomous",
      parameterSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 3, description: "Shelf item ID." },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const item = shelf.get(String(args.id));
        if (!item || !item.filePath) {
          return { success: false, output: null, evidence: "Shelf item not found.", error: "Item not found." };
        }
        if (deps.openFilePath) {
          await deps.openFilePath(item.filePath);
        }
        return {
          success: true,
          output: { id: item.id, name: item.name, filePath: item.filePath },
          evidence: `Opened Shelf item "${item.name}" (${item.type}).`,
        };
      },
    });

    registry.register({
      name: "shelf_delete",
      description: "Delete an item from Shelf (requires user approval).",
      permissionLevel: "confirm",
      parameterSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 3, description: "Shelf item ID to delete." },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const ok = shelf.delete(String(args.id));
        return {
          success: ok,
          output: { deleted: ok, id: args.id },
          evidence: ok ? `Deleted Shelf item ${String(args.id)}.` : "Shelf item not found.",
          error: ok ? undefined : "Item not found.",
        };
      },
    });
  }

  return registry;
}
