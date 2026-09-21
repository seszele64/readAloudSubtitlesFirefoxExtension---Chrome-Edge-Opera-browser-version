// boundarySearch semantics — binarySearch() from src/content/captions.js (S19).
//
// binarySearch(textElements, currentTime) finds the subtitle element whose
// [start, nextStart] window contains the video's currentTime, operating on
// REAL DOM elements that carry a `start` attribute (the <text> nodes of a
// parsed YouTube timedtext XML). It returns the element or null.
//
// These tests LOCK IN the verified boundary behavior with real jsdom
// elements. Several results are quirky but deterministic (e.g. at
// currentTime === nextElStart the EARLIER element wins; elements without a
// numeric `start` are skipped rightward via NaN comparisons), so they are
// pinned as-is. If a test fails after an intentional behavior change, update
// the expectation deliberately — never patch production code from this suite.
//
// Importing captions.js evaluates its module graph (store / srt / pot /
// navigation). captions.js itself calls loadSpeechSettings() and
// onSettingsChanged() at module scope, so the chrome mock MUST be installed
// before the import — hence the dynamic import in beforeAll (static imports
// would hoist ahead of the stub). pot.js's chrome.runtime.getURL use is
// deferred inside injectPotProbe(), so the mock surface (storage.local +
// storage.onChanged) is sufficient.

import { beforeAll, describe, expect, it } from 'vitest'
import { installChromeMock } from './helpers/chrome-mock.js'

let binarySearch

beforeAll(async () => {
  installChromeMock()
  const captions = await import('../src/content/captions.js')
  binarySearch = captions.binarySearch
})

// Real DOM element carrying a numeric `start` attribute, mirroring the
// <text start="41.7"> nodes of a parsed caption XML (empty textContent is
// fine: binarySearch only reads attributes).
const el = (start, text = start === undefined ? 'no-start' : `t${start}`) => {
  const node = document.createElement('text')
  if (start !== undefined) node.setAttribute('start', String(start))
  node.textContent = text
  return node
}

const byText = (elements, time) => {
  const match = binarySearch(elements, time)
  return match ? match.textContent : null
}

describe('binarySearch: miss results (null)', () => {
  it('returns null for an empty list', () => {
    expect(binarySearch([], 10)).toBe(null)
    expect(binarySearch([], 0)).toBe(null)
  })

  it('returns null when currentTime is before the first element start', () => {
    const elements = [el(10), el(20), el(30)]
    expect(byText(elements, 9.9)).toBe(null)
    expect(byText(elements, 0)).toBe(null)
  })
})

describe('binarySearch: interval + boundary semantics', () => {
  it('matches the element whose [start, nextStart] window contains currentTime', () => {
    const elements = [el(10), el(20), el(30)]
    expect(byText(elements, 15)).toBe('t10')
    expect(byText(elements, 25)).toBe('t20')
    expect(byText(elements, 35)).toBe('t30')
  })

  it('returns the element itself when currentTime === elStart (inclusive lower bound)', () => {
    const elements = [el(10), el(20), el(30)]
    // mid lands on element 20, and 20 >= 20 wins its own window.
    expect(byText(elements, 20)).toBe('t20')
    expect(byText(elements, 10)).toBe('t10')
  })

  it('returns the EARLIER element when currentTime === nextElStart (inclusive upper bound)', () => {
    // At a shared boundary both windows are candidates; the inclusive
    // nextElStart bound of the earlier element wins wherever the search
    // touches that pair first.
    const elements = [el(10), el(20), el(30)]
    expect(byText(elements, 30)).toBe('t20') // not t30
    expect(byText([el(10), el(20)], 20)).toBe('t10') // two elements: t10's window is inclusive
  })

  it('keeps matching the last element forever after its start (Infinity upper bound)', () => {
    const elements = [el(10), el(20)]
    expect(byText(elements, 21)).toBe('t20')
    expect(byText(elements, 99999)).toBe('t20')
  })

  it('handles a single element: matches at/after its start, null before', () => {
    const elements = [el(10)]
    expect(byText(elements, 10)).toBe('t10')
    expect(byText(elements, 600)).toBe('t10')
    expect(byText(elements, 9.9)).toBe(null)
  })
})

describe('binarySearch: fractional start attributes (parseFloat)', () => {
  it('compares parsed float starts, not string values', () => {
    const elements = [el('1.5'), el('3.7'), el('5.9')]
    expect(byText(elements, 1.5)).toBe('t1.5')
    expect(byText(elements, 1.6)).toBe('t1.5')
    expect(byText(elements, 4)).toBe('t3.7')
    expect(byText(elements, 3.7)).toBe('t3.7')
    expect(byText(elements, 5.95)).toBe('t5.9')
    expect(byText(elements, 1.49)).toBe(null)
  })
})

describe('binarySearch: logarithmic search over a large list', () => {
  const makeHundred = () => Array.from({ length: 100 }, (_, i) => el(i * 10))

  it('finds elements in the middle of a large list (exercises the divide step)', () => {
    const elements = makeHundred()
    // A boundary-only scan could never answer these; the midpoint logic must.
    expect(byText(elements, 505)).toBe('t500')
    expect(byText(elements, 0)).toBe('t0')
    expect(byText(elements, 989)).toBe('t980')
  })

  it('matches the last element of a large list (exercises the end pointer)', () => {
    const elements = makeHundred()
    expect(byText(elements, 1e6)).toBe('t990')
    // t=990 lands on t980: the boundary instant belongs to t980's inclusive
    // window; only a time strictly past 990 reaches the last element.
    expect(byText(elements, 990)).toBe('t980')
  })
})

describe('binarySearch: real usage shape (HTMLCollection from caption XML)', () => {
  it('works on the live HTMLCollection getElementsByTagName returns', () => {
    const xml = [
      '<transcript>',
      '<text start="1.5">one</text>',
      '<text start="3.7" dur="2">two</text>',
      '<text start="6.1">three</text>',
      '</transcript>'
    ].join('')
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    const textElements = doc.getElementsByTagName('text')

    expect(binarySearch(textElements, 4).textContent).toBe('two')
    expect(binarySearch(textElements, 0.5)).toBe(null)
    expect(binarySearch(textElements, 100).textContent).toBe('three')
    // Boundary pinned on the collection shape too.
    expect(binarySearch(textElements, 6.1).textContent).toBe('two') // earlier element wins at nextElStart
  })
})

describe('binarySearch: missing start attribute (NaN quirk, locked as-is)', () => {
  it('skips elements without a numeric start rightward and returns null here', () => {
    // parseFloat(null) is NaN: both comparisons fail, the window moves right,
    // and this layout deterministically ends with no match.
    const elements = [el(undefined), el(20)]
    expect(byText(elements, 10)).toBe(null)
  })

  it('a NaN start in the tail poisons every window it bounds (Infinity fallback is last-element only)', () => {
    const elements = [el(10), el(20), el(undefined)]
    // t=15 -> t10 still matches (its window [10, 20] is healthy)…
    expect(byText(elements, 15)).toBe('t10')
    // …but t=25 gets null: mid hits t20 whose nextElStart is NaN, both
    // comparisons fail, and the search walks past the array end.
    expect(byText(elements, 25)).toBe(null)
  })
})
