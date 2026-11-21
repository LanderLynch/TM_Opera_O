import { ApplicationRegistry } from "./applicationRegistry";
import { ApplicationAdapter } from "./applicationTypes";
import { BrowserAdapter } from "./adapters/browser/browserAdapter";
import { DiscordAdapter } from "./adapters/discord/discordAdapter";
import { WordAdapter } from "./adapters/office/wordAdapter";
import { UniversalAdapter } from "./adapters/universal/universalAdapter";
import { WhatsAppAdapter } from "./adapters/whatsapp/whatsappAdapter";

export class ApplicationManager {
  public readonly registry = new ApplicationRegistry();

  constructor(searchWebFn?: (q: string) => Promise<string>) {
    this.registry.register(new DiscordAdapter());
    this.registry.register(new WhatsAppAdapter());
    this.registry.register(new BrowserAdapter(searchWebFn));
    this.registry.register(new WordAdapter());
  }

  public resolveAdapter(appNameOrId: string): ApplicationAdapter {
    const key = appNameOrId.toLowerCase().trim();
    if (key.includes("discord")) return this.registry.get("discord")!;
    if (key.includes("whatsapp") || key === "wa") return this.registry.get("whatsapp")!;
    if (key.includes("chrome") || key.includes("browser") || key.includes("edge")) {
      return this.registry.get("chrome")!;
    }
    if (key.includes("word") || key.includes("winword")) return this.registry.get("word")!;
    return new UniversalAdapter(appNameOrId);
  }
}
