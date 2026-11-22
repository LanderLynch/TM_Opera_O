import { AgentModelClient } from "../ai/toolCalling";
import { InteractionRouter } from "../computerUse/interactionRouter";
import { SkillStore } from "./skillStore";
import { ApplicationSkill, SkillStep } from "./skillTypes";

export interface RecordedDemoAction {
  windowTitle: string;
  actionType: string;
  targetName?: string;
  text?: string;
  coordinates?: { x: number; y: number };
  timestamp: number;
}

/**
 * Records a user desktop demonstration and converts it into a draft ApplicationSkill.
 */
export class DemonstrationRecorder {
  private active = false;
  private applicationId = "";
  private skillName = "";
  private actions: RecordedDemoAction[] = [];
  private readonly router = new InteractionRouter();

  public start(applicationId: string, skillName: string): void {
    this.active = true;
    this.applicationId = applicationId;
    this.skillName = skillName;
    this.actions = [];
  }

  public isRecording(): boolean {
    return this.active;
  }

  public recordAction(action: Omit<RecordedDemoAction, "timestamp">): boolean {
    if (!this.active) return false;
    this.actions.push({ ...action, timestamp: Date.now() });
    return true;
  }

  public stopAndPropose(store: SkillStore): ApplicationSkill | null {
    if (!this.active) return null;
    this.active = false;
    const route = this.router.selectMethod({ applicationId: this.applicationId });

    const steps: SkillStep[] =
      this.actions.length > 0
        ? this.actions.map((a, idx) => ({
            description: a.targetName
              ? `${a.actionType} on "${a.targetName}" in ${a.windowTitle}`
              : `${a.actionType} in ${a.windowTitle}`,
            requiredAppState: `Window matching "${a.windowTitle}" is visible`,
            preferredMethod: a.targetName ? route.method : "visual_fallback",
            actionParams: {
              targetName: a.targetName,
              text: a.text,
              coordinates: a.coordinates,
            },
            expectedResult: `Step ${idx + 1} action completes`,
            verificationCondition: `Observe updated UI in "${a.windowTitle}"`,
          }))
        : [
            {
              description: `Open and verify ${this.applicationId}`,
              preferredMethod: route.method,
              expectedResult: `${this.applicationId} is ready`,
              verificationCondition: `Foreground window matches ${this.applicationId}`,
            },
          ];

    const now = Date.now();
    const skill: ApplicationSkill = {
      id: `skill_${now}_${Math.random().toString(36).slice(2, 6)}`,
      applicationId: this.applicationId,
      name: this.skillName,
      description: `Learned via user demonstration (${steps.length} step(s)).`,
      version: 1,
      preconditions: [`${this.applicationId} is installed and accessible`],
      steps,
      expectedResults: [`${this.skillName} completes with verified UI state`],
      exceptions: ["Authentication or unexpected blocking modal requires user review"],
      verificationRules: ["Verify final window/screen state after last step"],
      createdAt: now,
      updatedAt: now,
      status: "draft",
    };

    return store.save(skill, "Created from user demonstration");
  }
}

/**
 * Coordinates Instruction-Based, Demonstration-Based, and Adaptive Execution-Based learning.
 */
export class LearningEngine {
  private readonly router = new InteractionRouter();
  public readonly recorder = new DemonstrationRecorder();

  constructor(private readonly store: SkillStore) {}

  public async learnFromInstruction(
    applicationId: string,
    name: string,
    instruction: string,
    modelClient?: AgentModelClient
  ): Promise<ApplicationSkill> {
    const route = this.router.selectMethod({ applicationId });
    let steps: SkillStep[] = [];

    if (modelClient) {
      try {
        const raw = await modelClient.complete(
          "Convert the user's application procedure into a JSON array of steps: [{\"description\":\"...\",\"expectedResult\":\"...\",\"verificationCondition\":\"...\"}]. Return JSON only.",
          `Application: ${applicationId}\nInstruction: ${instruction}`,
          "fast"
        );
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]) as Array<Record<string, unknown>>;
          steps = parsed
            .filter((x) => x && typeof x.description === "string")
            .map((x) => ({
              description: String(x.description),
              preferredMethod: route.method,
              expectedResult: String(x.expectedResult || "Step completed"),
              verificationCondition: String(x.verificationCondition || "Observe UI change"),
            }));
        }
      } catch {}
    }

    if (steps.length === 0) {
      const clauses = instruction
        .split(/(?:,\s*then\s+|\.\s+|;\s+|\s+then\s+)/i)
        .map((s) => s.trim())
        .filter(Boolean);
      steps = (clauses.length > 0 ? clauses : [instruction.trim()]).map((clause) => ({
        description: clause,
        preferredMethod: route.method,
        expectedResult: `Completed: ${clause}`,
        verificationCondition: `Observe expected UI state for "${clause}"`,
      }));
    }

    const now = Date.now();
    const skill: ApplicationSkill = {
      id: `skill_${now}_${Math.random().toString(36).slice(2, 6)}`,
      applicationId,
      name,
      description: instruction.trim(),
      version: 1,
      preconditions: [`${applicationId} can be launched or focused`],
      steps,
      expectedResults: steps.map((s) => s.expectedResult),
      exceptions: ["Unexpected pop-up, login prompt, or UI layout change"],
      verificationRules: steps.map((s) => s.verificationCondition),
      createdAt: now,
      updatedAt: now,
      status: "draft",
    };

    return this.store.save(skill, "Created from natural-language instruction");
  }

  public proposeAdaptiveUpdate(
    skillId: string,
    observedDifference: string,
    proposedSteps: SkillStep[]
  ): ApplicationSkill | null {
    return this.store.proposeUpdate(skillId, observedDifference, proposedSteps);
  }
}
