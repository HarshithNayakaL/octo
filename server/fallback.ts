import { ProviderError } from "./provider.js";

/**
 * Lighter Gemini models to fall back to when the chosen one is overloaded.
 * Override with GEMINI_FALLBACK_MODELS (comma-separated, in order).
 */
export const defaultFallbackModels = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];

export function fallbackModels(raw?: string) {
  const list = raw
    ?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list?.length ? list : defaultFallbackModels;
}

const busyText =
  /high demand|overloaded|currently unavailable|try again later|UNAVAILABLE|capacity|RESOURCE_EXHAUSTED/i;

/**
 * A rejection that a different model can get past: the model is overloaded
 * (503, "experiencing high demand") or its own quota is used up (429; free-tier
 * quotas are per model). Nothing was created, so trying another model is safe.
 */
export function isBusy(error: unknown): error is ProviderError {
  if (error instanceof ProviderError)
    return (
      error.status === 503 ||
      error.status === 429 ||
      (error.status >= 500 && busyText.test(error.message))
    );
  return false;
}

/** The same test for an error message on a failed background turn. */
export const isBusyMessage = (message?: string) =>
  Boolean(message && busyText.test(message));

/** A fallback that does not exist or is not accepted here: skip to the next one. */
const unusable = (error: unknown) =>
  error instanceof ProviderError && [400, 404].includes(error.status);

/** The models to try, starting with the chosen one, without repeats. */
export function modelChain(primary: string, fallbacks: string[]) {
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

/** The next model after `current` in the chain, if any. */
export function nextModel(
  current: string,
  primary: string,
  fallbacks: string[],
) {
  const chain = modelChain(primary, fallbacks);
  const index = chain.indexOf(current);
  return index === -1 ? chain[1] : chain[index + 1];
}

export interface Fallback {
  from: string;
  to: string;
  reason: string;
}

/**
 * Run `attempt` with the chosen model; if it is busy, try each fallback in turn.
 * Returns the value and, when a fallback was used, which one and why. If every
 * model fails, the original error is thrown so existing backoff still applies.
 */
export async function withFallback<T>(
  primary: string,
  fallbacks: string[],
  attempt: (model: string) => Promise<T>,
): Promise<{ value: T; model: string; fallback?: Fallback }> {
  try {
    return { value: await attempt(primary), model: primary };
  } catch (first) {
    if (!isBusy(first)) throw first;
    for (const model of modelChain(primary, fallbacks).slice(1)) {
      try {
        return {
          value: await attempt(model),
          model,
          fallback: {
            from: primary,
            to: model,
            reason: first instanceof Error ? first.message : "busy",
          },
        };
      } catch (error) {
        if (!isBusy(error) && !unusable(error)) throw error;
      }
    }
    throw first;
  }
}

/**
 * After a background turn fails because `current` is busy, the next model to
 * use: the first fallback, or the one after `current` if it already is one.
 * Undefined when every fallback has been tried.
 */
export function afterBusy(current: string | undefined, fallbacks: string[]) {
  const index = current ? fallbacks.indexOf(current) : -1;
  return fallbacks[index + 1];
}
