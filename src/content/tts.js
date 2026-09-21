// TTS speech chain, extracted verbatim from src/content/entry.js (S15):
// createSpeechUtterance() builds the utterance for a matched subtitle line
// and resolves the voice; updateSettingsAndSpeak() is the settings-and-speak
// glue (rate/volume, speed rescaling for non-local voices, persistence, and
// the onboundary/onend hooks that clear the speech-in-progress flag owned by
// ./captions.js via markSpeechSynthesisIdle()).
//
// speakWithGoogleVoice() and the GoogleTranslate_* branches inside
// createSpeechUtterance() are a dead path (remote GoogleTranslate_ voices no
// longer work) kept verbatim — S21 deletes them.
//
// speechSettings comes from the shared store (single storage owner); the
// local binding mirrors entry.js's and captions.js's: filled from the same
// memoized loadSpeechSettings() promise and the same onSettingsChanged
// stream, so all bindings reference the same live settings object and
// in-place mutations stay visible without a save round-trip.

import { loadSpeechSettings, onSettingsChanged, saveSpeechSettings } from '../shared/store.js';
import { unescapeHTML } from '../shared/srt.js';
import { findLocalVoice, findVoiceByVoiceURI } from '../shared/voices.js';
import { markSpeechSynthesisIdle } from './captions.js';

let speechSettings;

loadSpeechSettings().then(settings => {
  speechSettings = settings;
});

onSettingsChanged(settings => {
  speechSettings = settings;
});

// important as Microsoft voices and Chrome Google voices speeds are different, yet both have a parameter of 
// utterance.voice.localService === false
const isEdge = navigator.userAgent.includes("Edg");

const speakWithGoogleVoice = (langCode, utterance) => {
  const message = {
    info: {
      selectionText: utterance.text,
      lang: langCode
    }
  };
  chrome.runtime.sendMessage(message);
  speechSettings.speechVoice = "GoogleTranslate_" + langCode;
  saveSpeechSettings(speechSettings);
}

export const updateSettingsAndSpeak = (voice, utterance) => {
  utterance.voice = voice;

  utterance.rate = speechSettings.speechSpeed;
  utterance.volume = speechSettings.speechVolume;

  (voice === null) ? speechSettings.speechVoice = voice : speechSettings.speechVoice = voice.voiceURI;

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

  saveSpeechSettings(speechSettings);

  //this fires right at the stop of an utterance (regrdless if it has a dot at the end or not (so don't be confusted with event.name === 'sentence' - it also never fires when it finds a dot in the middle of an utterance)).
  //before the code used utterance.onend() which fires after the end of utterance + some pause(!). Measured how long is such a pause compared to the utterance.onboudary - average((1698285598420−1698285596014)/1000,(1698285595876−1698285593813)/1000,(1698285593568−1698285590890)/1000)) = 2.382 333 333 seconds, which is way more than expected. So the below method is superior and causes the video to be paused way less often (lowest speed setting, 1 minute video, presentation - paused once vs 7 times (although those were very short pauses)).
  utterance.onboundary = function (event) {
    if (event.name === 'sentence') {
      // The speech-in-progress flag is owned by ./captions.js (S14); the
      // utterance callbacks clear it through the exported helper.
      markSpeechSynthesisIdle();
    }
  };

  //it seem that remote google voices don't work with utterance.onboundary at all, yet they do work with utterance.onend
  utterance.onend = () => {
    markSpeechSynthesisIdle();
  }

  speechSynthesis.speak(utterance);
}

export const createSpeechUtterance = (matchedText) => {
  const cleanedString = matchedText.replace(/<\/?(i|b|u)>/gi, '');
  const utterance = new SpeechSynthesisUtterance(unescapeHTML(cleanedString.replace(/\n/g, "").replace(/\\"/g, '"').trim().replace(/[,\.]+$/, '').replace(/\r/g, "")));

  const langCode = speechSettings.rememberUserLastSelectedAutoTranslateToLanguageCode;
  const voice = findVoiceByVoiceURI(speechSettings.speechVoice);
  const localVoice = findLocalVoice(langCode);

  if (langCode !== null) {
    if (speechSettings?.speechVoice?.startsWith("GoogleTranslate_")) {
      if (speechSettings.speechVoice.replace("GoogleTranslate_", "") === langCode || !localVoice) {
        speakWithGoogleVoice(langCode, utterance);
      } else {
        updateSettingsAndSpeak(localVoice, utterance);
      }
    } else if (!speechSettings.speechVoice && localVoice) {
      updateSettingsAndSpeak(localVoice, utterance);
    } else if (voice?.lang.startsWith(langCode)) {
      updateSettingsAndSpeak(voice, utterance);
    } else if (localVoice) {
      updateSettingsAndSpeak(localVoice, utterance);
    } else {
      speakWithGoogleVoice(langCode, utterance);
    }
  } else if (speechSettings.speechVoice?.startsWith("GoogleTranslate_")) {
    speakWithGoogleVoice(speechSettings.speechVoice.replace("GoogleTranslate_", ""), utterance);
  } else if (voice) {
    updateSettingsAndSpeak(voice, utterance);
  } else {
    updateSettingsAndSpeak(null, utterance);
  }
}
