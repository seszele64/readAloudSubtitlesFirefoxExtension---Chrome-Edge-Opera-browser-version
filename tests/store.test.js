// Persistence semantics of src/shared/store.js (S19): the single owner of the
// `speechSettings` entry in chrome.storage.local.
//
// These tests LOCK IN the verified behavior of the memoized loader
// (persist defaults on first run, persist a normalized copy when a dead
// `GoogleTranslate_*` voice was cleaned up), the read-merge-write saver, the
// single-listener onChanged multiplexer, and the pure legacy-voice
// normalizer. Several expectations below are quirky but deterministic (e.g.
// save() does not re-normalize a legacy voice; a failed read is followed by a
// defaults write-back), so they are pinned as-is. If a test fails after an
// intentional behavior change, update the expectation deliberately — never
// patch production code from this suite.
//
// Isolation: store.js keeps its cache, memoized load promise, listener list,
// and listener-registered flag at MODULE scope, so every test re-imports a
// fresh module instance via vi.resetModules() + dynamic import (after
// installChromeMock() has stubbed the chrome global). Each test therefore
// starts with an empty Map-backed store and zero listeners.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChromeMock } from './helpers/chrome-mock.js'

// Fresh store module per test (see isolation note in the file header).
const importStore = async () => {
  vi.resetModules()
  return import('../src/shared/store.js')
}

const FULL_DEFAULTS = {
  speechSpeed: 2.3,
  speechVolume: 1,
  speechVoice: null,
  rememberUserLastSelectedAutoTranslateToLanguageCode: null
}

let chrome

