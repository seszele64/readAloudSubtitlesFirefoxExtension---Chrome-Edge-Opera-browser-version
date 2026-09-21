// Reusable test doubles for the Chrome/Web Speech APIs (S05 test harness).
//
// The fakes mirror the API surface the extension actually uses:
// - chrome.storage.local: Map-backed get/set/remove/clear in callback AND
//   promise mode, settling asynchronously like the real API.
// - chrome.storage.onChanged: listener bus dispatching
//   (changes, 'local') with { key: { oldValue?, newValue } } payloads that
//   omit oldValue/newValue for created/deleted keys, as Chrome does.
// - chrome.runtime.lastError: set only while a failed operation's callback
//   runs, undefined at any other time (read it inside the callback).
// - speechSynthesis + SpeechSynthesisUtterance: voice list, utterance queue,
//   and manual hooks to drive the onstart/onend/onerror lifecycle.
//
// installChromeMock()/stubSpeechSynthesis() wire the fakes through
// vi.stubGlobal, so vi.unstubAllGlobals() (e.g. in afterEach) restores the
// original globals between tests.

import { vi } from 'vitest'

/** Tiny add/remove/has/dispatch listener bus shared by the fake events. */
function createEventBus() {
  const listeners = new Set()
  return {
    addListener(listener) {
      listeners.add(listener)
    },
    removeListener(listener) {
      listeners.delete(listener)
    },
    hasListener(listener) {
      return listeners.has(listener)
    },
    dispatch(...args) {
      for (const listener of [...listeners]) listener(...args)
    },
  }
}

/**
 * Build a fresh in-memory fake of the `chrome` namespace.
 * The backing Map is exposed at `chrome.__mock.store` so tests can seed or
 * inspect state directly; `chrome.__mock.armFailure(message)` makes the next
 * storage operation fail (callback mode sees runtime.lastError, promise mode
 * gets a rejected promise).
 */
export function createChromeMock() {
  const store = new Map()
  const onChangedBus = createEventBus()
  let armedFailure = null // one-shot error injected into the next storage op

  const emitChange = (changes) => {
    if (Object.keys(changes).length > 0) onChangedBus.dispatch(changes, 'local')
  }

  const runtime = {}
  // Mirror the real API: results/errors reach the caller on a later microtask.
  const settle = (callback, failure, computeResult) => {
    if (typeof callback === 'function') {
      return Promise.resolve().then(() => {
        if (failure) runtime.lastError = { message: failure }
        try {
          callback(failure ? undefined : computeResult())
        } finally {
          runtime.lastError = undefined
        }
      })
    }
    return Promise.resolve().then(() => {
      if (failure) throw new Error(failure)
      return computeResult()
    })
  }

  const nextFailure = () => {
    const failure = armedFailure
    armedFailure = null
    return failure
  }

  const local = {
    get(keys, callback) {
      const failure = nextFailure()
      return settle(callback, failure, () => {
        const items = {}
        if (keys === undefined || keys === null) {
          for (const [key, value] of store) items[key] = value
        } else if (typeof keys === 'string') {
          if (store.has(keys)) items[keys] = store.get(keys)
        } else if (Array.isArray(keys)) {
          for (const key of keys) {
            if (store.has(key)) items[key] = store.get(key)
          }
        } else {
          // Object form: values act as defaults for keys not yet stored.
          for (const [key, fallback] of Object.entries(keys)) {
            items[key] = store.has(key) ? store.get(key) : fallback
          }
        }
        return items
      })
    },
    set(items, callback) {
      const failure = nextFailure()
      return settle(callback, failure, () => {
        const changes = {}
        for (const [key, newValue] of Object.entries(items ?? {})) {
          const hadValue = store.has(key)
          const oldValue = hadValue ? store.get(key) : undefined
          store.set(key, newValue)
          changes[key] = hadValue ? { oldValue, newValue } : { newValue }
        }
        emitChange(changes)
      })
    },
    remove(keys, callback) {
      const failure = nextFailure()
      const keyList = typeof keys === 'string' ? [keys] : keys
      return settle(callback, failure, () => {
        const changes = {}
        for (const key of keyList ?? []) {
          if (store.has(key)) {
            changes[key] = { oldValue: store.get(key) }
            store.delete(key)
          }
        }
        emitChange(changes)
      })
    },
    clear(callback) {
      const failure = nextFailure()
      return settle(callback, failure, () => {
        const changes = {}
        for (const [key, value] of store) changes[key] = { oldValue: value }
        store.clear()
        emitChange(changes)
      })
    },
  }

  return {
    runtime,
    storage: {
      local,
      onChanged: onChangedBus,
    },
    // Non-API extras for tests: seed/inspect data, assert listener counts,
    // inject one-shot failures, or wipe state between test phases.
    __mock: {
      store,
      onChanged: onChangedBus,
      armFailure(message) {
        armedFailure = message
      },
      reset() {
        store.clear()
        armedFailure = null
      },
    },
  }
}

