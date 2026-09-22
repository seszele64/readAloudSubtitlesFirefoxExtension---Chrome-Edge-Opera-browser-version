import { getSpeechSettings, loadSpeechSettings, onSettingsChanged, saveSpeechSettings } from '../shared/store.js';
import { extractLanguageCode } from '../shared/lang.js';
// unescapeHTML (wire text cleanup) moved with the speech chain to ./tts.js (S15);
// srt.js is still reachable from here through ./gui.js's download path.
import { findVoiceByVoiceURI } from '../shared/voices.js';
// Ad-skip watchdog lives in ./adskip.js (S11); single registration below.
import { startAdSkip } from './adskip.js';
// URL-poll loop lives in ./navigation.js (S12); started once below, now
// behind the S23 store-ready gate (the poll no longer runs before the
// shared settings store has filled its bindings).
import { startNavigationPolling, intervalId } from './navigation.js';
// POT capture (injected-probe injection, FoundPOT listener, bounded token
// wait) + caption-URL '&pot=' emission live in ./pot.js (S13).
import { injectPotProbe, startPotCapture } from './pot.js';
// Caption-track discovery (fetchCaptionTracks: regex + guarded JSON.parse)
// and TTS caption selection (selectCaptionFileForTTS + assignUrl +
// binarySearch + getParameterByName) live in ./captions.js (S14); the
// speech-in-progress flag is owned by captions.js and cleared from
// tts.js/here through markSpeechSynthesisIdle().
import {
  fetchCaptionTracks,
  initCaptions,
  markSpeechSynthesisIdle
} from './captions.js';
// TTS speech construction (createSpeechUtterance) lives in ./tts.js (S15)
// and is injected once into ./captions.js via initCaptions() below.
import { createSpeechUtterance } from './tts.js';

// On-page GUI construction (buildGui/notifyNotFound + DOM helpers), the
// download chain (downloadCaptionFile + saveTextAsFile, S16) and the
// translate-dropdown builder (createSelectionLink, moved there in S17)
// live in ./gui.js; saveTextAsFile revokes its Blob object URL after the
// save click. canInsert comes back from there for startNavigationPolling().
import { canInsert, buildGui, notifyNotFound } from './gui.js';

// The injected probe + FoundPOT wiring live in ./pot.js (S13). They are
// registered exactly once here, at the same top-level lifecycle point where
// the bare injection/listener code used to run.
injectPotProbe();
startPotCapture();

let speechSettings;

// intervalId (the TTS subtitle-sync interval handle) is a single shared
// binding owned by ./navigation.js (S12): the URL poll clears it on
// navigation. selectCaptionFileForTTS (./captions.js, S14) writes it via
// setTtsIntervalId() and reads the live imported binding.

// Speech settings come from the shared store module (single storage owner).
// S23: there is no fire-and-forget fill-in any more. Both the bootstrap
// (below) and the settings-message handler await this gate before any
// read/write, so the first caption/TTS action never observes the
// half-initialized (undefined) binding the old fill-in left open.
// getSpeechSettings() returns the store's CURRENT live object (onChanged
// re-points the cache as writers land), so the binding is only filled from
// the memoized load promise before it has resolved the first time —
// re-assigning from that promise later would restore a stale pre-onChanged
// object while the other modules hold the live one.
const syncSpeechSettingsFromStore = async () => {
  if (getSpeechSettings() === null) {
    await loadSpeechSettings();
  }
  speechSettings = getSpeechSettings();
};

// Kept in sync with storage changes through onSettingsChanged — the store's
// single-listener multiplexer (the only underlying storage-change listener
// registration in this content context; no module here ever registers its
// own).
onSettingsChanged(settings => {
  speechSettings = settings;
});

// Voice list ownership lives in src/shared/voices.js: it holds the single
// onvoiceschanged registration and exposes null-safe lookups, so nothing
// here races the asynchronous voice loading any more.

// findVoiceByVoiceURI (src/shared/voices.js) is the null-safe lookup the
// settings-message handler below uses; findLocalVoice moved with the speech
// chain to ./tts.js (S15).

// saveTextAsFile()/downloadCaptionFile() live in ./gui.js (S16).

// The URL-poll loop (currentUrl/getParameter/extractVideoId/checkSubtitle)
// lives in ./navigation.js (S12).

/**
 * @param {String} videoId Video ID
 */
