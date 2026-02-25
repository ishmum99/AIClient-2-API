import logger from './logger.js';

/**
 * A simple FIFO queue that runs async tasks one at a time.
 * Any number of tasks can be enqueued; each waits for the previous to finish
 * before starting. Works for both streaming and non-streaming handlers because
 * it awaits the full resolution of each task's Promise.
 */
export class RequestQueue {
    constructor() {
        /** @type {number} Number of tasks currently executing (0 or 1) */
        this._active = 0;
        /** @type {Array<{fn: Function, resolve: Function, reject: Function}>} */
        this._queue = [];
    }

    /**
     * Enqueue an async task. Returns a Promise that resolves/rejects with the
     * value returned/thrown by `fn`.
     *
     * @template T
     * @param {() => Promise<T>} fn  An async (or Promise-returning) function to execute.
     * @returns {Promise<T>}
     */
    enqueue(fn) {
        return new Promise((resolve, reject) => {
            this._queue.push({ fn, resolve, reject });
            this._tryNext();
        });
    }

    /**
     * Returns the current queue state — useful for the /queue_status endpoint.
     * @returns {{ activeCount: number, queuedCount: number }}
     */
    getStatus() {
        return {
            activeCount: this._active,
            queuedCount: this._queue.length,
        };
    }

    /** @private */
    _tryNext() {
        if (this._active > 0 || this._queue.length === 0) return;

        const { fn, resolve, reject } = this._queue.shift();
        this._active = 1;

        const position = this._queue.length; // how many are still waiting after this one
        logger.info(`[RequestQueue] Starting task. Remaining in queue: ${position}`);

        Promise.resolve()
            .then(() => fn())
            .then(
                (value) => {
                    this._active = 0;
                    logger.info('[RequestQueue] Task finished. Picking next.');
                    resolve(value);
                    this._tryNext();
                },
                (err) => {
                    this._active = 0;
                    logger.info(`[RequestQueue] Task failed: ${err?.message}. Picking next.`);
                    reject(err);
                    this._tryNext();
                }
            );
    }
}

/**
 * Singleton queue shared across all incoming AI API requests.
 * Import this wherever you need to serialize requests.
 */
export const globalRequestQueue = new RequestQueue();
