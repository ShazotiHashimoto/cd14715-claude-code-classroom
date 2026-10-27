import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes, ReviewError, withRetry, withTimeout } from '../src/utils/error-handler';
import { RateLimiter } from '../src/utils/rate-limiter';


describe('withRetry', () => {
  it('returns successfully on the first call', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and succeeds after transient failures', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('done');

    await expect(withRetry(fn, 3, 1)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws ReviewError after retries are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(withRetry(fn, 2, 1)).rejects.toMatchObject({
      code: ErrorCodes.RETRY_EXHAUSTED,
      name: 'ReviewError'
    });
  });

  it('does not retry failures marked as non-transient', async () => {
    const error = new ReviewError('invalid structured output', ErrorCodes.VALIDATION_FAILED);
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, 3, 1, () => false)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  it('returns the result before the timeout', async () => {
    const result = await withTimeout(async () => 'done', 30);
    expect(result).toBe('done');
  });

  it('rejects with AGENT_TIMEOUT when the operation exceeds the limit', async () => {
    await expect(
      withTimeout(
        () => new Promise((resolve) => setTimeout(() => resolve('late'), 50)),
        10,
        'slow operation'
      )
    ).rejects.toMatchObject({
      code: ErrorCodes.AGENT_TIMEOUT,
      name: 'ReviewError'
    });
  });
});

describe('RateLimiter', () => {
  it('blocks requests when the request window is exhausted', () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 2,
      maxTokensPerMinute: 2000,
      maxConcurrent: 2
    });

    limiter['requestHistory'] = [
      { timestamp: Date.now(), tokens: 1000 },
      { timestamp: Date.now(), tokens: 1000 }
    ];

    expect(limiter.canProceed(10)).toBe(false);
  });

  it('prunes stale requests from the sliding window', () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 2000, maxConcurrent: 2 });
    const now = Date.now();
    limiter['requestHistory'] = [
      { timestamp: now - 70000, tokens: 100 },
      { timestamp: now - 1000, tokens: 200 }
    ];

    limiter['pruneOldRecords']();
    expect(limiter['requestHistory']).toHaveLength(1);
  });

  it('releases a slot after acquire and release', async () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 100,
      maxTokensPerMinute: 50000,
      maxConcurrent: 1
    });

    await limiter.acquire(100);
    expect(limiter.getStatus().activeRequests).toBe(1);

    limiter.release();
    expect(limiter.getStatus().activeRequests).toBe(0);
  });

  it('keeps concurrent acquisitions within the configured limit', async () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 100,
      maxTokensPerMinute: 50000,
      maxConcurrent: 1
    });

    await limiter.acquire(100);
    let secondRequestAcquired = false;
    const secondRequest = limiter.acquire(100).then(() => {
      secondRequestAcquired = true;
    });

    await Promise.resolve();
    expect(secondRequestAcquired).toBe(false);
    expect(limiter.getStatus().activeRequests).toBe(1);

    limiter.release();
    await secondRequest;
    expect(secondRequestAcquired).toBe(true);
    expect(limiter.getStatus().activeRequests).toBe(1);
    limiter.release();
  });
});

describe('CodeReviewOrchestrator', () => {
  it('initializes with default options', async () => {
    const { CodeReviewOrchestrator } = await import('../src/orchestrator');
    const orchestrator = new CodeReviewOrchestrator();
    expect(orchestrator).toBeInstanceOf(CodeReviewOrchestrator);
  });
});
