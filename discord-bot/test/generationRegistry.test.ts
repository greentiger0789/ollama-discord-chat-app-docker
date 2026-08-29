import assert from 'node:assert/strict';
import test from 'node:test';
import { freshImport } from '../testing/fakes.ts';

type GenerationRegistryModule = typeof import('../src/generationRegistry.ts');

async function importFreshRegistry(): Promise<GenerationRegistryModule> {
    const modulePath = new URL('../src/generationRegistry.ts', import.meta.url);
    return await freshImport<GenerationRegistryModule>(modulePath);
}

test('generationRegistry registers, completes, cancels, and replaces generations safely', async () => {
    const registry = await importFreshRegistry();
    const firstController = new AbortController();
    const first = registry.registerGeneration('thread-1', {
        controller: firstController,
        thinkingMsg: { id: 'thinking-1' }
    });

    assert.equal(registry.getGenerationByThread('thread-1'), first);
    assert.equal(registry.getGenerationByThinkingMessage('thinking-1'), first);

    registry.completeGeneration('thread-1', first);
    assert.equal(registry.cancelGeneration('thread-1'), null);
    assert.equal(firstController.signal.aborted, false);

    const secondController = new AbortController();
    const second = registry.registerGeneration('thread-1', {
        controller: secondController,
        thinkingMsg: { id: 'thinking-2' }
    });
    assert.equal(registry.getGenerationByThinkingMessage('thinking-1'), null);
    assert.equal(registry.takeGenerationByThinkingMessage('thinking-2'), second);
    assert.equal(registry.getGenerationByThread('thread-1'), null);
});

test('generationRegistry aborts only an active generation', async () => {
    const registry = await importFreshRegistry();
    const controller = new AbortController();
    const entry = registry.registerGeneration('thread-2', {
        controller,
        thinkingMsg: { id: 'thinking-3' }
    });

    assert.equal(registry.cancelGeneration('thread-2'), entry);
    assert.equal(controller.signal.aborted, true);
    assert.equal(registry.cancelGeneration('thread-2'), null);
});
