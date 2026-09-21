// Single owner of the `speechSettings` entry in chrome.storage.local.
// Contexts (content script, later popup) read/write settings only through
// this module. The in-memory cache starts as null and is filled in
// asynchronously by the memoized loadSpeechSettings() promise.

const STORAGE_KEY = 'speechSettings'

// Shared defaults for every context. Includes
// rememberUserLastSelectedAutoTranslateToLanguageCode, which the legacy popup
// defaults omitted (the source of the settings divergence bug).
export const DEFAULT_SPEECH_SETTINGS = {
  speechSpeed: 2.3,
  speechVolume: 1,
  speechVoice: null,
  rememberUserLastSelectedAutoTranslateToLanguageCode: null
}

// Maps a dead `GoogleTranslate_*` speechVoice (remote TTS voice values that no
// longer work) to null. Pure: returns a new object only when a rewrite
// happened, otherwise the input unchanged (so callers can detect the change
// by reference).
export const normalizeLegacyVoice = settings => {
  if (
    settings &&
    typeof settings.speechVoice === 'string' &&
    settings.speechVoice.startsWith('GoogleTranslate_')
  ) {
    return { ...settings, speechVoice: null }
  }
  return settings
}

let cachedSettings = null
let loadPromise = null
let changeListeners = []
let storageListenerRegistered = false

const mergeWithDefaults = settings => ({
  ...DEFAULT_SPEECH_SETTINGS,
  ...settings
})

/**
 * Async fill-in of the cached settings from storage, memoized so every caller
 * shares one promise. Persists the defaults on first run (nothing stored yet)
 * and persists a normalized copy when a dead `GoogleTranslate_*` voice was
 * cleaned up in storage.
 * @return {Promise<Object>} resolves with the live cached settings object
 */
export const loadSpeechSettings = () => {
  if (!loadPromise) {
    loadPromise = new Promise(resolve => {
      chrome.storage.local.get(STORAGE_KEY, result => {
        if (chrome.runtime.lastError) {
          console.error('Error loading speech settings:', chrome.runtime.lastError)
        }
        const stored = result ? result[STORAGE_KEY] : undefined
        const normalized = normalizeLegacyVoice(stored)
        cachedSettings = stored ? mergeWithDefaults(normalized) : { ...DEFAULT_SPEECH_SETTINGS }
        if (!stored || normalized !== stored) {
          chrome.storage.local.set({ [STORAGE_KEY]: cachedSettings })
        }
        resolve(cachedSettings)
      })
    })
  }
  return loadPromise
}

/**
 * Returns the live cached settings object (null until loadSpeechSettings()
 * resolves). Mutating it only changes the in-memory cache; persist the change
 * with saveSpeechSettings().
 * @return {Object|null}
 */
export const getSpeechSettings = () => cachedSettings

/**
 * Read-merge-write persist: merges `patch` over what is currently stored,
 * updates the cache and writes the merged settings back. Accepts a partial
 * patch or a complete settings object. Resolves once the write completed.
 * @param {Object} patch settings fields to persist
 * @return {Promise<void>}
 */
export const saveSpeechSettings = patch => {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, result => {
      if (chrome.runtime.lastError) {
        console.error('Error saving speech settings:', chrome.runtime.lastError)
      }
      const stored = result ? result[STORAGE_KEY] : undefined
      cachedSettings = mergeWithDefaults({ ...stored, ...patch })
      chrome.storage.local.set({ [STORAGE_KEY]: cachedSettings }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving speech settings:', chrome.runtime.lastError)
        }
        resolve()
      })
    })
  })
}

/**
 * Subscribes `callback` to speech settings changes; the callback receives the
 * updated live cached settings object. Backed by a single
 * chrome.storage.onChanged listener that multiplexes to all subscribers.
 * @param {(settings: Object) => void} callback
 * @return {() => void} unsubscribe function
 */
export const onSettingsChanged = callback => {
  if (!storageListenerRegistered) {
    storageListenerRegistered = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(STORAGE_KEY in changes)) return
      const newValue = changes[STORAGE_KEY].newValue
      if (!newValue) return
      // Merge (not replace) so keys a writer did not include (the legacy
      // popup omits rememberUserLastSelectedAutoTranslateToLanguageCode) keep
      // their current values, while explicitly written values still win.
      cachedSettings = mergeWithDefaults({ ...cachedSettings, ...newValue })
      for (const listener of changeListeners) {
        listener(cachedSettings)
      }
    })
  }
  changeListeners.push(callback)
  return () => {
    changeListeners = changeListeners.filter(listener => listener !== callback)
  }
}
