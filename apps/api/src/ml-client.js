// @ts-check

/**
 * Client for the BKT service (services/ml).
 *
 * The policy lives in Python and is called over HTTP rather than reimplemented
 * here. A second copy of the model in JavaScript would be two sources of truth for
 * the numbers the dissertation reports, and the two would drift -- silently, since
 * both would keep returning plausible mastery values.
 *
 * The service is stateless: it holds no database and no session. This side owns the
 * event log, so it sends the learner's state with each call. The alternative --
 * giving the ML service its own database connection -- would mean two components
 * reading the same log with two implementations of "which attempts count".
 *
 * The transport is injectable so routes can be tested without a running service.
 */

/**
 * @typedef {object} LearnerState
 * @property {{ skill: string, correct: boolean }[]} observations
 *   Ordered, and already filtered to unaided first attempts. A learner shown the
 *   answer has demonstrated nothing, so including hint-assisted successes would
 *   inflate every mastery estimate.
 * @property {{ challenge_id: string, skill: string, mastery_required?: number,
 *              is_drill?: boolean, is_boss?: boolean, requires?: string|null }[]} candidates
 * @property {string[]} cleared
 * @property {string[]} unlocked
 *   Nodes already opened. Unlocking latches, so omitting this makes the tree
 *   appear to close again whenever mastery dips.
 */

/**
 * @typedef {object} Recommendation
 * @property {string} challengeId
 * @property {string} skill
 * @property {number} pMastery
 * @property {"bkt-adaptive"|"linear-fallback"} policy
 * @property {string} reason
 * @property {Record<string, number>} mastery
 * @property {string[]} unlocked
 * @property {boolean} capstoneUnlocked
 */

/**
 * @typedef {object} MlClient
 * @property {(state: LearnerState) => Promise<Recommendation|null>} recommend
 * @property {(state: LearnerState) => Promise<{ mastery: Record<string, number>,
 *            unlocked: string[], capstoneUnlocked: boolean }>} mastery
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

  /**
   * @param {string} path
   * @param {LearnerState} state
   * @returns {Promise<any|null>} null on 204
   */
  async function post(path, state) {
    if (!baseUrl) throw new MlServiceError("ML_SERVICE_URL is not set");

    // The caller is a serverless function with a hard time limit. Without an
    // explicit timeout a slow ML service becomes a hung request rather than a
    // handled failure.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await doFetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state),
        signal: controller.signal
      });

      // No content left to serve is a real answer, not an error.
      if (res.status === 204) return null;
      if (!res.ok) throw new MlServiceError(`ML service returned ${res.status}`, res.status);
      return await res.json();
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

  return {
    async recommend(state) {
      const body = await post("/recommend", state);
      if (!body) return null;
      return {
        challengeId: body.challenge_id,
        skill: body.skill,
        pMastery: body.p_mastery,
        policy: body.policy,
        reason: body.reason,
        mastery: body.mastery ?? {},
        unlocked: body.unlocked ?? [],
        capstoneUnlocked: !!body.capstone_unlocked
      };
    },

    async mastery(state) {
      const body = await post("/mastery", state);
      if (!body) throw new MlServiceError("ML service returned no body for /mastery");
      return {
        mastery: body.mastery ?? {},
        unlocked: body.unlocked ?? [],
        capstoneUnlocked: !!body.capstone_unlocked
      };
    }
  };
}