const getSubtitleList = async videoId => {
  const captionTracks = await fetchCaptionTracks(videoId);
  // null covers both a regex miss and (since S14) malformed captionTracks
  // JSON — fetchCaptionTracks() guards the JSON.parse in try/catch — so the
  // user gets the notified "no subtitles" message instead of an uncaught
  // JSON.parse throw.
  captionTracks == null ? notifyNotFound() : buildGui(captionTracks);
}

// The ad-skip watchdog was extracted verbatim to ./adskip.js (S11). It is
// registered exactly once here, at the same top-level lifecycle point where
// the original bare interval used to run.
startAdSkip()

// The TTS speech chain (createSpeechUtterance, owned by ./tts.js since S15)
// is injected into ./captions.js exactly once here, before the poll/UI can
// reach selectCaptionFileForTTS().
initCaptions({ createSpeechUtterance })

// The URL-poll loop lives in ./navigation.js (S12); it is started exactly
// once, behind the S23 store-ready gate: the poll — and every caption/TTS
// action its first 500 ms tick can trigger (buildGui()'s remember-key read
// in ./gui.js, selectCaptionFileForTTS()'s remember-key write in
// ./captions.js, createSpeechUtterance()'s voice lookups in ./tts.js) —
// starts only after the store's memoized load has resolved, so no first
// action ever sees the pre-load speechSettings binding that used to throw.
;(async () => {
  await syncSpeechSettingsFromStore();
  startNavigationPolling({ canInsert, getSubtitleList });
})()

// Listen for messages from the settings.js file
chrome.runtime.onMessage.addListener(function (message) {
  if (message.sender === 'settings') {
    clearInterval(intervalId);

    // S23: the handler runs behind the same store-ready gate as the
    // navigation poll — a settings ping arriving before the memoized load
    // has resolved waits for it here instead of touching the
    // half-initialized binding.
    (async () => {
      await syncSpeechSettingsFromStore();

      const speechVoice = message.voice;

      speechSettings.speechVoice = speechVoice;

      const dropdowns = document.querySelectorAll('[id^="dropdown_"]');

      // Null-guarded lookup (shared/voices.js): with an empty voice list
      // (voices not loaded yet) or an unknown voiceURI it returns null —
      // never throws. languageCode then stays null and the dropdown
      // selection below is left untouched.
      const foundVoice = findVoiceByVoiceURI(speechVoice);
      const languageCode = foundVoice ? extractLanguageCode(foundVoice.lang) : null;

      // S23: one read-merge-write through the store persists exactly the
      // fields this message changed (the remember-key update used to rely
      // on a later full-object save; it now rides along in the same patch,
      // which cannot clobber sibling keys another context changed in
      // storage since our last onChanged sync). The in-place writes keep
      // every module's shared live-settings object coherent until the
      // onChanged round-trip re-points the bindings.
      const patch = { speechVoice };
      if (languageCode !== null) {
        speechSettings.rememberUserLastSelectedAutoTranslateToLanguageCode = languageCode;
        patch.rememberUserLastSelectedAutoTranslateToLanguageCode = languageCode;
      }
      saveSpeechSettings(patch);

      dropdowns.forEach(function (dropdown) {
        // Find the option with the matching languageCode; languageCode holds
        // the already-extracted code, or null when the voice was not found
        // (in which case the dropdown selection is left untouched)
        const selectedOption = languageCode === null
          ? undefined
          : Array.from(dropdown.options).find(option => option.value === languageCode);

        // Set the selectedIndex of the dropdown to the index of the selected option
        if (selectedOption) {
          dropdown.selectedIndex = selectedOption.index;
        }

        // Assuming the checkbox was created as a sibling of the dropdown within the same container
        const container = dropdown.parentNode;
        const checkbox = container.querySelector('input[type="checkbox"]');
        // F3: dispatch only when the dropdown above was actually updated
        // (selectedOption is undefined when languageCode is null or no
        // option matched). Re-dispatching on a stale selectedIndex would
        // re-speak with the previous language.
        if (selectedOption && checkbox?.checked) {
          //checks if it was checked
          // Trigger the 'change' event on the checkbox. I had to do it that way, as checkbox.checked = isChecked wasn't triggering an event - checked with the debugger!
          checkbox.dispatchEvent(new Event('change'));
        }
      });
    })();
  }
  if (message.sender === 'speech') {
    // The speech-in-progress flag is owned by ./captions.js (S14); the
    // settings-page 'speech' ping clears it through the exported helper.
    markSpeechSynthesisIdle();
  }
});