import assert from 'node:assert/strict';

export interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
    reject(reason?: unknown): void;
}

export function createDeferred<T = void>(): Deferred<T> {
    let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
    let reject: ((reason?: unknown) => void) | undefined;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    if (!resolve || !reject) {
        throw new Error('Promise executor did not initialize deferred controls.');
    }

    return { promise, resolve, reject };
}

export async function freshImport<T>(moduleUrl: URL): Promise<T> {
    // The query changes module identity only; callers supply the type of the same static module URL.
    return (await import(`${moduleUrl.href}?t=${Date.now()}-${Math.random()}`)) as T;
}

export function assertDefined<T>(value: T): asserts value is NonNullable<T> {
    assert.notEqual(value, null);
    assert.notEqual(value, undefined);
}

export function assertRecord(value: unknown): asserts value is Record<string, unknown> {
    assert.equal(typeof value, 'object');
    assert.notEqual(value, null);
    assert.equal(Array.isArray(value), false);
}
