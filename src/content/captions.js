// Caption-track discovery + TTS caption selection, extracted from
// src/content/entry.js (S14): the captionTracks regex + JSON.parse (as
// fetchCaptionTracks()), assignUrl(), selectCaptionFileForTTS() with the
// binarySearch() subtitle-sync primitive, and getParameterByName().
// (downloadCaptionFile()/saveTextAsFile() moved on to ./gui.js in S16,
// where the links are wired and the save click revokes its object URL.)
//
// Behavior change (the point of S14): getSubtitleList()'s JSON.parse used to
// run unguarded, so a malformed captionTracks JSON blob was an uncaught
// throw that killed the whole subtitle flow. fetchCaptionTracks() guards
// the parse in try/catch and returns null for it, which entry.js routes to
// notifyNotFound() — malformed JSON is now a notified "no subtitles" miss.
//
// Cross-module collaborators:
// - The TTS speech chain (createSpeechUtterance) stays entry.js-owned; it is
//   injected exactly once via initCaptions() (the same inject-once pattern
//   navigation.js uses for its poll collaborators).
// - The isSpeechSynthesisInProgress flag is owned HERE (selectCaptionFileForTTS
//   toggles it and waitUntilSpeechSynthesisComplete() polls it); entry.js —
//   whose utterance onboundary/onend callbacks and 'speech' runtime message
//   used to write it directly — clears it through markSpeechSynthesisIdle().
// - speechSettings comes from the shared store (single storage owner). The
//   local binding mirrors entry.js's: both are filled from the same memoized
//   loadSpeechSettings() promise and the same onSettingsChanged stream, so
//   they reference the same live settings object (in-place mutations — e.g.
//   the rememberUserLastSelectedAutoTranslateToLanguageCode write in
//   assignUrl() — stay visible to both without a save round-trip).

import { loadSpeechSettings, onSettingsChanged } from '../shared/store.js';
import { buildCaptionUrl } from './pot.js';
import { intervalId, setTtsIntervalId } from './navigation.js';

// Entry.js-owned speech chain, injected once by initCaptions() before any
// poll tick or user interaction can reach selectCaptionFileForTTS().
let createSpeechUtterance;

/**
 * Registers the entry.js-owned TTS collaborators this module needs.
 * Called exactly once by entry.js at module-evaluation time.
 * @param {Object} deps entry.js-owned collaborators
 * @param {Function} deps.createSpeechUtterance builds and speak()s an
 *   utterance for the matched subtitle text
 */
export function initCaptions (deps) {
  createSpeechUtterance = deps.createSpeechUtterance;
}

// Speech-in-progress flag (moved verbatim from entry.js): true while an
// utterance is being spoken; the interval callback uses it to decide whether
// the video must be paused before speaking the next subtitle.
let isSpeechSynthesisInProgress = false;

/**
 * Clears the speech-in-progress flag. Exported because the flag is owned by
 * this module while the events that end a utterance live in entry.js: the
 * utterance onboundary/onend callbacks and the 'speech' runtime message.
 */
export const markSpeechSynthesisIdle = () => {
  isSpeechSynthesisInProgress = false;
};

const waitUntilSpeechSynthesisComplete = () => {
  return new Promise(resolve => {
    const checkStatus = () => {
      if (!isSpeechSynthesisInProgress) {
        resolve();
      } else {
        setTimeout(checkStatus, 100); // Check again after 100 milliseconds
      }
    };

    checkStatus();
  });
};

// Speech settings come from the shared store module (single storage owner);
// same async fill-in pattern as entry.js's own binding.
let speechSettings;

loadSpeechSettings().then(settings => {
  speechSettings = settings;
});

onSettingsChanged(settings => {
  speechSettings = settings;
});

