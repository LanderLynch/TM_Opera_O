export type NotificationCategory =
  | "agent"
  | "task_complete"
  | "task_fail"
  | "approval"
  | "error"
  | "shelf"
  | "system";

export interface NotchNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  dismissed: boolean;
}

export class NotificationHub {
  private readonly items: NotchNotification[] = [];
  private readonly maxItems = 60;

  public push(
    category: NotificationCategory,
    title: string,
    message: string
  ): NotchNotification | null {
    // Duplicate prevention within 8 seconds for identical category+title+message
    const now = Date.now();
    const dup = this.items.find(
      (n) =>
        !n.dismissed &&
        n.category === category &&
        n.title === title &&
        n.message === message &&
        now - n.timestamp < 8000
    );
    if (dup) return null;

    const item: NotchNotification = {
      id: `ntf_${now}_${Math.random().toString(36).slice(2, 6)}`,
      category,
      title,
      message,
      timestamp: now,
      read: false,
      dismissed: false,
    };
    this.items.unshift(item);
    if (this.items.length > this.maxItems) {
      this.items.pop();
    }
    return item;
  }

  public listActive(limit = 20): NotchNotification[] {
    return this.items.filter((n) => !n.dismissed).slice(0, limit);
  }

  public unreadCount(): number {
    return this.items.filter((n) => !n.dismissed && !n.read).length;
  }

  public markRead(id?: string): void {
    for (const n of this.items) {
      if (!id || n.id === id) n.read = true;
    }
  }

  public dismiss(id: string): boolean {
    const found = this.items.find((n) => n.id === id);
    if (!found) return false;
    found.dismissed = true;
    found.read = true;
    return true;
  }
}
