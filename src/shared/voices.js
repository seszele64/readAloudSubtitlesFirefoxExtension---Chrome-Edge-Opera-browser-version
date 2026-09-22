// Single owner of the speechSynthesis voice list. Chrome populates
// getVoices() asynchronously (often long after page load), so each context
// used to race its own onvoiceschanged registration and index the initially
// empty/undefined list — a TypeError waiting to happen. Every lookup goes
// through this module and is null-safe: it never throws when the
// SpeechSynthesis API is unavailable or the list is not populated yet.

import { extractLanguageCode } from './lang.js'

// Read lazily (not once at import time) so test harnesses can stub
// globalThis.speechSynthesis after importing this module.
const getSynthesis = () => globalThis.speechSynthesis ?? null

/**
 * Current list of available TTS voices. Never null/undefined: returns an
 * empty array when the SpeechSynthesis API is unavailable or Chrome has not
 * populated the list yet.
 * @return {Array} available SpeechSynthesisVoice objects
 */
export const getVoicesList = () => getSynthesis()?.getVoices() ?? []

let waiters = [] // resolve callbacks of pending whenVoicesReady() calls
let listenerRegistered = false

// Registers (exactly once per context) the onvoiceschanged listener that
// wakes up pending whenVoicesReady() waiters as soon as the voice list
// arrives. Lazy + flag-guarded so a not-yet-stubbed API cannot lock the
// module out and no second registration is ever created.
const ensureVoicesListener = () => {
  if (listenerRegistered) return
  const synthesis = getSynthesis()
  if (!synthesis) return
  listenerRegistered = true
  synthesis.onvoiceschanged = () => {
    if (getVoicesList().length === 0) return // spurious empty notification
    const pending = waiters
    waiters = []
    for (const waiter of pending) waiter(getVoicesList())
  }
}

/**
 * Resolves with the voice list: immediately when it is already populated,
 * otherwise as soon as onvoiceschanged delivers it, or after timeoutMs
 * (whichever comes first) with whatever the list holds at that point.
 * @param {number} timeoutMs how long to wait for voices (default 2000 ms)
 * @return {Promise<Array>} the (possibly empty) voice list
 */
export const whenVoicesReady = (timeoutMs = 2000) => {
  const initial = getVoicesList()
  if (initial.length > 0) return Promise.resolve(initial)

  ensureVoicesListener()
  return new Promise(resolve => {
    let waiter
    const timer = setTimeout(() => {
      waiters = waiters.filter(candidate => candidate !== waiter)
      resolve(getVoicesList())
    }, timeoutMs)
    waiter = list => {
      clearTimeout(timer)
      resolve(list)
    }
    waiters.push(waiter)
  })
}

/**
 * Finds the first voice whose language matches langCode. Matching is done on
 * the extracted 2-letter code, as some voice.lang values carry qualifiers
 * ('en-US') or are longer than 2 characters — plain `=== langCode` is not
 * enough.
 * Null-safe: returns null when langCode is null/undefined, when no voice has
 * a comparable lang, or when nothing matches — never throws.
 * @param {string|null} langCode language code or tag to match
 * @return {Object|null} first matching SpeechSynthesisVoice, else null
 */
export const findLocalVoice = (langCode) => {
  if (langCode === null || langCode === undefined) return null // guard before extractLanguageCode
  const wanted = extractLanguageCode(langCode)
  if (wanted === null) return null
  const voice = getVoicesList().find(candidate =>
    candidate.lang !== null && candidate.lang !== undefined &&
    extractLanguageCode(candidate.lang) === wanted)
  return voice ?? null
}

/**
 * Finds a voice by its voiceURI (the value persisted as speechVoice).
 * Null-safe: returns null when voiceURI is null/undefined or nothing
 * matches — never throws, even before the voice list is loaded.
 * @param {string|null} voiceURI voiceURI to match
 * @return {Object|null} matching SpeechSynthesisVoice, else null
 */
export const findVoiceByVoiceURI = (voiceURI) => {
  if (voiceURI === null || voiceURI === undefined) return null
  const voice = getVoicesList().find(candidate => candidate.voiceURI === voiceURI)
  return voice ?? null
}
