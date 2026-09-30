/**
 * Core sampling logic for Log Sample.
 *
 * The sampler keeps the first `head` lines and the last `tail` lines of a
 * stream, and discards everything in between, recording only the count of
 * omitted lines. This gives a reader enough context to see how a log begins
 * and how it ends without holding the entire log in memory.
 *
 * Lines are buffered in a plain Array. We deliberately do not use a
 * ring-buffer here: JavaScript arrays splice cheaply for these sizes, and the
 * code is much easier to follow. If head or tail grow into the tens of
 * thousands, callers should reconsider whether sampling is the right tool.
 */

/**
 * @typedef {Object} SamplerOptions
 * @property {number} [head]      Number of leading lines to retain. Defaults to 10.
 * @property {number} [tail]      Number of trailing lines to retain. Defaults to 10.
 * @property {string} [marker]    Text inserted where lines were dropped.
 *                               An empty string disables the marker entirely.
 * @property {number} [markerIf]  Minimum omitted count required before the marker
 *                               is inserted. Defaults to 1, so even a single
 *                               dropped line produces a marker. Set to 0 to
 *                               always insert when any lines are dropped, or to
 *                               a large number to suppress markers for small gaps.
 */

/**
 * Default values applied when an option is absent or not a finite, non-negative number.
 * Centralising them here keeps the constructor and `toLines` consistent.
 */
export const DEFAULTS = Object.freeze({
  head: 10,
  tail: 10,
  marker: '... N lines omitted ...',
  markerIf: 1,
});

/**
 * Returns `value` if it is a finite, non-negative number, otherwise `fallback`.
 * Used for option normalisation so callers can pass `undefined`, `null`, a
 * string, or `NaN` without us coercing it into something surprising.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function clampNonNegativeInt(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeMarker(value) {
  return typeof value === 'string' ? value : DEFAULTS.marker;
}

export class LogSampler {
  /** @type {string[]} */  #head;
  /** @type {string[]} */  #tail;
  /** @type {number} */   #omitted;
  /** @type {number} */   #headSize;
  /** @type {number} */   #tailSize;
  /** @type {string} */   #marker;
  /** @type {number} */   #markerIf;

  /**
   * @param {SamplerOptions} [options]
   */
  constructor(options = {}) {
    this.#headSize = clampNonNegativeInt(options.head, DEFAULTS.head);
    this.#tailSize = clampNonNegativeInt(options.tail, DEFAULTS.tail);
    this.#marker    = normalizeMarker(options.marker);
    this.#markerIf  = clampNonNegativeInt(options.markerIf, DEFAULTS.markerIf);

    this.#head    = [];
    this.#tail    = [];
    this.#omitted = 0;
  }

  /**
   * Appends a single line to the sampler.
   *
   * The line is stored verbatim; callers are responsible for any newline
   * trimming. We treat whatever string is passed as exactly one line so that
   * `add` can be called in a tight loop over `data.split('\n')`.
   *
   * @param {string} line
   * @returns {void}
   */
  add(line) {
    if (typeof line !== 'string') {
      throw new TypeError(`LogSampler.add expects a string, got ${typeof line}`);
    }

    if (this.#head.length < this.#headSize) {
      this.#head.push(line);
      return;
    }

    // Once the head is full, every subsequent line competes for a tail slot.
    // We keep a running tail buffer of size #tailSize and count the overflow
    // as omitted lines. This is O(1) amortised per push: only when the tail
    // overflows do we drop one entry, and only when #tailSize is zero do we
    // increment #omitted on every call.
    if (this.#tailSize === 0) {
      this.#omitted += 1;
      return;
    }

    this.#tail.push(line);
    if (this.#tail.length > this.#tailSize) {
      this.#tail.shift();
      this.#omitted += 1;
    }
  }

  /**
   * Appends every line in an iterable. Convenient for feeding a pre-split
   * array without writing an explicit loop at each call site.
   *
   * @param {Iterable<string>} lines
   * @returns {void}
   */
  addMany(lines) {
    if (lines == null || typeof lines[Symbol.iterator] !== 'function') {
      throw new TypeError('LogSampler.addMany expects an iterable of strings');
    }
    for (const line of lines) {
      this.add(line);
    }
  }

  /** @returns {number} */
  get headSize() { return this.#headSize; }

  /** @returns {number} */
  get tailSize() { return this.#tailSize; }

  /**
   * Lines retained verbatim at the front of the log, in arrival order.
   * @returns {string[]}
   */
  get head() { return this.#head.slice(); }

  /**
   * Lines retained verbatim at the back of the log, in arrival order.
   * @returns {string[]}
   */
  get tail() { return this.#tail.slice(); }

  /**
   * Count of lines received but discarded.
   * @returns {number}
   */
  get omitted() { return this.#omitted; }

  /**
   * Total number of lines seen via `add` / `addMany`.
   * @returns {number}
   */
  get totalSeen() { return this.#head.length + this.#omitted + this.#tail.length; }

  /**
   * Produces the sampled output as an array of lines, inserting the marker
   * text where lines were dropped (subject to `markerIf`).
   *
   * @returns {string[]}
   */
  toLines() {
    const result = this.#head.slice();
    if (this.#marker !== '' && this.#omitted >= this.#markerIf) {
      result.push(this.#marker);
    }
    for (const l of this.#tail) {
      result.push(l);
    }
    return result;
  }

  /**
   * Convenience wrapper around `toLines`. Joins with `\n`; no trailing newline,
   * because the caller usually wants to control that when writing to a file or
   * stdout. An empty sampler yields the empty string rather than a bare
   * newline, which keeps downstream `console.log` output clean.
   *
   * @returns {string}
   */
  toString() {
    return this.toLines().join('\n');
  }

  /**
   * Resets the sampler to a fresh state, preserving the options it was
   * constructed with. Cheaper than allocating a new instance when the same
   * configuration is reused across many logs.
   *
   * @returns {void}
   */
  reset() {
    this.#head.length = 0;
    this.#tail.length = 0;
    this.#omitted = 0;
  }
}
