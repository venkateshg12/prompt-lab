import { RedisCircuitBreaker } from "../utils/rateLimiter/circuitBreaker";
import { BREAKER } from "../constants/llm";
import { logger } from "../utils/logger";
import { CircuitState } from "../types/rateLimiter.types";

const breakers = new Map<string, RedisCircuitBreaker>();

export const breakerFor = (model: string): RedisCircuitBreaker => {
  let breaker = breakers.get(model);
  if (!breaker) {
    breaker = new RedisCircuitBreaker(BREAKER, (from, to) =>
      logger.warn({ model, from, to }, "llm circuit state change")
    );
    breakers.set(model, breaker);
  }
  return breaker;
};

export const breakerStates = (): Record<string, CircuitState> =>
  Object.fromEntries([...breakers].map(([m, b]) => [m, b.getState()]));

export const resetBreakers = (): void => {
  breakers.clear();
};
