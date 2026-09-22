// Popup entry (settings.html). The phase-1 build bundles this file to
// dist/settings.js and copies labels.js to dist/localization.js (settings.html
// keeps the legacy script names until S10 renames the tags). Settings state is
// owned by the shared store module and the voice list by the shared voices
// module, so the popup no longer executes content-script code (the old
// settings.html content.js tag) and has no bare speechSettings writes.

import { loadSpeechSettings, saveSpeechSettings } from '../shared/store.js';
import { whenVoicesReady } from '../shared/voices.js';

document.addEventListener('DOMContentLoaded', () => {
    let speedSlider = document.getElementById('speedSlider');
    let volumeSlider = document.getElementById('volumeSlider');
    let selectTTS = document.getElementById('engineSelect');

    // Add event listeners to the sliders
    speedSlider.addEventListener('input', handleSpeedChange);
    volumeSlider.addEventListener('input', handleVolumeChange);

    // Add event listener to the TTS engine change
    selectTTS.addEventListener('change', handleTTSvoiceChange);

    // Retrieve the stored speechSettings through the shared store module
    // (memoized load, merged with the store defaults, which include
    // rememberUserLastSelectedAutoTranslateToLanguageCode).
    // chrome.runtime.lastError is checked inside the store's storage
    // callback, never outside it.
    loadSpeechSettings().then(speechSettings => {
        // Set the slider values based on the stored speechSettings
        speedSlider.value = speechSettings.speechSpeed;
        volumeSlider.value = speechSettings.speechVolume;

        selectTTS.value = speechSettings.speechVoice;
    });

    // Function to handle speed slider change
    function handleSpeedChange(event) {
        // Persist through the shared store (read-merge-write)
        saveSpeechSettings({ speechSpeed: parseFloat(event.target.value) });
    }

    // Function to handle volume slider change
    function handleVolumeChange(event) {
        // Persist through the shared store (read-merge-write)
        saveSpeechSettings({ speechVolume: parseFloat(event.target.value) });
    }

    // Function to handle TTS voice change
    function handleTTSvoiceChange(event) {
        // Update the dropdowns in the content.js file
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { sender: 'settings', voice: event.target.value });
        });
    }

    // Function to populate the TTS engines dropdown
    function populateTTSEngines() {
        const select = document.getElementById('engineSelect');
        select.innerHTML = '';

        if ('speechSynthesis' in window) {
            // Voice list comes from the shared voices module: one
            // onvoiceschanged registration per context, bounded by a timeout
            // so a stalled voice list still yields a (possibly empty) list.
            whenVoicesReady()
                .then(voices => {
                    // Clear the existing options
                    select.innerHTML = '';

                    voices.forEach(voice => {
                        const option = document.createElement('option');
                        option.text = voice.name;
                        option.value = voice.voiceURI;
                        select.add(option);
                    });

                    // Re-apply the stored voice selection once the option list
                    // exists (the memoized load resolves from the store cache;
                    // lastError is checked in its storage callback).
                    loadSpeechSettings().then(speechSettings => {
                        if (speechSettings.speechVoice) {
                            select.value = speechSettings.speechVoice;
                        }
                    });
                })
                .catch(error => {
                    console.error('Failed to fetch voices:', error);
                });

        } else {
            const option = document.createElement('option');
            option.text = 'TTS not supported';
            option.disabled = true;
            select.add(option);
        }
    }
    // Call the function to populate the TTS engines dropdown
    populateTTSEngines();
});
