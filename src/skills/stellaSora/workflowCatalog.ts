export interface StellaSoraWorkflowSpec {
  id: string;
  name: string;
  pipelineEntry: string;
  sourceFiles: string[];
  entryConditions: string[];
  requiredGameState: string;
  recognitionRules: string[];
  expectedResult: string;
  failureConditions: string[];
  recoveryProcedure: string;
  serverCompatibility: string[];
  knownLimitations: string[];
}

export const STELLA_SORA_WORKFLOWS: StellaSoraWorkflowSpec[] = [
  {
    id: "login-check",
    name: "Login & Startup Check",
    pipelineEntry: "StartUp",
    sourceFiles: [
      "upstream/assets/interface/tasks/login.json",
      "upstream/assets/resource/en/pipeline/daily/login.json",
      "upstream/assets/resource/windows/pipeline/daily/login.json",
    ],
    entryConditions: ["Stella Sora desktop window is open and visible"],
    requiredGameState: "Title screen or main lobby",
    recognitionRules: ["OCR: 'Select anywhere to start', 'Claimable', 'Items Obtained'"],
    expectedResult: "Main lobby reached without blocking login/download prompt",
    failureConditions: ["Account login/MFA required", "Asset download stalled"],
    recoveryProcedure: "Stop and notify user to complete login or patch download",
    serverCompatibility: ["en (Global — pending live Steam verification)", "cn", "jp", "kr", "tw"],
    knownLimitations: ["Windows StartApp is disabled upstream; Steam launch is handled externally by TM Opera O"],
  },
  {
    id: "daily-missions",
    name: "Daily Missions",
    pipelineEntry: "Task",
    sourceFiles: ["upstream/assets/interface/tasks/task.json", "upstream/assets/resource/en/pipeline/daily/task.json"],
    entryConditions: ["Game is in main lobby"],
    requiredGameState: "Daily missions unlocked",
    recognitionRules: ["Daily quest tab & claim buttons"],
    expectedResult: "Completed daily missions and rewards claimed",
    failureConditions: ["Unexpected event popup blocking lobby"],
    recoveryProcedure: "Re-observe screen, dismiss known non-destructive modal, or escalate to user",
    serverCompatibility: ["en (pending live Steam verification)"],
    knownLimitations: ["Template offsets may need tuning on Steam Global aspect ratios"],
  },
  {
    id: "mailbox",
    name: "Mailbox Rewards",
    pipelineEntry: "Mail",
    sourceFiles: ["upstream/assets/interface/tasks/mail.json", "upstream/assets/resource/base/pipeline/daily/mail.json"],
    entryConditions: ["Game is in main lobby"],
    requiredGameState: "Mailbox accessible",
    recognitionRules: ["Mail icon & Claim All button"],
    expectedResult: "All non-expired mailbox rewards collected",
    failureConditions: ["Inventory full warning"],
    recoveryProcedure: "Stop and report inventory cap to user",
    serverCompatibility: ["en (pending live Steam verification)"],
    knownLimitations: ["Requires EN overlay verification"],
  },
  {
    id: "friend-gifts",
    name: "Friend Gifts & Grant",
    pipelineEntry: "Friend",
    sourceFiles: ["upstream/assets/interface/tasks/friend.json", "upstream/assets/resource/en/pipeline/daily/friend.json"],
    entryConditions: ["Game is in main lobby"],
    requiredGameState: "Friends menu accessible",
    recognitionRules: ["Friend gift claim/send buttons"],
    expectedResult: "Friend gifts sent and received",
    failureConditions: ["Daily limit reached"],
    recoveryProcedure: "Mark step complete with verified limit notice",
    serverCompatibility: ["en (pending live Steam verification)"],
    knownLimitations: ["None known beyond live UI check"],
  },
  {
    id: "shop",
    name: "Daily Shop",
    pipelineEntry: "Shop",
    sourceFiles: ["upstream/assets/interface/tasks/shop.json", "upstream/assets/resource/en/pipeline/daily/shop.json"],
    entryConditions: ["Game is in main lobby"],
    requiredGameState: "Shop menu accessible",
    recognitionRules: ["Free daily pack / configured non-real-money items"],
    expectedResult: "Free daily shop rewards claimed",
    failureConditions: ["Real-money / premium currency purchase prompt"],
    recoveryProcedure: "Never confirm real-money purchases; stop and request user approval",
    serverCompatibility: ["en (pending live Steam verification)"],
    knownLimitations: ["Premium purchases are blocked by safety policy"],
  },
  {
    id: "events",
    name: "Event Inspection & Activities",
    pipelineEntry: "Activity",
    sourceFiles: ["upstream/assets/interface/tasks/activity.json", "upstream/assets/resource/en/pipeline/activity/activity.json"],
    entryConditions: ["Game is in main lobby"],
    requiredGameState: "Active seasonal/limited event",
    recognitionRules: ["Event banner OCR & reward indicators"],
    expectedResult: "Active event status inspected and eligible daily event rewards claimed",
    failureConditions: ["New/unseen event UI layout"],
    recoveryProcedure: "Capture screen and propose adaptive skill update (needs-review)",
    serverCompatibility: ["en (pending live Steam verification)"],
    knownLimitations: ["Limited-time events change UI frequently"],
  },
  {
    id: "tower",
    name: "Tyrant's Tower / Climb Tower",
    pipelineEntry: "ClimbTower",
    sourceFiles: [
      "upstream/assets/interface/tasks/climb_tower.json",
      "upstream/assets/resource/windows/pipeline/climb_tower/climb_tower_neural.json",
    ],
    entryConditions: ["Game is in main lobby"],
    requiredGameState: "Tower mode unlocked",
    recognitionRules: ["Neural/preset buff selection + combat status OCR"],
    expectedResult: "Tower run completed or paused cleanly on failure",
    failureConditions: ["Team wipe or missing preset"],
    recoveryProcedure: "Exit stage cleanly and record partial progress",
    serverCompatibility: ["en (pending live Steam verification)"],
    knownLimitations: ["Uses upstream Python custom/climb_tower_neural modules"],
  },
];
