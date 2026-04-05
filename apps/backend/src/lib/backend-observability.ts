import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

type LogPayload = Record<string, unknown>;

type LoggerLike = {
  info(payload: LogPayload, message: string): void;
  warn(payload: LogPayload, message: string): void;
};

type ObservabilityConfig = {
  eventLoopStallMs: number;
  logger: LoggerLike;
  recentOperationTtlMs: number;
  sampleIntervalMs: number;
  slowOperationMs: number;
  slowRequestMs: number;
};

type RequestContext = {
  method: string;
  requestId: string;
  startedAtMs: number;
  url: string;
};

type ActiveOperation = {
  details: Record<string, unknown> | undefined;
  id: number;
  name: string;
  request: RequestContext | null;
  startedAtMs: number;
};

type RecentOperation = {
  details: Record<string, unknown> | undefined;
  durationMs: number;
  finishedAtMs: number;
  method: string | null;
  name: string;
  requestId: string | null;
  url: string | null;
};

type AnyFunction = (...args: unknown[]) => unknown;

const defaultConfig = {
  eventLoopStallMs: readPositiveIntegerEnv(
    "WALLEYBOARD_EVENT_LOOP_STALL_MS",
    200,
  ),
  recentOperationTtlMs: 5_000,
  sampleIntervalMs: readPositiveIntegerEnv(
    "WALLEYBOARD_EVENT_LOOP_SAMPLE_MS",
    1_000,
  ),
  slowOperationMs: readPositiveIntegerEnv("WALLEYBOARD_SLOW_OPERATION_MS", 150),
  slowRequestMs: readPositiveIntegerEnv("WALLEYBOARD_SLOW_REQUEST_MS", 750),
} as const satisfies Omit<ObservabilityConfig, "logger">;

class NoopLogger implements LoggerLike {
  info(): void {}
  warn(): void {}
}

class BackendObservability {
  readonly #activeOperations = new Map<number, ActiveOperation>();
  readonly #activeRequests = new Map<string, RequestContext>();
  readonly #config: ObservabilityConfig;
  readonly #requestStorage = new AsyncLocalStorage<RequestContext>();
  readonly #recentOperations: RecentOperation[] = [];
  readonly #sampleInterval: NodeJS.Timeout;
  #expectedTickAtMs: number;
  #nextOperationId = 1;