beforeEach(() => {
  chrome = installChromeMock()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('loadSpeechSettings (memoized load + first-run persistence)', () => {
  it('returns the same memoized promise for repeated calls and reads storage once', async () => {
    const store = await importStore()
    const getSpy = vi.spyOn(chrome.storage.local, 'get')

    const first = store.loadSpeechSettings()
    const second = store.loadSpeechSettings()

    expect(second).toBe(first)
    await first
    expect(getSpy).toHaveBeenCalledTimes(1)
  })

  it('persists DEFAULT_SPEECH_SETTINGS on first run, including the remember-language key', async () => {
    const store = await importStore()

    const settings = await store.loadSpeechSettings()

    expect(settings).toEqual(store.DEFAULT_SPEECH_SETTINGS)
    // The key the legacy popup defaults omitted (source of the divergence bug).
    expect(settings.rememberUserLastSelectedAutoTranslateToLanguageCode).toBe(null)
    // First run writes the defaults back so the next context reads them.
    expect(chrome.__mock.store.get('speechSettings')).toEqual(FULL_DEFAULTS)
  })

  it('exposes the live cache via getSpeechSettings (null before load, same object after)', async () => {
    const store = await importStore()

    expect(store.getSpeechSettings()).toBe(null)

    const settings = await store.loadSpeechSettings()

    expect(store.getSpeechSettings()).toBe(settings)
  })

  it('merges stored settings over the defaults (partial stored object)', async () => {
    chrome.__mock.store.set('speechSettings', { speechSpeed: 1.5 })
    const store = await importStore()

    const settings = await store.loadSpeechSettings()

    // Stored value wins over the default, missing keys fall back to defaults.
    expect(settings).toEqual({ ...FULL_DEFAULTS, speechSpeed: 1.5 })
    expect(settings.speechSpeed).toBe(1.5)
  })

  it('does not re-persist when the stored settings are already complete', async () => {
    chrome.__mock.store.set('speechSettings', { ...FULL_DEFAULTS })
    const store = await importStore()
    const setSpy = vi.spyOn(chrome.storage.local, 'set')

    await store.loadSpeechSettings()

    // stored truthy and normalizeLegacyVoice returned it unchanged -> no write.
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('normalizes a legacy GoogleTranslate_* voice to null and persists the cleaned-up copy', async () => {
    const legacy = {
      speechSpeed: 2.3,
      speechVolume: 1,
      speechVoice: 'GoogleTranslate_Spanish',
      rememberUserLastSelectedAutoTranslateToLanguageCode: 'es'
    }
    chrome.__mock.store.set('speechSettings', legacy)
    const store = await importStore()

    const settings = await store.loadSpeechSettings()

    expect(settings.speechVoice).toBe(null)
    // Siblings survive the cleanup untouched.
    expect(settings.rememberUserLastSelectedAutoTranslateToLanguageCode).toBe('es')
    expect(settings.speechSpeed).toBe(2.3)

    // The normalized copy is persisted (a NEW object with the voice nulled).
    const persisted = chrome.__mock.store.get('speechSettings')
    expect(persisted.speechVoice).toBe(null)
    expect(persisted).not.toBe(legacy)
    expect(persisted.rememberUserLastSelectedAutoTranslateToLanguageCode).toBe('es')
  })

  it('still resolves with defaults when the storage read fails (lastError path)', async () => {
    const store = await importStore()
    chrome.__mock.armFailure('storage unavailable')

    const settings = await store.loadSpeechSettings()

    // Resilience contract: the loader never rejects; lastError is logged and
    // the caller gets defaults. (Note: this path also writes the defaults
    // back, OVERWRITING whatever storage held — reported as a finding, not
    // asserted here so the suite does not bless the potential data loss.)
    expect(settings).toEqual(store.DEFAULT_SPEECH_SETTINGS)
  })
})

describe('saveSpeechSettings (read-merge-write)', () => {
  it('merges the patch over current settings, retaining sibling keys', async () => {
    const store = await importStore()
    await store.loadSpeechSettings()

    await store.saveSpeechSettings({ speechVoice: 'Microsoft David' })

    const persisted = chrome.__mock.store.get('speechSettings')
    expect(persisted).toEqual({ ...FULL_DEFAULTS, speechVoice: 'Microsoft David' })
    // The cache reflects the same merged state.
    expect(store.getSpeechSettings()).toEqual(persisted)
  })

  it('reads what is STORED (not the stale cache) before merging the patch', async () => {
    const store = await importStore()
    await store.loadSpeechSettings()
    // Another context (e.g. the popup) wrote settings after our load.
    chrome.__mock.store.set('speechSettings', {
      speechSpeed: 3,
      speechVolume: 0.5,
      speechVoice: 'V2',
      rememberUserLastSelectedAutoTranslateToLanguageCode: 'de'
    })

    await store.saveSpeechSettings({ speechVoice: 'V3' })

    const persisted = chrome.__mock.store.get('speechSettings')
    expect(persisted.speechSpeed).toBe(3) // fresh read, not the stale cached 2.3
    expect(persisted.speechVoice).toBe('V3')
    expect(persisted.rememberUserLastSelectedAutoTranslateToLanguageCode).toBe('de')
    expect(persisted.speechVolume).toBe(0.5)
  })

  it('round-trips unknown extra keys it does not know about', async () => {
    chrome.__mock.store.set('speechSettings', { speechSpeed: 1.5, futureField: 'keep-me' })
    const store = await importStore()
    await store.loadSpeechSettings()

    await store.saveSpeechSettings({ speechVolume: 0.25 })

    const persisted = chrome.__mock.store.get('speechSettings')
    expect(persisted.futureField).toBe('keep-me')
    expect(persisted.speechSpeed).toBe(1.5)
    expect(persisted.speechVolume).toBe(0.25)
  })

  it('works standalone before loadSpeechSettings and persists defaults plus the patch', async () => {
    const store = await importStore()

    await store.saveSpeechSettings({ speechVoice: 'Early Writer' })

    const persisted = chrome.__mock.store.get('speechSettings')
    expect(persisted).toEqual({ ...FULL_DEFAULTS, speechVoice: 'Early Writer' })
  })

  it('accepts an empty patch and rewrites the merged settings unchanged', async () => {
    const store = await importStore()
    await store.loadSpeechSettings()

    await store.saveSpeechSettings({})

    expect(chrome.__mock.store.get('speechSettings')).toEqual(FULL_DEFAULTS)
  })

  it('persists a legacy GoogleTranslate_* voice as-is (normalization only happens at load)', async () => {
    const store = await importStore()
    await store.loadSpeechSettings()

    await store.saveSpeechSettings({ speechVoice: 'GoogleTranslate_French' })

    // save() merges but never normalizes; a dead voice saved now stays dead
    // until the next loadSpeechSettings() run cleans it up. Locked as-is.
    expect(chrome.__mock.store.get('speechSettings').speechVoice).toBe('GoogleTranslate_French')
  })

  it('resolves even when the write fails and leaves storage untouched', async () => {
    const store = await importStore()
    await store.loadSpeechSettings()

    // save() issues its read synchronously, so arming the failure right after
    // the call makes ONLY the write fail (one-shot failure injection).
    const savePromise = store.saveSpeechSettings({ speechVoice: 'V' })
    chrome.__mock.armFailure('quota exceeded')

    await savePromise // fire-and-forget contract: resolves despite lastError

    // The in-memory cache was updated before the failed write…
    expect(store.getSpeechSettings().speechVoice).toBe('V')
    // …but storage kept the previous value (no rollback). Locked as-is.
    expect(chrome.__mock.store.get('speechSettings').speechVoice).toBe(null)
  })
})

describe('onSettingsChanged (storage.onChanged multiplexer)', () => {
  it('registers exactly ONE underlying chrome.storage.onChanged listener for many subscribers', async () => {
    const store = await importStore()
    const addSpy = vi.spyOn(chrome.storage.onChanged, 'addListener')

    const unsub1 = store.onSettingsChanged(() => {})
    const unsub2 = store.onSettingsChanged(() => {})

    expect(addSpy).toHaveBeenCalledTimes(1)
    unsub1()
    unsub2()
  })

  it('multiplexes storage changes to every subscriber', async () => {
    const store = await importStore()
    const seen = []
    const unsubA = store.onSettingsChanged(settings => seen.push(['a', settings]))
    const unsubB = store.onSettingsChanged(settings => seen.push(['b', settings]))

    // Real end-to-end path: save -> mock set -> onChanged bus -> listeners.
    await store.saveSpeechSettings({ speechVoice: 'V' })

    expect(seen.map(([tag]) => tag)).toEqual(['a', 'b'])
    expect(seen[0][1].speechVoice).toBe('V')
    unsubA()
    unsubB()
  })

  it('merges the change payload over the cache instead of replacing it (legacy writer omits siblings)', async () => {
    const store = await importStore()
    await store.loadSpeechSettings()
    let received
    const unsub = store.onSettingsChanged(settings => { received = settings })

    // Legacy-popup-style write: only the keys it knows, no remember-language
    // key. Explicitly written values win; omitted siblings keep their values.
    chrome.storage.onChanged.dispatch(
      { speechSettings: { newValue: { speechVoice: 'V', speechSpeed: 3 } } },
      'local'
    )

    expect(received).toEqual({
      speechSpeed: 3,
      speechVolume: 1,
      speechVoice: 'V',
      rememberUserLastSelectedAutoTranslateToLanguageCode: null
    })
    // Subscribers and getSpeechSettings() share one live cached object.
    expect(store.getSpeechSettings()).toBe(received)
    unsub()
  })

  it('ignores changes outside the "local" area and for keys other than speechSettings', async () => {
    const store = await importStore()
    let calls = 0
    const unsub = store.onSettingsChanged(() => { calls++ })

    chrome.storage.onChanged.dispatch({ speechSettings: { newValue: {} } }, 'sync')
    chrome.storage.onChanged.dispatch({ someOtherKey: { newValue: 'x' } }, 'local')

    expect(calls).toBe(0)
    unsub()
  })

  it('ignores change payloads without a newValue (e.g. key deletion)', async () => {
    const store = await importStore()
    let calls = 0
    const unsub = store.onSettingsChanged(() => { calls++ })

    chrome.storage.onChanged.dispatch(
      { speechSettings: { oldValue: { speechVoice: 'x' } } },
      'local'
    )

    expect(calls).toBe(0)
    unsub()
  })

  it('unsubscribe stops notifications for that callback only (idempotent)', async () => {
    const store = await importStore()
    let aCalls = 0
    let bCalls = 0
    const unsubA = store.onSettingsChanged(() => { aCalls++ })
    const unsubB = store.onSettingsChanged(() => { bCalls++ })

    unsubA()
    unsubA() // second call must not throw nor resubscribe

    chrome.storage.onChanged.dispatch(
      { speechSettings: { newValue: { speechVoice: 'V' } } },
      'local'
    )

    expect(aCalls).toBe(0)
    expect(bCalls).toBe(1)
    unsubB()
  })

  it('resubscribing after all listeners unsubscribed still receives notifications', async () => {
    const store = await importStore()
    const addSpy = vi.spyOn(chrome.storage.onChanged, 'addListener')
    const unsubFirst = store.onSettingsChanged(() => {})
    unsubFirst()

    let calls = 0
    store.onSettingsChanged(() => { calls++ })

    // The multiplexer is registered once per module lifetime (guarded by a
    // module flag, NOT by the listener count) and stays wired to the bus.
    expect(addSpy).toHaveBeenCalledTimes(1)
    chrome.storage.onChanged.dispatch(
      { speechSettings: { newValue: { speechSpeed: 9 } } },
      'local'
    )
    expect(calls).toBe(1)
  })
})

describe('normalizeLegacyVoice (pure helper)', () => {
  it('maps a GoogleTranslate_* voice to a NEW object with speechVoice null', async () => {
    const store = await importStore()
    const input = { speechVoice: 'GoogleTranslate_fr', speechSpeed: 2.3 }

    const output = store.normalizeLegacyVoice(input)

    expect(output).not.toBe(input) // new object: callers can detect the rewrite by reference
    expect(output.speechVoice).toBe(null)
    expect(output.speechSpeed).toBe(2.3)
    expect(output).toEqual({ speechVoice: null, speechSpeed: 2.3 })
  })

  it('returns the SAME reference when the voice is not legacy', async () => {
    const store = await importStore()
    const modern = { speechVoice: 'Microsoft David', speechSpeed: 1 }
    const nullVoice = { speechVoice: null }

    expect(store.normalizeLegacyVoice(modern)).toBe(modern)
    expect(store.normalizeLegacyVoice(nullVoice)).toBe(nullVoice)
    expect(store.normalizeLegacyVoice(null)).toBe(null)
    expect(store.normalizeLegacyVoice(undefined)).toBe(undefined)
  })

  it('is case-sensitive on the prefix (googleTranslate_* is NOT legacy, locked as-is)', async () => {
    const store = await importStore()
    const sneaky = { speechVoice: 'googleTranslate_es' }

    expect(store.normalizeLegacyVoice(sneaky)).toBe(sneaky)
  })
})
