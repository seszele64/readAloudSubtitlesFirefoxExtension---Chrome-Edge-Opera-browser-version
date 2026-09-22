// TTS speech chain, extracted verbatim from src/content/entry.js (S15):
// createSpeechUtterance() builds the utterance for a matched subtitle line
// and resolves the voice; updateSettingsAndSpeak() is the settings-and-speak
// glue (rate/volume, speed rescaling for non-local voices, persistence, and
// the onboundary/onend hooks that clear the speech-in-progress flag owned by
// ./captions.js via markSpeechSynthesisIdle()).
//
// S21 deleted the dead remote-Google-TTS path (its chrome.runtime message
// side effect went with it): voice resolution now always lands on a usable
// local voice or the browser default. A stored speechVoice that is null or
// unknown falls back to findLocalVoice() — first for the remembered
// auto-translate target language (the language the utterance text is in),
// then for the utterance's own language; when that yields nothing too, a
// null voice lets the browser pick its default. Legacy stored remote-Google
// voice values never reach this module: shared/store.js
// (normalizeLegacyVoice) rewrites them to null at load.
//
// S24 (voices race): Chrome populates the speechSynthesis voice list
// asynchronously, so the first utterance after a cold content-script load
// used to resolve every voice lookup below against an empty list — the
// browser default was spoken and updateSettingsAndSpeak()'s patch save
// persisted speechVoice: null over the user's stored choice. The speak path
// now awaits whenVoicesReady() (shared/voices.js: resolves immediately once
// the list is populated, otherwise on onvoiceschanged or after a bounded
// timeout) before resolving the voice. The wait is memoized, so only the
// first speak after load pays it; a wait that still ends on an empty list
// logs a console.info and speaks the browser default — no silent no-speak,
// no throw.
//
// speechSettings comes from the shared store (single storage owner); the
// local binding mirrors entry.js's and captions.js's: filled from the same
// memoized loadSpeechSettings() promise and the same onSettingsChanged
// stream, so all bindings reference the same live settings object and
// in-place mutations stay visible without a save round-trip.

import { loadSpeechSettings, onSettingsChanged, saveSpeechSettings } from '../shared/store.js';
import { unescapeHTML } from '../shared/srt.js';
import { findLocalVoice, findVoiceByVoiceURI, whenVoicesReady } from '../shared/voices.js';
import { markSpeechSynthesisIdle } from './captions.js';

let speechSettings;

loadSpeechSettings().then(settings => {
  speechSettings = settings;
});

onSettingsChanged(settings => {
  speechSettings = settings;
});

// S24: bounded first-speak wait for Chrome's asynchronous voice list (see
// the header note above). Memoized so exactly the first speak after a cold
// load waits — once the wait has settled, later utterances never wait again,
// even when the wait timed out on a still-empty list (otherwise every
// subtitle line would each pay the full timeout before speaking).
const VOICES_READY_TIMEOUT_MS = 2000;

let voicesReadyPromise = null;

const waitForVoicesReady = () => {
  if (voicesReadyPromise === null) {
    voicesReadyPromise = whenVoicesReady(VOICES_READY_TIMEOUT_MS).then(voices => {
      if (voices.length === 0) {
        // Graceful timeout path (whenVoicesReady never rejects): the speak
        // below still runs — with the browser default voice — so this is
        // neither a silent no-speak nor a throw.
        console.info('[Content Script] TTS voice list still empty after', VOICES_READY_TIMEOUT_MS, 'ms; speaking with the browser default voice.');
      }
      return voices;
    });
  }
  return voicesReadyPromise;
};

// important as Microsoft voices and Chrome Google voices speeds are different, yet both have a parameter of 
// utterance.voice.localService === false
const isEdge = navigator.userAgent.includes("Edg");

