import { ApplicationAdapter } from "./applicationTypes";

export class ApplicationRegistry {
  private readonly adapters = new Map<string, ApplicationAdapter>();

  public register(adapter: ApplicationAdapter): void {
    this.adapters.set(adapter.id.toLowerCase(), adapter);
  }

  public get(id: string): ApplicationAdapter | undefined {
    return this.adapters.get(id.toLowerCase());
  }

  public list(): ApplicationAdapter[] {
    return Array.from(this.adapters.values());
  }
}
