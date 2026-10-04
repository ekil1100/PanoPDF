import { Effect } from 'effect';
import { describe, expect, it } from 'vite-plus/test';
import { AppError, attempt } from '../src/app-effects';

describe('typed adapter errors', () => {
  it.each(['throw', 'reject'] as const)(
    'converts an adapter %s into its tagged error with the original cause',
    async (mode) => {
      const cause = new Error('Permission denied');
      const task = attempt(
        () => {
          if (mode === 'throw') throw cause;
          return Promise.reject(cause);
        },
        (error) => AppError.FileAccessError({ operation: 'picker', cause: error }),
      );
      const result = await Effect.runPromise(
        task.pipe(Effect.catchTag('FileAccessError', (error) => Effect.succeed(error))),
      );
      expect(result).toEqual({ _tag: 'FileAccessError', operation: 'picker', cause });
    },
  );

  it('retains save identity in the error channel and allows typed recovery', async () => {
    const cause = new Error('Disk unavailable');
    const result = await Effect.runPromise(
      attempt(
        () => Promise.reject(cause),
        (error) => AppError.PositionSaveError({ id: 'document-A', cause: error }),
      ).pipe(Effect.catchTag('PositionSaveError', ({ id }) => Effect.succeed(id))),
    );
    expect(result).toBe('document-A');
  });
});
