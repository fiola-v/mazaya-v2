import { MazayaSession } from '../types/mazaya';

const sessions = new Map<string, MazayaSession>();

export function getSessionKey(chatId: number | string, userId: number | string): string {
  return `${chatId}:${userId}`;
}

export function startCommandCenterSession(key: string): MazayaSession {
  const now = new Date().toISOString();
  const session: MazayaSession = {
    scope: 'command_center',
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(key, session);
  return session;
}

export function getSession(key: string): MazayaSession | undefined {
  return sessions.get(key);
}

export function clearSession(key: string): void {
  sessions.delete(key);
}