  constructor(config: ObservabilityConfig) {
    this.#config = config;
    this.#expectedTickAtMs = performance.now() + config.sampleIntervalMs;
    this.#sampleInterval = setInterval(() => {
      this.#sampleEventLoop();
    }, config.sampleIntervalMs);
    this.#sampleInterval.unref();
  }

  dispose(): void {
    clearInterval(this.#sampleInterval);
    this.#activeOperations.clear();
    this.#activeRequests.clear();
    this.#recentOperations.length = 0;
  }

  enterRequestContext(requestId: string): void {
    const request = this.#activeRequests.get(requestId);
    if (!request) {
      return;
    }

    this.#requestStorage.enterWith(request);
  }

  finishRequest(input: {
    requestId: string;
    routeUrl?: string | null;
    statusCode: number;
  }): void {
    const request = this.#activeRequests.get(input.requestId);
    if (!request) {
      return;
    }

    this.#activeRequests.delete(input.requestId);
    const durationMs = performance.now() - request.startedAtMs;
    if (durationMs < this.#config.slowRequestMs) {
      return;
    }

    this.#config.logger.warn(
      {
        durationMs: roundDuration(durationMs),
        method: request.method,
        requestId: request.requestId,
        routeUrl: input.routeUrl ?? null,
        statusCode: input.statusCode,
        url: request.url,
      },
      "Slow backend request",
    );
  }

  runOperation<T>(
    name: string,
    details: Record<string, unknown> | undefined,
    operation: () => T,
  ): T {
    const request = this.#requestStorage.getStore() ?? null;
    const activeOperation: ActiveOperation = {
      details,
      id: this.#nextOperationId,
      name,
      request,
      startedAtMs: performance.now(),
    };
    this.#nextOperationId += 1;
    this.#activeOperations.set(activeOperation.id, activeOperation);

    const finish = () => {
      this.#activeOperations.delete(activeOperation.id);
      const durationMs = performance.now() - activeOperation.startedAtMs;
      if (durationMs >= this.#config.slowOperationMs) {
        const payload = {
          details: activeOperation.details,
          durationMs: roundDuration(durationMs),
          method: activeOperation.request?.method ?? null,
          operation: activeOperation.name,
          requestId: activeOperation.request?.requestId ?? null,
          url: activeOperation.request?.url ?? null,
        };
        this.#config.logger.warn(payload, "Slow backend operation");
        this.#recordRecentOperation(activeOperation, durationMs);
        return;
      }

      if (durationMs >= Math.min(this.#config.slowOperationMs, 25)) {
        this.#recordRecentOperation(activeOperation, durationMs);
      }
    };

    try {
      const result = operation();
      if (isPromiseLike(result)) {
        return result.finally(finish) as T;
      }

      finish();
      return result;
    } catch (error) {
      finish();
      throw error;
    }
  }

  startRequest(input: {
    method: string;
    requestId: string;
    url: string;
  }): void {
    this.#activeRequests.set(input.requestId, {
      ...input,
      startedAtMs: performance.now(),
    });
  }

  #recordRecentOperation(operation: ActiveOperation, durationMs: number): void {
    const now = performance.now();
    this.#recentOperations.push({
      details: operation.details,
      durationMs: roundDuration(durationMs),
      finishedAtMs: now,
      method: operation.request?.method ?? null,
      name: operation.name,
      requestId: operation.request?.requestId ?? null,
      url: operation.request?.url ?? null,
    });

    this.#pruneRecentOperations(now);
  }

  #pruneRecentOperations(now: number): void {
    while (this.#recentOperations.length > 0) {
      const oldestOperation = this.#recentOperations[0];
      if (!oldestOperation) {
        return;
      }

      const ageMs = now - oldestOperation.finishedAtMs;
      if (ageMs <= this.#config.recentOperationTtlMs) {
        break;
      }

      this.#recentOperations.shift();
    }
  }

  #sampleEventLoop(): void {
    const now = performance.now();
    const delayMs = now - this.#expectedTickAtMs;
    this.#expectedTickAtMs = now + this.#config.sampleIntervalMs;
    this.#pruneRecentOperations(now);

    if (delayMs < this.#config.eventLoopStallMs) {
      return;
    }

    this.#config.logger.warn(
      {
        activeOperations: this.#snapshotActiveOperations(now),
        activeRequests: this.#snapshotActiveRequests(now),
        delayMs: roundDuration(delayMs),
        recentOperations: this.#snapshotRecentOperations(),
      },
      "Event loop stall detected",
    );
  }

  #snapshotActiveOperations(now: number): Record<string, unknown>[] {
    return [...this.#activeOperations.values()]
      .sort((left, right) => left.startedAtMs - right.startedAtMs)
      .slice(0, 5)
      .map((operation) => ({
        details: operation.details,
        durationMs: roundDuration(now - operation.startedAtMs),
        method: operation.request?.method ?? null,
        operation: operation.name,
        requestId: operation.request?.requestId ?? null,
        url: operation.request?.url ?? null,
      }));
  }

  #snapshotActiveRequests(now: number): Record<string, unknown>[] {
    return [...this.#activeRequests.values()]
      .sort((left, right) => left.startedAtMs - right.startedAtMs)
      .slice(0, 5)
      .map((request) => ({
        durationMs: roundDuration(now - request.startedAtMs),
        method: request.method,
        requestId: request.requestId,
        url: request.url,
      }));
  }

  #snapshotRecentOperations(): Record<string, unknown>[] {
    return this.#recentOperations.slice(-5).map((operation) => ({
      details: operation.details,
      durationMs: operation.durationMs,
      method: operation.method,
      operation: operation.name,
      requestId: operation.requestId,
      url: operation.url,
    }));
  }
}

