import { Cause, Data, Effect, Fiber, Scope } from 'effect';

export type AppError = Data.TaggedEnum<{
  FileAccessError: {
    readonly operation: 'startup' | 'picker' | 'drop' | 'recent' | 'recent-list' | 'bytes';
    readonly cause: unknown;
  };
  ReaderError: { readonly operation: 'open' | 'close' | 'destroy'; readonly cause: unknown };
  PositionSaveError: { readonly id: string; readonly cause: unknown };
  PlatformError: {
    readonly operation: 'window-state' | 'window-action' | 'external-link';
    readonly cause: unknown;
  };
  InputError: { readonly message: string };
}>;
export const AppError = Data.taggedEnum<AppError>();

// Promise rejection and synchronous adapter throws enter the same typed error channel.
export const attempt = <A, E>(run: () => Promise<A>, error: (cause: unknown) => E) =>
  Effect.tryPromise({ try: run, catch: error });

export const errorCause = (error: AppError): unknown =>
  error._tag === 'InputError' ? error.message : error.cause;

// Defects are diagnostic failures, not expected file/reader errors. Keep finalizers running.
export const reportDefect = (cause: Cause.Cause<never>) =>
  Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError('Application defect', cause);

// A Promise boundary yields one microtask, rather than a timer task. Registration finishes
// before user callbacks can re-enter disposal, and same-task close can freeze queued opens.
const nextMicrotask = Effect.promise(() => Promise.resolve());

/** FIFO work whose lifetime includes completion, even after its owner stops accepting input. */
export const makeSerialWork = (scope: Scope.Scope) =>
  Effect.gen(function* () {
    const runSync = Effect.runSyncWith(yield* Effect.context<never>());
    let tail: Fiber.Fiber<void> | undefined;
    const idle: Effect.Effect<void> = Effect.gen(function* () {
      let observed: typeof tail;
      do {
        observed = tail;
        if (observed) yield* Fiber.await(observed);
      } while (observed !== tail);
    });
    return {
      idle,
      submit(task: Effect.Effect<void>): Fiber.Fiber<void> {
        const previous = tail;
        // Mutual exclusion alone permits barging at a scheduled wake-up. An explicit
        // predecessor makes completion of the tail imply completion of every earlier job.
        tail = runSync(
          Effect.forkIn(
            nextMicrotask.pipe(
              Effect.andThen(previous ? Fiber.await(previous) : Effect.void),
              Effect.andThen(task),
              Effect.catchCause(reportDefect),
            ),
            scope,
            { startImmediately: true, uninterruptible: true },
          ),
        );
        return tail;
      },
    };
  });

/** External APIs can outlive us. Interrupt their fibers, then consume late Promise outcomes. */
export const external = <A, E>(task: Effect.Effect<A, E>, scope: Scope.Scope) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkIn(task, scope, { startImmediately: true });
    return yield* Fiber.join(fiber).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.succeed(undefined) : Effect.failCause(cause),
      ),
    );
  });
