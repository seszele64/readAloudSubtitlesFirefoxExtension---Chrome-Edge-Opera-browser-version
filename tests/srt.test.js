// Pure-module semantics for src/shared/srt.js (S18).
//
// These tests LOCK IN the S08-verified behavior of the moved-verbatim legacy
// code: every expectation below is a hardcoded literal verified against the
// implementation under jsdom. If a test fails after an intentional behavior
// change, update the expectation deliberately — a failing test here signals
// a contract change, never a reason to edit production code from the suite.
//
// convertFromTimedToSrtFormat requires DOMParser, which the vitest jsdom
// environment provides (vitest.config.js), mirroring the extension's
// document-based contexts. No network, no chrome.* — pure functions only.

import { describe, expect, it } from 'vitest'
import {
  convertFromTimedToSrtFormat,
  fillZero,
  formatTime,
  unescapeHTML,
} from '../src/shared/srt.js'

describe('unescapeHTML', () => {
  it('returns "" for the empty string', () => {
    expect(unescapeHTML('')).toBe('')
  })

  it('returns text without entities unchanged', () => {
    expect(unescapeHTML('plain text')).toBe('plain text')
  })

  it('unescapes each of the five supported entities', () => {
    expect(unescapeHTML('&quot;A&quot;')).toBe('"A"')
    expect(unescapeHTML('&lt;x&gt;')).toBe('<x>')
    expect(unescapeHTML('&#39;')).toBe("'")
    expect(unescapeHTML('&amp;')).toBe('&')
  })

  it('replaces &amp; first so double-escaped entities collapse fully (&amp;quot; -> ")', () => {
    // YouTube sometimes serves captions escaped twice (&amp;quot;). &amp; is
    // the first entry in the replacement order, so the leftover &quot; is
    // unescaped by the later pass in the same call.
    expect(unescapeHTML('&amp;quot;hi&amp;quot;')).toBe('"hi"')
    expect(unescapeHTML('&amp;lt;tag&amp;gt;')).toBe('<tag>')
  })

  it('unescapes &amp;amp; only one level (single pass, no re-scan)', () => {
    // &amp; runs first and its output is never re-scanned, so one escape
    // level survives. Locks the single-pass nature of the implementation.
    expect(unescapeHTML('&amp;amp;')).toBe('&amp;')
  })

  it('leaves unsupported entities untouched', () => {
    expect(unescapeHTML('&nbsp;')).toBe('&nbsp;')
  })
})

describe('formatTime', () => {
  it('formats zero as 00:00:00,000', () => {
    expect(formatTime(0)).toBe('00:00:00,000')
  })

  it('formats one hour (3600) as 01:00:00,000', () => {
    expect(formatTime(3600)).toBe('01:00:00,000')
  })

  it('formats 3599.999 as 00:59:59,999 (second/hour boundary)', () => {
    expect(formatTime(3599.999)).toBe('00:59:59,999')
  })

  it('formats 3661.5 as 01:01:01,500 (hour + minute + second + half second)', () => {
    expect(formatTime(3661.5)).toBe('01:01:01,500')
  })

  it('carries seconds across the minute boundary', () => {
    expect(formatTime(61)).toBe('00:01:01,000')
  })

  it('truncates rather than rounds fractional milliseconds', () => {
    expect(formatTime(0.9999)).toBe('00:00:00,999')
    expect(formatTime(59.999)).toBe('00:00:59,999')
  })

  it('does not clamp hours above 24 (90061 -> 25:01:01,000)', () => {
    expect(formatTime(90061)).toBe('25:01:01,000')
  })

  it('formats NaN as NaN:NaN:NaN,NaN (feeds the missing-dur path)', () => {
    expect(formatTime(NaN)).toBe('NaN:NaN:NaN,NaN')
  })

  it('keeps the legacy quirk for negative input (-1 -> "-1:59:59,000")', () => {
    // Math.floor(-1 / 3600) === -1 pushes the borrow into the hours digit.
    // Locked as-is; revisit deliberately if sign handling is ever changed.
    expect(formatTime(-1)).toBe('-1:59:59,000')
  })
})

describe('fillZero', () => {
  it('pads numbers shorter than len with leading zeros', () => {
    expect(fillZero(5, 2)).toBe('05')
    expect(fillZero(0, 3)).toBe('000')
    expect(fillZero(42, 4)).toBe('0042')
  })

  it('returns the number unchanged when it is already at least len characters', () => {
    expect(fillZero(123, 2)).toBe('123')
    expect(fillZero(0, 0)).toBe('0')
  })
})

