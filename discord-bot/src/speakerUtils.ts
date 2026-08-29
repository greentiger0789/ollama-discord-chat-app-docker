import type { HistoryEntry } from './threadManager.ts';

const FALLBACK_SPEAKER_NAME = 'ユーザー';
const MAX_SPEAKER_NAME_LENGTH = 32;

interface SpeakerIdentity {
    displayName?: string | null;
    globalName?: string | null;
    username?: string | null;
}

export interface SpeakerSource {
    member?: SpeakerIdentity | null;
    author?: SpeakerIdentity | null;
    user?: SpeakerIdentity | null;
}

export interface LlmMessage {
    role: 'user' | 'assistant';
    content: string;
}

export function sanitizeSpeakerName(name: unknown): string {
    const normalized = String(name ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replaceAll('【', '(')
        .replaceAll('】', ')')
        .trim();

    return Array.from(normalized).slice(0, MAX_SPEAKER_NAME_LENGTH).join('');
}

export function resolveSpeakerName(message: SpeakerSource): string {
    const name =
        message?.member?.displayName ??
        message?.author?.globalName ??
        message?.author?.username ??
        message?.user?.globalName ??
        message?.user?.username;

    return sanitizeSpeakerName(name) || FALLBACK_SPEAKER_NAME;
}

export function isMultiUserHistory(history: readonly HistoryEntry[] = []): boolean {
    const speakers = new Set(
        history
            .filter(entry => entry.role === 'user' && entry.speaker)
            .map(entry => sanitizeSpeakerName(entry.speaker))
            .filter(Boolean)
    );

    return speakers.size > 1;
}

export function formatEntryForLlm(entry: HistoryEntry, multiUser: boolean): LlmMessage {
    const role = entry.role === 'user' ? 'user' : 'assistant';
    const speaker = sanitizeSpeakerName(entry.speaker);

    if (!multiUser || role !== 'user' || !speaker) {
        return { role, content: entry.text };
    }

    return { role: 'user', content: `【${speaker}】${entry.text}` };
}
