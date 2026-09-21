// SRT conversion + time-formatting/entity helpers shared by caption flows.
// Moved verbatim from src/content/entry.js (pure move, zero behavior change).
// Note: convertFromTimedToSrtFormat depends on the DOM (DOMParser), so it is
// importable from any extension context but must run where DOMParser exists.

/**
 * Return original form (unescaped) of escaped characters.
 * There are cases where the string is &amp;quot; therefore need to replace &amp; before
 * @param {String} inputText Input String
 * @return {String}
 */
export const unescapeHTML = inputText => {
  const ESCAPE_SEQ = [
    /&amp;/g,
    /&quot;/g,
    /&lt;/g,
    /&gt;/g,
    /&#39;/g
  ];
  const UNESCAPE_SEQ = [
    '&',
    '"',
    '<',
    '>',
    '\''
  ];
  ESCAPE_SEQ.forEach((escapeSeq, index) => {
    inputText = inputText.replace(escapeSeq, UNESCAPE_SEQ[index]);
  });
  return inputText
}

/**
 * Convert from YouTube closed caption format to srt format.
 * @param {String} xml 
 * @return {String}
 */
export const convertFromTimedToSrtFormat = xml => {
  // Example 1 data line:
  // <text start="9720" dur="2680">Lately, I've been, I've been thinking</p>
  // First is the start time
  // Next is the length
  // Next is the content string
  let content = ''
  let count = 1

  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xml, 'text/xml')
  const arr = [...xmlDoc.getElementsByTagName('text')]
  arr.forEach(text => {
    const startTime = parseFloat(text.getAttribute('start'))
    const duration = parseFloat(text.getAttribute('dur'))
    // Using text.nodeValue will output null
    // Must use text.textContent or text.childNodes[0].nodeValue
    // Using text.textContent will automatically replace characters like &quot;,
    // use text.childNodes[0].nodeValue not
    // const orginalText = text.textContent
    const orginalText = (text.childNodes?.length) ? text.childNodes[0].nodeValue : ''

    const endTime = startTime + duration
    const normalizedText = orginalText.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim()

    if (normalizedText) {
      content += `${count}\n${formatTime(startTime)} --> ${formatTime(endTime)}\n${normalizedText}\n\n`;
      count++;
    }
  })
  return unescapeHTML(content)
}

/**
 * Format the time (that is in second) to the hh:mm:ss,SSS.
 * @param {Float} timeInSec Time in seconds
 * @return {String}
 */
export const formatTime = timeInSec => {
  const SSS = Math.floor(timeInSec * 1000) % 1000
  timeInSec = Math.floor(timeInSec)
  const hh = Math.floor(timeInSec / 3600)
  const mm = Math.floor((timeInSec - hh * 3600) / 60)
  const ss = timeInSec - hh * 3600 - mm * 60
  return (
    fillZero(hh, 2) + ':'
    + fillZero(mm, 2) + ':'
    + fillZero(ss, 2) + ','
    + fillZero(SSS, 3)
  )
}

/**
 * Fill the zero (0) to the left (padding)
 * @param {Integer} num
 * @param {Integer} len
 * @return {String}
 */
export const fillZero = (num, len) => {
  let result = '' + num
  for (let i = result.length; i < len; i++) {
    result = '0' + result
  }
  return result
}
