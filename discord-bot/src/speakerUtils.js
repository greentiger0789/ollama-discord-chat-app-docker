const FALLBACK_SPEAKER_NAME = 'ユーザー';
const MAX_SPEAKER_NAME_LENGTH = 32;

export function sanitizeSpeakerName(name) {
    const normalized = String(name ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replaceAll('【', '(')
        .replaceAll('】', ')')
        .trim();

    return Array.from(normalized).slice(0, MAX_SPEAKER_NAME_LENGTH).join('');
}

export function resolveSpeakerName(message) {
    const name =
        message?.member?.displayName ??
        message?.author?.globalName ??
        message?.author?.username ??
        message?.user?.globalName ??
        message?.user?.username;

    return sanitizeSpeakerName(name) || FALLBACK_SPEAKER_NAME;
}

export function isMultiUserHistory(history = []) {
    const speakers = new Set(
        history
            .filter(entry => entry.role === 'user' && entry.speaker)
            .map(entry => sanitizeSpeakerName(entry.speaker))
            .filter(Boolean)
    );

    return speakers.size > 1;
}

export function formatEntryForLlm(entry, multiUser) {
    const role = entry.role === 'user' ? 'user' : 'assistant';
    const speaker = sanitizeSpeakerName(entry.speaker);

    if (!multiUser || role !== 'user' || !speaker) {
        return { role, content: entry.text };
    }

    return { role: 'user', content: `【${speaker}】${entry.text}` };
}
