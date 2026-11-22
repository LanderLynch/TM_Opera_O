import { InteractionMethod } from "../computerUse/interactionRouter";

export type SkillStatus = "draft" | "approved" | "needs-review" | "deprecated";

export interface SkillStep {
  description: string;
  requiredAppState?: string;
  preferredMethod: InteractionMethod;
  actionParams?: Record<string, unknown>;
  expectedResult: string;
  verificationCondition: string;
  recoveryInstruction?: string;
}

export interface SkillVersionEntry {
  version: number;
  updatedAt: number;
  reason: string;
  status: SkillStatus;
  steps: SkillStep[];
}

export interface ApplicationSkill {
  id: string;
  applicationId: string;
  name: string;
  description: string;
  version: number;
  preconditions: string[];
  steps: SkillStep[];
  expectedResults: string[];
  exceptions: string[];
  verificationRules: string[];
  createdAt: number;
  updatedAt: number;
  status: SkillStatus;
  pendingProposal?: {
    proposedAt: number;
    reason: string;
    steps: SkillStep[];
  };
}