export const updateSettingsAndSpeak = (voice, utterance) => {
  utterance.voice = voice;

  utterance.rate = speechSettings.speechSpeed;
  utterance.volume = speechSettings.speechVolume;

  // S23: resolve the voiceURI once; the in-place write keeps every module's
  // shared live-settings object coherent immediately (captions/gui/entry
  // reference the same object), while the patch save below persists exactly
  // this one field — the full-object save it replaces could clobber sibling
  // keys another context (e.g. the popup) changed in storage since our last
  // onChanged sync.
  const speechVoiceURI = (voice === null) ? null : voice.voiceURI;
  speechSettings.speechVoice = speechVoiceURI;

  if ((utterance.voice?.localService === false && !isEdge) || (!utterance.voice && !isEdge)) {
    // Assuming speechSettings.speechSpeed is within the range of 1.7-3
    const originalSpeechSpeed = speechSettings.speechSpeed;
    const minRange1 = 1.7;  // Minimum value of the original range
    const maxRange1 = 3;    // Maximum value of the original range
    const minRange2 = 1;  // Minimum value of the target range
    const maxRange2 = 1.4;  // Maximum value of the target range. 1.5 for example is totaly uniteligible in case of google voices EN/PL I understand, and I'm used to to watching stuff at x2 speeds, so that x1.5 must be equivalent of a x3.5 if not more

    // Scale the value to the target range
    const scaledSpeechSpeed = ((originalSpeechSpeed - minRange1) / (maxRange1 - minRange1)) * (maxRange2 - minRange2) + minRange2;

    // Round the result to one decimal place
    const roundedSpeechSpeed = Math.round(scaledSpeechSpeed * 10) / 10;

    // Use the roundedSpeed value
    utterance.rate = roundedSpeechSpeed
  }

  // S23 patch save: persists exactly the resolved voice field (see note at
  // the speechVoiceURI write above); speechSettings itself is untouched
  // beyond the in-place write, so no other key can be clobbered here.
  saveSpeechSettings({ speechVoice: speechVoiceURI });

  //this fires right at the stop of an utterance (regrdless if it has a dot at the end or not (so don't be confusted with event.name === 'sentence' - it also never fires when it finds a dot in the middle of an utterance)).
  //before the code used utterance.onend() which fires after the end of utterance + some pause(!). Measured how long is such a pause compared to the utterance.onboudary - average((1698285598420−1698285596014)/1000,(1698285595876−1698285593813)/1000,(1698285593568−1698285590890)/1000)) = 2.382 333 333 seconds, which is way more than expected. So the below method is superior and causes the video to be paused way less often (lowest speed setting, 1 minute video, presentation - paused once vs 7 times (although those were very short pauses)).
  utterance.onboundary = function (event) {
    if (event.name === 'sentence') {
      // The speech-in-progress flag is owned by ./captions.js (S14); the
      // utterance callbacks clear it through the exported helper.
      markSpeechSynthesisIdle();
    }
  };

  //onboundary clears the speech-in-progress flag at the first sentence
  //boundary; utterance.onend (which fires late — see above) is kept as the
  //safety net for utterances that never fire a sentence boundary event
  //(markSpeechSynthesisIdle is a plain flag write, so the double clear is
  //harmless).
  utterance.onend = () => {
    markSpeechSynthesisIdle();
  }

  speechSynthesis.speak(utterance);
}

export const createSpeechUtterance = async (matchedText) => {
  // S24: first speak waits for the (possibly empty) voice list before the
  // lookups below; with the list already populated this settles on the next
  // microtask. Awaits never throw here — whenVoicesReady() always resolves
  // (shared/voices.js), so the speak chain below always runs.
  await waitForVoicesReady();

  const cleanedString = matchedText.replace(/<\/?(i|b|u)>/gi, '');
  const utterance = new SpeechSynthesisUtterance(unescapeHTML(cleanedString.replace(/\n/g, "").replace(/\\"/g, '"').trim().replace(/[,\.]+$/, '').replace(/\r/g, "")));

  const langCode = speechSettings.rememberUserLastSelectedAutoTranslateToLanguageCode;
  const voice = findVoiceByVoiceURI(speechSettings.speechVoice);

  if (langCode !== null) {
    // An auto-translate target language is remembered, so the utterance text
    // is in that language: the stored voice speaks only when it matches the
    // language; otherwise the first local voice for the language does.
    if (voice?.lang.startsWith(langCode)) {
      updateSettingsAndSpeak(voice, utterance);
    } else {
      updateSettingsAndSpeak(findLocalVoice(langCode), utterance);
    }
  } else if (voice) {
    updateSettingsAndSpeak(voice, utterance);
  } else {
    // Null/unknown stored voice (fresh install, stale voiceURI, or a legacy
    // remote-Google voice value normalized to null by shared/store.js): fall
    // back to the first local voice for the utterance's own language, or null
    // (the browser default voice) when nothing matches.
    updateSettingsAndSpeak(findLocalVoice(utterance.lang), utterance);
  }
}