// Function to extract a parameter value from a URL
export const getParameterByName = (name, url) => {
  name = name.replace(/[\[\]]/g, '\\$&');
  const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
  const results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

// toggleUntilPoTokenSet() — the unbounded CC-toggle loop — was replaced by
// the bounded, memoized waitForPot() in ./pot.js (S13); assignUrl reaches it
// through buildCaptionUrl().

const assignUrl = async (track, selectedLanguageCode) => {
  // Extract the current language code from the track.baseUrl
  const urlLanguageCode = getParameterByName('lang', track.baseUrl);

  // Caption-URL building — the bounded/memoized wait for the token plus the
  // '&pot=' (or omit-when-null) emission — lives in ./pot.js (S13).
  let basedUrl = await buildCaptionUrl(track.baseUrl);

  if (selectedLanguageCode && urlLanguageCode === selectedLanguageCode) {
    return basedUrl;
  }
  // The selectedLanguageCode does not contain the ":" character, which would never be a language code, but an EN or translated version of "Auto translate to:"
  else if (!selectedLanguageCode?.includes(":")) {
    // Code for handling selected language code
    return basedUrl + '&tlang=' + selectedLanguageCode;
  } else {
    if (selectedLanguageCode?.includes(":")) {
      speechSettings.rememberUserLastSelectedAutoTranslateToLanguageCode = urlLanguageCode;
    }
    // Code for handling the default case
    return basedUrl;
  }
}

export const binarySearch = (textElements, currentTime) => {
  let start = 0;
  let end = textElements.length - 1;

  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    const el = textElements[mid];
    const nextEl = textElements[mid + 1];
    const elStart = parseFloat(el.getAttribute('start'));
    const nextElStart = nextEl ? parseFloat(nextEl.getAttribute('start')) : Infinity;

    if (currentTime >= elStart && currentTime <= nextElStart) {
      return el;
    } else if (currentTime < elStart) {
      end = mid - 1;
    } else {
      start = mid + 1;
    }
  }

  return null;
}

export const selectCaptionFileForTTS = async (track, selectedLanguageCode = null) => {

  // this has to be inside () as it returns a promise first not a string
  let url = (await assignUrl(track, selectedLanguageCode)).replace('&kind=asr', '');
  let xml = await fetch(url).then(resp => resp.text());

  if (!xml) {
    url = await assignUrl(track, selectedLanguageCode);
    xml = await fetch(url).then(resp => resp.text());
  };

  if (xml) {
    const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
    const textElements = xmlDoc.getElementsByTagName('text');

    //Youtube sometimes has those empty UML tags. Example below:
    //<text start="41.7" dur="5.46"/>
    //compute now -> save computation later (trying to check for empty strings before passing it forward before each utterance would be "wasteful")
    Array.from(textElements).forEach(textElement => {
      if (!textElement.textContent.trim()) {
        textElement.remove();
      }
    });

    isSpeechSynthesisInProgress = false;
    let subtitlePart = '';

    const matchXmlTextToCurrentTime = async () => {
      //this will save computing cycles of iterating over an array when a video is on pause
      //commented out, as it was causing a bug
      //if (document.getElementsByClassName('video-stream')[0].paused) return;

      const currentTime = document.getElementsByClassName('video-stream')[0].currentTime;
      const matchedElement = binarySearch(textElements, currentTime);

      if (matchedElement) {
        const matchedText = matchedElement.textContent.trim();
        if (matchedText !== subtitlePart) {
          subtitlePart = matchedText;
          if (isSpeechSynthesisInProgress) {
            // previous subtitle is still being spoken, yet the time has come to speak the new subtitle. Therfore put the video on pause
            document.getElementsByClassName('video-stream')[0].pause();

            // Wait until isSpeechSynthesisInProgress becomes false
            await waitUntilSpeechSynthesisComplete();

            // resume playback of the video
            document.getElementsByClassName('video-stream')[0].play();

          }
          isSpeechSynthesisInProgress = true;
          createSpeechUtterance(matchedText);
        }
      }
    }

    clearInterval(intervalId); // Clear previous interval if exists. In order to update the interval, you need to clear the previous interval using clearInterval before setting the new interval. Simply overriding the intervalId variable without clearing the previous interval can lead to multiple intervals running simultaneously, which is likely not the desired behavior.
    setTtsIntervalId(setInterval(matchXmlTextToCurrentTime, 500)); // Set the new interval
  }
};

// downloadCaptionFile()/saveTextAsFile() moved on to ./gui.js (S16): the
// on-page download links are wired from there now, and saveTextAsFile()
// gained the URL.revokeObjectURL() cleanup after the save click.

/**
 * Caption-track discovery: fetches the watch page and extracts the
 * captionTracks array (moved verbatim from entry.js's getSubtitleList, with
 * the JSON.parse now guarded). Both a regex miss and a malformed-JSON parse
 * failure return null — the caller routes null to notifyNotFound(), so
 * malformed JSON is a notified miss instead of an uncaught throw.
 * @param {String} videoId Video ID
 * @return {Promise<Array|null>} parsed captionTracks, or null when the page
 *   carries no captionTracks or the embedded JSON is malformed
 */
export const fetchCaptionTracks = async videoId => {
  const url = 'https://www.youtube.com/watch?v=' + videoId
  const html = await fetch(url).then(resp => resp.text())
  const regex = /\{"captionTracks":(\[.*?\]),/g
  const arr = regex.exec(html)
  if (!arr) return null;
  try {
    return JSON.parse(arr[1]);
  } catch (error) {
    console.warn('[Content Script] Malformed captionTracks JSON; treating as "no subtitles":', error);
    return null;
  }
}
