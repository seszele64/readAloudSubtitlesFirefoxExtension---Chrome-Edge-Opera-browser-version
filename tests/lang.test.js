// Pure-module semantics for src/shared/lang.js (S18).
//
// Locks in the S07-verified contract of extractLanguageCode with hardcoded
// literals. The function is case-sensitive and fallback-driven; several
// results below are quirky but deterministic, so they are pinned as-is. If a
// test fails after an intentional behavior change, update the expectation
// deliberately — never patch production code from this suite.

import { describe, expect, it } from 'vitest'
import { extractLanguageCode } from '../src/shared/lang.js'

describe('extractLanguageCode', () => {
  it('passes a bare 2-letter code through unchanged', () => {
    expect(extractLanguageCode('en')).toBe('en')
  })

  it('extracts the code from a language-REGION tag (en-US -> en)', () => {
    expect(extractLanguageCode('en-US')).toBe('en')
    expect(extractLanguageCode('pt-BR')).toBe('pt')
    // The region subtag matches case-insensitively ([A-Za-z]{2}).
    expect(extractLanguageCode('en-us')).toBe('en')
  })

  it('extracts 3-letter codes via the hyphen fallback (fil-PH -> fil)', () => {
    // 'fil' is 3 letters, so the 2-letter regexes do not match; the
    // pre-hyphen slice handles it.
    expect(extractLanguageCode('fil-PH')).toBe('fil')
    expect(extractLanguageCode('fil-PH-extra')).toBe('fil')
  })

  it('extracts the base code from tags with script subtags (zh-Hans-CN -> zh)', () => {
    expect(extractLanguageCode('zh-Hans-CN')).toBe('zh')
    expect(extractLanguageCode('zh-Hant')).toBe('zh')
  })

  it('falls back to the pre-hyphen prefix when neither regex matches (es-419 -> es)', () => {
    expect(extractLanguageCode('es-419')).toBe('es')
    // Trailing hyphen with no subtag: the prefix slice still applies.
    expect(extractLanguageCode('en-')).toBe('en')
  })

  it('returns null for null input', () => {
    expect(extractLanguageCode(null)).toBe(null)
  })

  it('throws a TypeError for undefined input (legacy contract, locked as-is)', () => {
    // Current contract: undefined skips the null guard and crashes on
    // .match. Asserting the throw, NOT any post-fix behavior (e.g.
    // returning null); if that changes intentionally, update this test.
    expect(() => extractLanguageCode(undefined)).toThrow(TypeError)
  })

  it('returns non-matching input verbatim when there is no hyphen', () => {
    expect(extractLanguageCode('EN')).toBe('EN') // uppercase: not a regex match
    expect(extractLanguageCode('en123')).toBe('en123')
    expect(extractLanguageCode('42')).toBe('42')
    // Documented in the module header as handled, but currently passed
    // through verbatim — locked as-is (see reported doc/behavior mismatch).
    expect(extractLanguageCode('en (US)')).toBe('en (US)')
  })

  it('returns "" for empty and lone-hyphen inputs (locked quirks)', () => {
    expect(extractLanguageCode('')).toBe('')
    expect(extractLanguageCode('-')).toBe('')
  })

  it('matches the unanchored qualifier regex with trailing junk (en-US + space -> en)', () => {
    // qualifierRegex has no trailing $ anchor, so a trailing space (or any
    // suffix) after a valid qualifier subtag still yields the base code.
    expect(extractLanguageCode('en-US ')).toBe('en')
  })
})
