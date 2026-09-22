// POT (po-token) capture, extracted from src/content/entry.js (S13): the
// injected-probe <script> injection, the FoundPOT listener + poToken state,
// and the caption-URL '&pot=' emission.
//
// The old toggleUntilPoTokenSet() loop clicked the CC button every 2 seconds
// FOREVER (`while (poToken === null)`); it is replaced here by waitForPot(),
// a bounded + memoized wait: at most maxClickCycles click cycles (double
// CC-button toggle each, as before), each with the original 2 s poll window,
// all under a hard deadlineMs cap, and the whole attempt shared while
// pending so concurrent callers never restart the clicking. Settled
// success stays memoized; a settled-null outcome clears the memo so a
// later caller (e.g. a CC button that hydrated after document_end) can
// start a fresh bounded attempt.
//
// When the token is still missing after the bounded wait, buildCaptionUrl()
// omits the '&pot=' parameter entirely (the old code string-concatenated the
// null token into the URL — a param YouTube rejects) and says so via
// console.info.

// State of the po token for this insertion of the content script; set by the
// FoundPOT listener below (fired by the injected probe in src/injected/).
// Exported as a live binding (same pattern as intervalId in navigation.js):
// importers read updates, but only this module mutates it.
export let poToken = null

const CC_BUTTON_SELECTOR = '.ytp-subtitles-button' // anchor: ytp-subtitles-button
// Verbatim per-cycle wait window from the pre-extraction loop.
const CYCLE_WAIT_MS = 2000

// Bounded-wait defaults: 3 click cycles (~6 s worst case), 100 ms polls,
// 10 s hard deadline for the whole attempt.
export const POT_WAIT_DEFAULTS = { deadlineMs: 10000, pollMs: 100, maxClickCycles: 3 }

/**
 * Injects the page-context probe (src/injected/injected.js) that intercepts
 * caption XHRs and dispatches FoundPOT. Extracted verbatim from entry.js.
 */
export function injectPotProbe () {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = () => {
    console.log('[Content Script] inject.js loaded into page');
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

/**
 * Registers the single FoundPOT listener that stores the captured token.
 * Extracted verbatim from entry.js; must be called exactly once (entry.js
 * does, at the same top-level lifecycle point where the bare listener used
 * to live).
 */
export function startPotCapture () {
  window.addEventListener('FoundPOT', (event) => {
    poToken = /** @type {CustomEvent} */(event).detail;
    console.log('[Content Script] POT value:', poToken);
  });
}

// Memoized bounded attempt: shared by concurrent callers while it is
// pending (the CC toggling never restarts concurrently). Settled success
// remains memoized; a settled-null outcome resets it post-settle (see the
// continuation below) so late-hydrated CC buttons are retried.
let potWaitPromise = null

/**
 * Waits for the po token, bounded and memoized. While waiting, toggles the
 * CC button (double click per cycle, as before) to provoke the caption XHR
 * that carries the token.
 * @param {Object} [options]
 * @param {Number} [options.deadlineMs] hard cap for the whole wait (ms)
 * @param {Number} [options.pollMs] poll interval while a cycle window is open
 * @param {Number} [options.maxClickCycles] maximum number of CC-toggle cycles
 * @return {Promise<String|null>} the captured token, or null when it did not
 *   arrive within the bounds
 */
export function waitForPot ({ deadlineMs = POT_WAIT_DEFAULTS.deadlineMs, pollMs = POT_WAIT_DEFAULTS.pollMs, maxClickCycles = POT_WAIT_DEFAULTS.maxClickCycles } = {}) {
  if (potWaitPromise !== null) {
    return potWaitPromise;
  }

  potWaitPromise = (async () => {
    const captionsButton = document.querySelector(CC_BUTTON_SELECTOR);
    // Same early give-up as the pre-extraction loop when there is no CC
    // button to toggle (nothing can provoke the token XHR).
    if (!captionsButton) return poToken;

    const deadline = Date.now() + deadlineMs;
    // Bounded: no cycle runs past maxClickCycles, no poll loop runs past
    // CYCLE_WAIT_MS, and everything stops at the overall deadline.
    for (let cycle = 0; cycle < maxClickCycles && poToken === null; cycle++) {
      captionsButton.click();
      captionsButton.click(); // Toggle captions back to avoid annoying the user

      const cycleStart = Date.now();
      // Wait up to CYCLE_WAIT_MS, checking every pollMs if poToken is set
      while (poToken === null && Date.now() - cycleStart < CYCLE_WAIT_MS && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, pollMs));
      }
    }
    return poToken;
  })();

  // Post-settle continuation: memoize only while pending and across a
  // settled success. When the attempt settled with no token (CC button
  // missing or bounds exhausted) and poToken is still null, clear the memo
  // so the next caller starts a fresh bounded attempt. Runs strictly after
  // settle, so concurrent callers during the attempt still share it.
  potWaitPromise.then(
    (token) => {
      if (token === null && poToken === null) potWaitPromise = null;
    },
    () => {
      if (poToken === null) potWaitPromise = null;
    }
  );

  return potWaitPromise;
}

/**
 * Builds the caption fetch URL for a track's baseUrl: appends &pot=<token>
 * (once the token has been captured) and &c=WEB. When the token is still
 * missing, waits for it within bounds, then omits &pot= entirely.
 * @param {String} baseUrl the track.baseUrl to append to
 * @return {Promise<String>} the URL to fetch captions from
 */
export async function buildCaptionUrl (baseUrl) {
  if (!poToken) {
    // If poToken is not set for this insertion of content script, wait until
    // it is set (bounded + memoized; never the unbounded loop again)
    await waitForPot();
  }

  if (!poToken) {
    // Still missing after the bounded wait: omit &pot= entirely instead of
    // string-concatenating a null token into the URL.
    console.info('[Content Script] poToken unavailable; building caption URL without &pot=');
    return baseUrl + '&c=WEB';
  }

  return baseUrl + '&pot=' + poToken + '&c=WEB';
}