describe('convertFromTimedToSrtFormat', () => {
  it('converts a typical YouTube timed-caption XML to SRT with sequential numbering', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<transcript>',
      '<text start="9.72" dur="2.68">Lately, I&#39;ve been, I&#39;ve been thinking</text>',
      '<text start="13.04" dur="2.16">about what we could do with love</text>',
      '</transcript>',
    ].join('')
    const expected = [
      '1',
      '00:00:09,720 --> 00:00:12,400',
      "Lately, I've been, I've been thinking",
      '',
      '2',
      '00:00:13,040 --> 00:00:15,200',
      'about what we could do with love',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('decodes XML entities once and double-escaped entities twice in captions', () => {
    // The XML parser strips one escape level (&amp;quot; -> &quot;), and the
    // final unescapeHTML(content) strips the second (&quot; -> ").
    const xml =
      '<transcript><text start="0" dur="1">&amp;quot;hi&amp;quot; &amp;amp; &lt;tag&gt;</text></transcript>'
    const expected = [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      '"hi" & <tag>',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('keeps already-decoded ampersands intact through the final unescape', () => {
    const xml = '<transcript><text start="0" dur="1">A &amp; B</text></transcript>'
    const expected = [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      'A & B',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('turns literal backslash-n into newlines and backslash-quote into quotes', () => {
    // The XML text holds single literal backslashes (\\n and \\" in this
    // JS source), replaced by /\n/ and /\"/ replacements before the
    // timestamp line. The caption's embedded newline appears as its own
    // line inside cue 1 (still one cue, not two).
    const xml =
      '<transcript><text start="0" dur="1">Line1\\nLine2 and \\"quoted\\"</text></transcript>'
    const expected = [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      'Line1',
      'Line2 and "quoted"',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('trims surrounding whitespace including a trailing literal newline escape', () => {
    const xml = '<transcript><text start="0" dur="1">Hello\\nWorld\\n</text></transcript>'
    // 'Hello\nWorld\n' -> trim() removes the trailing newline -> 'Hello\nWorld'
    const expected = [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      'Hello',
      'World',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('trims spaces around the caption text', () => {
    const xml = '<transcript><text start="0" dur="1">  padded  </text></transcript>'
    const expected = [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      'padded',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('skips empty and whitespace-only cues without advancing the numbering', () => {
    const xml = [
      '<transcript>',
      '<text start="0" dur="1"></text>',
      '<text start="1" dur="1">   </text>',
      '<text start="2" dur="3">real</text>',
      '<text start="5" dur="1"></text>',
      '</transcript>',
    ].join('')
    const expected = [
      '1',
      '00:00:02,000 --> 00:00:05,000',
      'real',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('returns "" when every cue is empty (empty text -> "")', () => {
    const xml =
      '<transcript><text start="0" dur="1"></text><text start="2" dur="1"> </text></transcript>'
    expect(convertFromTimedToSrtFormat(xml)).toBe('')
  })

  it('preserves the missing-dur path verbatim: end timestamp becomes NaN:NaN:NaN,NaN', () => {
    // parseFloat(null) === NaN; endTime = 1 + NaN; formatTime(NaN) emits
    // 'NaN:NaN:NaN,NaN' instead of falling back to anything saner.
    const xml = '<transcript><text start="1">no duration</text></transcript>'
    const expected = [
      '1',
      '00:00:01,000 --> NaN:NaN:NaN,NaN',
      'no duration',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('formats both timestamps as NaN when start and dur are both missing', () => {
    const xml = '<transcript><text>no timing</text></transcript>'
    const expected = [
      '1',
      'NaN:NaN:NaN,NaN --> NaN:NaN:NaN,NaN',
      'no timing',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('renders a zero-duration cue with identical start and end timestamps', () => {
    const xml = '<transcript><text start="1.5" dur="0">zero dur</text></transcript>'
    const expected = [
      '1',
      '00:00:01,500 --> 00:00:01,500',
      'zero dur',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })

  it('returns "" for malformed XML (parser error yields no <text> elements)', () => {
    expect(convertFromTimedToSrtFormat('<transcript><text start="0"')).toBe('')
  })

  it('uses only the first child node of <text> (locked mixed-content quirk)', () => {
    // childNodes of this <text> is [text 'a', element <b/>, text 'b']; the
    // implementation reads childNodes[0].nodeValue only, so the trailing 'b'
    // is dropped. Unrealistic for YouTube output but locks the mechanism.
    const xml = '<transcript><text start="0" dur="1">a<b/>b</text></transcript>'
    const expected = [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      'a',
      '',
      '',
    ].join('\n')
    expect(convertFromTimedToSrtFormat(xml)).toBe(expected)
  })
})
