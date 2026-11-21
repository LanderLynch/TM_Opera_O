export interface ApplicationSnapshot {
  appId: string;
  isOpen: boolean;
  windowTitle: string;
  visibleElements: Array<{ name: string; controlType: string }>;
  notes?: string;
}

export interface ApplicationAction {
  type:
    | "launch"
    | "focus"
    | "navigate"
    | "read"
    | "prepare_draft"
    | "send_message"
    | "create_document"
    | "save_document"
    | "click"
    | "type";
  target?: string;
  content?: string;
  options?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  data?: unknown;
  evidence: string;
  error?: string;
}

export interface VerificationResult {
  verified: boolean;
  evidence: string;
}

export interface ApplicationAdapter {
  id: string;
  displayName: string;
  detect(): Promise<boolean>;
  launch(): Promise<ActionResult>;
  observe(): Promise<ApplicationSnapshot>;
  capabilities(): Promise<string[]>;
  execute(action: ApplicationAction): Promise<ActionResult>;
  verify(action: ApplicationAction, result: ActionResult): Promise<VerificationResult>;
}
