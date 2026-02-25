/**
 * Unit tests for RequestQueue
 * Run: npx jest ./tests/request-queue.test.js --testEnvironment node
 */

// We import the class directly — no server needed.
import { RequestQueue } from '../src/utils/request-queue.js';

// ------------------------------------------------------------------
// Helper: create a task that resolves after `ms` milliseconds
// ------------------------------------------------------------------
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('RequestQueue', () => {
    test('runs tasks one at a time — no overlap', async () => {
        const queue = new RequestQueue();
        const executionOrder = [];

        // Task A: takes 80 ms
        const taskA = queue.enqueue(async () => {
            executionOrder.push('A:start');
            await delay(80);
            executionOrder.push('A:end');
        });

        // Task B: enqueued immediately after A — should wait for A to finish
        const taskB = queue.enqueue(async () => {
            executionOrder.push('B:start');
            await delay(40);
            executionOrder.push('B:end');
        });

        await Promise.all([taskA, taskB]);

        // B must not start until A is completely done
        expect(executionOrder).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
    });

    test('return value propagates to the caller', async () => {
        const queue = new RequestQueue();
        const result = await queue.enqueue(async () => 42);
        expect(result).toBe(42);
    });

    test('errors propagate to the caller and queue continues', async () => {
        const queue = new RequestQueue();
        const results = [];

        // Task that throws
        const taskA = queue.enqueue(async () => {
            throw new Error('boom');
        }).catch(err => results.push(`A:${err.message}`));

        // Task that succeeds — must still run after A fails
        const taskB = queue.enqueue(async () => {
            results.push('B:ok');
            return 'done';
        });

        await Promise.all([taskA, taskB]);

        expect(results).toEqual(['A:boom', 'B:ok']);
    });

    test('getStatus reports correct counts', async () => {
        const queue = new RequestQueue();

        // Before anything
        expect(queue.getStatus()).toEqual({ activeCount: 0, queuedCount: 0 });

        let resolveA;
        const pauseA = new Promise(r => { resolveA = r; });

        // Enqueue A (will block until we call resolveA)
        const taskA = queue.enqueue(() => pauseA);
        // Enqueue B and C while A is running
        const taskB = queue.enqueue(() => delay(10));
        const taskC = queue.enqueue(() => delay(10));

        // Give the event loop a tick so A starts
        await delay(10);

        const statusWhileRunning = queue.getStatus();
        expect(statusWhileRunning.activeCount).toBe(1);
        expect(statusWhileRunning.queuedCount).toBe(2);

        // Unblock A
        resolveA();
        await Promise.all([taskA, taskB, taskC]);

        // After everything is done
        expect(queue.getStatus()).toEqual({ activeCount: 0, queuedCount: 0 });
    });

    test('handles many concurrent enqueues in FIFO order', async () => {
        const queue = new RequestQueue();
        const order = [];
        const N = 10;

        const tasks = Array.from({ length: N }, (_, i) =>
            queue.enqueue(async () => {
                order.push(i);
            })
        );

        await Promise.all(tasks);

        expect(order).toEqual(Array.from({ length: N }, (_, i) => i));
    });
});
