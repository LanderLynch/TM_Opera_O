export type InteractionMethod =
  | "native_api"
  | "office_com"
  | "browser_dom"
  | "windows_uia"
  | "background"
  | "visual_fallback";

export const INTERACTION_PRIORITY: InteractionMethod[] = [
  "native_api",
  "office_com",
  "browser_dom",
  "windows_uia",
  "background",
  "visual_fallback",
];

export interface RouteDecision {
  method: InteractionMethod;
  reason: string;
  availableMethods: InteractionMethod[];
}

export interface RouteContext {
  applicationId: string;
  actionType?: string;
  capabilities?: InteractionMethod[];
}

/**
 * Selects the single highest-priority reliable interaction method for a target
 * application so multiple desktop control engines never compete.
 */
export class InteractionRouter {
  public selectMethod(ctx: RouteContext): RouteDecision {
    const app = (ctx.applicationId || "").toLowerCase();
    const caps = new Set<InteractionMethod>(ctx.capabilities || this.inferCapabilities(app));

    for (const method of INTERACTION_PRIORITY) {
      if (caps.has(method)) {
        return {
          method,
          reason: `Selected highest-priority method "${method}" for "${ctx.applicationId || "desktop"}".`,
          availableMethods: INTERACTION_PRIORITY.filter((m) => caps.has(m)),
        };
      }
    }

    return {
      method: "visual_fallback",
      reason: `No higher-priority capability declared for "${ctx.applicationId || "desktop"}"; falling back to visual/mouse/keyboard.`,
      availableMethods: ["visual_fallback"],
    };
  }

  private inferCapabilities(app: string): InteractionMethod[] {
    if (/(word|winword|excel|powerpoint|office)/i.test(app)) {
      return ["office_com", "windows_uia", "visual_fallback"];
    }
    if (/(spotify|shelf)/i.test(app)) {
      return ["native_api", "windows_uia", "visual_fallback"];
    }
    if (/(chrome|edge|firefox|whatsapp|web|browser)/i.test(app)) {
      return ["browser_dom", "windows_uia", "visual_fallback"];
    }
    if (/(steam|discord|notepad|explorer|calc)/i.test(app)) {
      return ["windows_uia", "visual_fallback"];
    }
    return ["windows_uia", "visual_fallback"];
  }
}