/** createChromeMock() + install as the `chrome` global via vi.stubGlobal. */
export function installChromeMock() {
  const chrome = createChromeMock()
  vi.stubGlobal('chrome', chrome)
  return chrome
}

/**
 * Minimal SpeechSynthesisUtterance stand-in: the same constructor properties
 * as the real one plus addEventListener/removeEventListener; tests drive
 * onstart/onend/onerror by calling __emit(type) via the speech fake below.
 */
class FakeSpeechSynthesisUtterance {
  #listeners = new Map()

  constructor(text = '') {
    this.text = String(text)
    this.lang = ''
    this.voice = null
    this.volume = 1
    this.rate = 1
    this.pitch = 1
    this.onstart = null
    this.onend = null
    this.onerror = null
  }

  addEventListener(type, listener) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
    this.#listeners.get(type).add(listener)
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener)
  }

  __emit(type, event) {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) {
      listener.call(this, event)
    }
    const handler = this[`on${type}`]
    if (typeof handler === 'function') handler.call(this, event)
  }
}

/**
 * Replace speechSynthesis + SpeechSynthesisUtterance with fakes wired via
 * vi.stubGlobal. speak()/cancel() are vi.fn() spies; the fake starts with no
 * voices until __setVoices(list) is called, which also fires
 * onvoiceschanged asynchronously (mirroring Chrome). __emitUtteranceEvent()
 * lets tests drive utterance lifecycle events by hand.
 */
export function stubSpeechSynthesis(initialVoices = []) {
  const voices = [...initialVoices]
  const utterances = []

  const speechSynthesis = {
    pending: false,
    speaking: false,
    paused: false,
    onvoiceschanged: null,
    getVoices: vi.fn(() => [...voices]),
    speak: vi.fn((utterance) => {
      utterances.push(utterance)
      speechSynthesis.speaking = true
      speechSynthesis.pending = true
    }),
    cancel: vi.fn(() => {
      utterances.length = 0
      speechSynthesis.speaking = false
      speechSynthesis.pending = false
    }),
    pause: vi.fn(() => {
      speechSynthesis.paused = true
    }),
    resume: vi.fn(() => {
      speechSynthesis.paused = false
    }),
    // Non-API extras for tests.
    __utterances: utterances,
    __setVoices(list) {
      voices.length = 0
      voices.push(...list)
      // Chrome notifies listeners asynchronously once voices are loaded.
      queueMicrotask(() => {
        if (typeof speechSynthesis.onvoiceschanged === 'function') {
          speechSynthesis.onvoiceschanged(new Event('voiceschanged'))
        }
      })
    },
    // Fire an utterance lifecycle event; 'end'/'error' also updates the
    // speaking/pending flags the way the browser would when speech finishes.
    __emitUtteranceEvent(utterance, type, event = {}) {
      utterance.__emit(type, { type, ...event })
      if (type === 'end' || type === 'error') {
        const index = utterances.indexOf(utterance)
        if (index !== -1) utterances.splice(index, 1)
        if (utterances.length === 0) {
          speechSynthesis.speaking = false
          speechSynthesis.pending = false
        }
      }
    },
  }

  vi.stubGlobal('speechSynthesis', speechSynthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance)
  return speechSynthesis
}
