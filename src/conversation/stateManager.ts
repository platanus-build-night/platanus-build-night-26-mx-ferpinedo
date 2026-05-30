import type { ConversationSession, ConversationState } from "../types.js";

export class ConversationStateManager {
  private readonly sessions = new Map<string, ConversationSession>();

  getOrCreate(userId: string): ConversationSession {
    const existing = this.sessions.get(userId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const session: ConversationSession = {
      userId,
      state: "initial_message_received",
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(userId, session);
    return session;
  }

  update(userId: string, patch: Partial<Omit<ConversationSession, "userId" | "createdAt">>): ConversationSession {
    const session = this.getOrCreate(userId);
    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    return session;
  }

  setState(userId: string, state: ConversationState): ConversationSession {
    return this.update(userId, { state });
  }

  reset(userId: string): ConversationSession {
    const now = new Date().toISOString();
    const session: ConversationSession = {
      userId,
      state: "initial_message_received",
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(userId, session);
    return session;
  }

  list(): ConversationSession[] {
    return Array.from(this.sessions.values());
  }
}
