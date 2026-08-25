// @ts-check

/**
 * Client for the BKT service (services/ml).
 *
 * The policy lives in Python and is called over HTTP rather than reimplemented
 * here. A second copy of the model in JavaScript would be two sources of truth for
 * the numbers the dissertation reports, and the two would drift -- silently, since
 * both would keep returning plausible mastery values.
 *
 * The transport is injectable so routes can be tested against a fake without a
 * running Python service.
 */

/**
 * @typedef {object} Recommendation
 * @property {string} challengeId
 * @property {string} skill
 * @property {number} pMastery
 * @property {"bkt-adaptive"|"linear-fallback"} policy
 * @property {string} reason
 */

/**
 * @typedef {object} MlClient
 * @property {(subjectId: string, opts?: { signal?: AbortSignal }) => Promise<Recommendation|null>} recommend
 */

export class MlServiceError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status) {
    super(message);
    this.name = "MlServiceError";
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 2500;

/**
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [config]
 * @returns {MlClient}
 */
export function createMlClient(config = {}) {
  const baseUrl = config.baseUrl ?? process.env.ML_SERVICE_URL;
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async recommend(subjectId) {
      if (!baseUrl) throw new MlServiceError("ML_SERVICE_URL is not set");

      // The caller is a serverless function with a hard time limit. Without an
      // explicit timeout a slow ML service becomes a hung request rather than a
      // handled failure.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await doFetch(
          `${baseUrl.replace(/\/$/, "")}/recommend/${encodeURIComponent(subjectId)}`,
          { signal: controller.signal }
        );

        // No content left to serve is a real answer, not an error.
        if (res.status === 204) return null;
        if (!res.ok) {
          throw new MlServiceError(`ML service returned ${res.status}`, res.status);
        }

        const body = await res.json();
        return {
          challengeId: body.challenge_id,
          skill: body.skill,
          pMastery: body.p_mastery,
          policy: body.policy,
          reason: body.reason
        };
      } catch (err) {
        if (err instanceof MlServiceError) throw err;
        const cause = /** @type {Error} */ (err);
        if (cause.name === "AbortError") {
          throw new MlServiceError(`ML service did not respond within ${timeoutMs}ms`);
        }
        throw new MlServiceError(`ML service unreachable: ${cause.message}`);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
