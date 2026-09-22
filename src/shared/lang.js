// Pure language-code helpers shared by contexts that need to normalize a
// language string (e.g. 'en-US', 'en', 'en (US)') down to its 2-letter code.
// No chrome.* or DOM dependencies — safe to import from any context.

// Use precompiled regular expressions: since they are used repeatedly, they
// can be precompiled outside the function to improve performance. This avoids
// compiling the regular expression each time the function is called.
const regex = /^([a-z]{2})(?:-[A-Za-z]{2})?$/;
const qualifierRegex = /^([a-z]{2})(?:-[A-Za-z]+)/;

export const extractLanguageCode = (text) => {
  if (text === null) return null;

  const matches = text.match(regex);
  if (matches) {
    return matches[1];
  }

  // Extract language code from text containing qualifiers
  const qualifierMatches = text.match(qualifierRegex);
  if (qualifierMatches) {
    return qualifierMatches[1];
  }

  // Handle cases where additional qualifiers are present
  const hyphenIndex = text.indexOf("-");
  if (hyphenIndex !== -1) {
    return text.slice(0, hyphenIndex);
  }

  return text;
}