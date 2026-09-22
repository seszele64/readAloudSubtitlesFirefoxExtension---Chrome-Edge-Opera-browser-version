// URL-navigation poll, extracted verbatim from src/content/entry.js (S12).
// checkSubtitle() re-schedules itself every 500 ms, compares location.href
// against the last seen URL, and drives the subtitle GUI on watch pages:
// getSubtitleList() (still owned by entry.js, injected below) when the
// containers can be inserted (canInsert(), also entry.js-owned).
//
// The poll also clears the TTS subtitle-sync interval on navigation so the
// previous video's sync loop stops. That handle must be readable from here
// and writable from entry.js, so it lives as a single shared binding owned
// by this module: entry.js writes it through setTtsIntervalId() and reads
// the live imported `intervalId` binding. clearInterval semantics are
// unchanged.
//
// entry.js calls startNavigationPolling() exactly once, at the same
// top-level lifecycle point where the bare checkSubtitle() call used to
// run. This call is the seam S23 will gate behind store-ready.

// TTS subtitle-sync interval handle (see header note). Exported as a live
// binding so entry.js reads (clearInterval(intervalId)) keep working.
export let intervalId

// Poll collaborators, injected once by startNavigationPolling() before the
// first tick; the loop body below stays byte-identical to the pre-extraction
// code.
let canInsert
let getSubtitleList

/**
 * Registers the TTS subtitle-sync interval handle created in entry.js
 * (selectCaptionFileForTTS) so the poll can clear it on navigation.
 * @param {Number|undefined} newIntervalId setInterval handle
 */
export function setTtsIntervalId (newIntervalId) {
  intervalId = newIntervalId
}

let currentUrl = ''

/**
* Get parameter value from URL.
* @param {String} param Parameter name
* @return {String} Parameter value
*/
const getParameter = param => {
  const urlParams = new URLSearchParams(window.location.search)
  return urlParams.get(param)
}

/**
 * @return {String}
 */
const extractVideoId = () => {
  return getParameter('v')
}

/**
  * This function will be called periodically.
  * Check if the URL has changed.
  */
const checkSubtitle = () => {
  const newUrl = location.href
  if (currentUrl !== newUrl) {
    clearInterval(intervalId);
    const videoId = extractVideoId();
    if (videoId && canInsert()) {
      currentUrl = newUrl;
      getSubtitleList(videoId);
    } else if (videoId && !canInsert()) {
      //console.log('Cannot insert (yet)');
    } else {
      // If it's an address but not a viewing, there's no video, stop it
      currentUrl = newUrl;
    }
  }

  // Call periodically again
  setTimeout(checkSubtitle, 500)
}

/**
 * Starts the URL poll (500 ms cadence, verbatim pre-extraction behavior).
 * @param {Object} deps entry.js-owned collaborators
 * @param {Function} deps.canInsert GUI-insertion check (owns insertPosition)
 * @param {Function} deps.getSubtitleList fetches tracks and builds the GUI
 */
export function startNavigationPolling (deps) {
  canInsert = deps.canInsert
  getSubtitleList = deps.getSubtitleList
  checkSubtitle()
}
