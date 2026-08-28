import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandleReactionAdd } from '../src/handlers/reactionHandler.js';

function createReaction(emoji, { partial = false, message } = {}) {
    return {
        emoji: { name: emoji },
        partial,
        message,
        fetch: async function () {
            this.partial = false;
            return this;
        }
    };
}

test('reaction handler ignores bots, unrelated emoji, and messages outside a thread', async () => {
    let taken = false;
    const handle = createHandleReactionAdd({
        getGenerationByThinkingMessage: () => ({ state: 'generating' }),
        takeGenerationByThinkingMessage: () => {
            taken = true;
        }
    });

    await handle(createReaction('❌'), { bot: true, id: 'user-1' });
    await handle(createReaction('👍'), { bot: false, id: 'user-1' });
    await handle(
        createReaction('❌', { message: { id: 'message-1', channel: { isThread: () => false } } }),
        { bot: false, id: 'user-1' }
    );

    assert.equal(taken, false);
});

test('reaction handler aborts a matching active generation once', async () => {
    const controller = new AbortController();
    const entry = { state: 'generating', controller, userId: 'owner' };
    let available = entry;
    const handle = createHandleReactionAdd({
        getGenerationByThinkingMessage: () => available,
        takeGenerationByThinkingMessage: () => {
            const claimed = available;
            available = null;
            return claimed;
        }
    });
    const reaction = createReaction('❌', {
        partial: true,
        message: { id: 'thinking-1', channel: { isThread: () => true } }
    });

    await handle(reaction, { bot: false, id: 'owner' });
    await handle(reaction, { bot: false, id: 'owner' });

    assert.equal(controller.signal.aborted, true);
});

test('reaction handler regenerates for the owner and does not allow other users', async () => {
    const controller = new AbortController();
    let regenerated = 0;
    const entry = {
        state: 'completed',
        controller,
        userId: 'owner',
        regenerate: async () => {
            regenerated++;
        }
    };
    let available = entry;
    const handle = createHandleReactionAdd({
        getGenerationByThinkingMessage: () => available,
        takeGenerationByThinkingMessage: () => {
            const claimed = available;
            available = null;
            return claimed;
        }
    });
    const reaction = createReaction('🔄', {
        message: { id: 'thinking-2', channel: { isThread: () => true } }
    });

    await handle(reaction, { bot: false, id: 'other-user' });
    assert.equal(regenerated, 0);
    assert.equal(available, entry);

    await handle(reaction, { bot: false, id: 'owner' });
    assert.equal(regenerated, 1);
    assert.equal(controller.signal.aborted, false);
});
