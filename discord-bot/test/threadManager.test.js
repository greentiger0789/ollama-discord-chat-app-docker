import assert from "node:assert/strict";
import test, { beforeEach, describe } from "node:test";

// テストごとにモジュールを再インポートして状態をリセット
async function importFreshThreadManager() {
    const modulePath = new URL("../src/threadManager.js", import.meta.url);
    const module = await import(`${modulePath.href}?t=${Date.now()}`);
    return module;
}

describe("threadManager", () => {
    let threadManager;

    beforeEach(async () => {
        threadManager = await importFreshThreadManager();
    });

    /* ================================
       getThreadHistory テスト
    ================================ */

    describe("getThreadHistory", () => {
        test("returns empty array for non-existent thread", async () => {
            const history = threadManager.getThreadHistory("non-existent-id");
            assert.deepEqual(history, []);
        });

        test("returns history for existing thread", async () => {
            threadManager.setThreadHistory("thread-1", [
                { role: "user", text: "hello" }
            ]);
            const history = threadManager.getThreadHistory("thread-1");
            assert.deepEqual(history, [{ role: "user", text: "hello" }]);
        });
    });

    /* ================================
       setThreadHistory テスト
    ================================ */

    describe("setThreadHistory", () => {
        test("sets history for new thread", async () => {
            const history = [
                { role: "user", text: "test message" }
            ];
            threadManager.setThreadHistory("new-thread", history);
            const result = threadManager.getThreadHistory("new-thread");
            assert.deepEqual(result, history);
        });

        test("overwrites existing history", async () => {
            threadManager.setThreadHistory("thread-2", [
                { role: "user", text: "first" }
            ]);
            threadManager.setThreadHistory("thread-2", [
                { role: "user", text: "second" }
            ]);
            const result = threadManager.getThreadHistory("thread-2");
            assert.deepEqual(result, [{ role: "user", text: "second" }]);
        });
    });

    /* ================================
       addToThreadHistory テスト
    ================================ */

    describe("addToThreadHistory", () => {
        test("adds message to empty history", async () => {
            const result = threadManager.addToThreadHistory("thread-3", {
                role: "user",
                text: "new message"
            });
            assert.deepEqual(result, [{ role: "user", text: "new message" }]);
        });

        test("appends message to existing history", async () => {
            threadManager.setThreadHistory("thread-4", [
                { role: "user", text: "first" }
            ]);
            const result = threadManager.addToThreadHistory("thread-4", {
                role: "assistant",
                text: "response"
            });
            assert.deepEqual(result, [
                { role: "user", text: "first" },
                { role: "assistant", text: "response" }
            ]);
        });
    });

    /* ================================
       initializeThread テスト
    ================================ */

    describe("initializeThread", () => {
        test("creates thread with initial message", async () => {
            const history = threadManager.initializeThread("thread-5", "Hello!");
            assert.deepEqual(history, [{ role: "user", text: "Hello!" }]);
        });

        test("overwrites existing thread history", async () => {
            threadManager.setThreadHistory("thread-6", [
                { role: "user", text: "old" }
            ]);
            const history = threadManager.initializeThread("thread-6", "new");
            assert.deepEqual(history, [{ role: "user", text: "new" }]);
        });
    });

    /* ================================
       clearThreadHistory テスト
    ================================ */

    describe("clearThreadHistory", () => {
        test("removes thread history", async () => {
            threadManager.setThreadHistory("thread-7", [
                { role: "user", text: "test" }
            ]);
            threadManager.clearThreadHistory("thread-7");
            const result = threadManager.getThreadHistory("thread-7");
            assert.deepEqual(result, []);
        });

        test("does not throw for non-existent thread", async () => {
            assert.doesNotThrow(() => {
                threadManager.clearThreadHistory("non-existent");
            });
        });
    });

    /* ================================
       getAllThreadIds テスト
    ================================ */

    describe("getAllThreadIds", () => {
        test("returns empty array when no threads", async () => {
            const ids = threadManager.getAllThreadIds();
            assert.ok(Array.isArray(ids));
        });

        test("returns all thread IDs", async () => {
            threadManager.setThreadHistory("thread-a", [{ role: "user", text: "a" }]);
            threadManager.setThreadHistory("thread-b", [{ role: "user", text: "b" }]);
            const ids = threadManager.getAllThreadIds();
            assert.ok(ids.includes("thread-a"));
            assert.ok(ids.includes("thread-b"));
        });
    });
});
