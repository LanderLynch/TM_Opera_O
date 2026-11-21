import { execFile } from "child_process";

export interface UIElementSummary {
  name: string;
  controlType: string;
  automationId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function runPs(script: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) resolve("");
        else resolve((stdout || "").trim());
      }
    );
  });
}

export async function inspectWindowUITree(
  windowTitleQuery: string,
  maxElements = 45
): Promise<UIElementSummary[]> {
  const payloadB64 = Buffer.from(windowTitleQuery, "utf-8").toString("base64");
  const ps = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$q = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payloadB64}')).ToLower()
$root = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$targetWin = $null
foreach ($w in $wins) {
  $nm = [string]$w.Current.Name
  if ($nm -and $nm.ToLower().Contains($q) -and $nm -notmatch 'TM Opera O|Opera iOS Notch') {
    $targetWin = $w
    break
  }
}
if (-not $targetWin) { exit 0 }

$cond = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem))
)

$items = $targetWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
$out = New-Object System.Collections.ArrayList
foreach ($el in $items) {
  if ($out.Count -ge ${maxElements}) { break }
  $rect = $el.Current.BoundingRectangle
  if ([double]::IsInfinity($rect.Width) -or $rect.Width -le 0 -or $rect.Height -le 0) { continue }
  $nm = [string]$el.Current.Name
  $aid = [string]$el.Current.AutomationId
  if (-not $nm -and -not $aid) { continue }
  [void]$out.Add([PSCustomObject]@{
    name = $nm
    controlType = [string]$el.Current.ControlType.ProgrammaticName.Replace("ControlType.", "")
    automationId = $aid
    x = [int]($rect.Left + $rect.Width / 2)
    y = [int]($rect.Top + $rect.Height / 2)
    width = [int]$rect.Width
    height = [int]$rect.Height
  })
}
$out | ConvertTo-Json -Compress
`;
  const out = await runPs(ps);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export async function invokeUIElementByName(
  windowTitleQuery: string,
  elementName: string
): Promise<{ invoked: boolean; element?: UIElementSummary; method?: string }> {
  const winB64 = Buffer.from(windowTitleQuery, "utf-8").toString("base64");
  const elB64 = Buffer.from(elementName, "utf-8").toString("base64");
  const ps = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$wq = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${winB64}')).ToLower()
$eq = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${elB64}')).ToLower()
$root = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$targetWin = $null
foreach ($w in $wins) {
  $nm = [string]$w.Current.Name
  if ($nm -and $nm.ToLower().Contains($wq) -and $nm -notmatch 'TM Opera O|Opera iOS Notch') {
    $targetWin = $w
    break
  }
}
if (-not $targetWin) { exit 0 }

$all = $targetWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $all) {
  $nm = [string]$el.Current.Name
  $aid = [string]$el.Current.AutomationId
  if (($nm -and $nm.ToLower().Contains($eq)) -or ($aid -and $aid.ToLower().Contains($eq))) {
    $rect = $el.Current.BoundingRectangle
    if ([double]::IsInfinity($rect.Width) -or $rect.Width -le 0) { continue }
    $method = "focus"
    try {
      $inv = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      if ($inv) { $inv.Invoke(); $method = "InvokePattern" }
    } catch {
      try { $el.SetFocus(); $method = "SetFocus" } catch {}
    }
    [PSCustomObject]@{
      invoked = $true
      method = $method
      element = [PSCustomObject]@{
        name = $nm
        controlType = [string]$el.Current.ControlType.ProgrammaticName.Replace("ControlType.", "")
        automationId = $aid
        x = [int]($rect.Left + $rect.Width / 2)
        y = [int]($rect.Top + $rect.Height / 2)
        width = [int]$rect.Width
        height = [int]$rect.Height
      }
    } | ConvertTo-Json -Compress
    exit 0
  }
}
`;
  const out = await runPs(ps);
  if (!out || !out.startsWith("{")) return { invoked: false };
  try {
    return JSON.parse(out);
  } catch {
    return { invoked: false };
  }
}