let activeObservability: BackendObservability | null = null;

export function configureBackendObservability(
  input: Partial<Omit<ObservabilityConfig, "logger">> & {
    logger?: LoggerLike;
  } = {},
): void {
  activeObservability?.dispose();
  activeObservability = new BackendObservability({
    eventLoopStallMs: input.eventLoopStallMs ?? defaultConfig.eventLoopStallMs,
    logger: input.logger ?? new NoopLogger(),
    recentOperationTtlMs:
      input.recentOperationTtlMs ?? defaultConfig.recentOperationTtlMs,
    sampleIntervalMs: input.sampleIntervalMs ?? defaultConfig.sampleIntervalMs,
    slowOperationMs: input.slowOperationMs ?? defaultConfig.slowOperationMs,
    slowRequestMs: input.slowRequestMs ?? defaultConfig.slowRequestMs,
  });
}

export function disposeBackendObservability(): void {
  activeObservability?.dispose();
  activeObservability = null;
}

export function startObservedRequest(input: {
  method: string;
  requestId: string;
  url: string;
}): void {
  activeObservability?.startRequest(input);
}

export function enterObservedRequestContext(requestId: string): void {
  activeObservability?.enterRequestContext(requestId);
}

export function finishObservedRequest(input: {
  requestId: string;
  routeUrl?: string | null;
  statusCode: number;
}): void {
  activeObservability?.finishRequest(input);
}

export function runObservedOperation<T>(
  name: string,
  details: Record<string, unknown> | undefined,
  operation: () => T,
): T {
  if (!activeObservability) {
    return operation();
  }

  return activeObservability.runOperation(name, details, operation);
}

export function instrumentObservedMethods<
  T extends Record<string, AnyFunction>,
>(groupName: string, methods: T): T {
  const instrumented = Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      (...args: unknown[]) =>
        runObservedOperation(`${groupName}.${name}`, summarizeArgs(args), () =>
          method(...args),
        ),
    ]),
  );

  return instrumented as T;
}

export function observeNamedMethodsOnInstance<T extends object>(
  groupName: string,
  target: T,
): T {
  const wrappedMethods = new Map<PropertyKey, unknown>();

  return new Proxy(target, {
    get(originalTarget, property, receiver) {
      const value = Reflect.get(originalTarget, property, receiver);
      if (typeof value !== "function" || property === "constructor") {
        return value;
      }

      const cached = wrappedMethods.get(property);
      if (cached) {
        return cached;
      }

      const boundMethod = value.bind(originalTarget) as AnyFunction;
      const wrappedMethod = (...args: unknown[]) =>
        runObservedOperation(
          `${groupName}.${String(property)}`,
          summarizeArgs(args),
          () => boundMethod(...args),
        );
      wrappedMethods.set(property, wrappedMethod);
      return wrappedMethod;
    },
  });
}

function isPromiseLike<T>(value: T): value is T & Promise<Awaited<T>> {
  return typeof value === "object" && value !== null && "finally" in value;
}

function summarizeArgs(args: unknown[]): Record<string, unknown> | undefined {
  if (args.length === 0) {
    return undefined;
  }

  const summary = Object.fromEntries(
    args
      .slice(0, 3)
      .map((value, index) => [`arg${index}`, summarizeValue(value)]),
  );

  if (args.length > 3) {
    summary.argCount = args.length;
  }

  return summary;
}

function summarizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
    };
  }

  if (typeof value !== "object") {
    return typeof value;
  }

  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of [
    "id",
    "projectId",
    "repositoryId",
    "ticketId",
    "sessionId",
    "reviewRunId",
    "draftId",
    "status",
    "reason",
  ]) {
    if (key in record) {
      summary[key] = summarizeValue(record[key]);
    }
  }

  if (Object.keys(summary).length > 0) {
    return summary;
  }

  return {
    kind: "object",
    keys: Object.keys(record).slice(0, 5),
  };
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roundDuration(value: number): number {
  return Math.round(value);
}
