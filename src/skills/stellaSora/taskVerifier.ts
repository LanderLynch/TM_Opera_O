export interface WorkflowVerificationResult {
  workflowId: string;
  verified: boolean;
  evidence: string;
  timestamp: number;
}

export class StellaSoraTaskVerifier {
  public verifyExecution(
    workflowId: string,
    bridgeOk: boolean,
    observedWindowTitle: string | null,
    error?: string
  ): WorkflowVerificationResult {
    const now = Date.now();
    if (!bridgeOk) {
      return {
        workflowId,
        verified: false,
        evidence: error || `Workflow "${workflowId}" failed or was halted before completion.`,
        timestamp: now,
      };
    }

    if (!observedWindowTitle) {
      return {
        workflowId,
        verified: false,
        evidence: `Workflow "${workflowId}" returned ok, but Stella Sora window was not observed on desktop.`,
        timestamp: now,
      };
    }

    return {
      workflowId,
      verified: true,
      evidence: `Verified "${workflowId}" on window "${observedWindowTitle}".`,
      timestamp: now,
    };
  }
}
