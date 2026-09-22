// On-page GUI construction + subtitle download, extracted from
// src/content/entry.js (S16): buildGui() with its DOM helpers
// (canInsert/createOutterContainer/createDownloadLink/addToCurrentPage/
// removeIfAlreadyExists/notifyNotFound) plus the download chain
// (downloadCaptionFile + saveTextAsFile) that S14 had parked in
// ./captions.js. The point of S16 (born-in): saveTextAsFile() now calls
// URL.revokeObjectURL() right after the save click, so each downloaded
// subtitle releases its Blob object URL instead of leaking it for the
// lifetime of the page.
//
// Cross-module collaborators:
// - The translate-dropdown builder (createSelectionLink + its languages
//   list) moved here from entry.js in S17 (verbatim); it is module-local,
//   reached only by buildGui().
// - GUI labels come from ./ui-labels.js (S10): buildGui()/notifyNotFound()
//   alias GUI_TEXTS/NOT_FOUND_TEXTS exactly like the pre-extraction code.
// - canInsert() owns insertPosition (the DOM anchor it found) and
//   addToCurrentPage() inserts relative to it; entry.js passes canInsert
//   on to startNavigationPolling() at the same lifecycle point as before.
// - The dropdown's collaborators arrive via plain imports (the S17 move
//   deleted the initGui() injection seam): intervalId (the ./navigation.js
//   live binding), selectCaptionFileForTTS (./captions.js) and
//   speechSettings (the shared store). S17 born-in: the dropdown's
//   remember-key write persists immediately through saveSpeechSettings()
//   instead of waiting for a later settings-message save.

import { GUI_TEXTS, NOT_FOUND_TEXTS } from './ui-labels.js';
import { convertFromTimedToSrtFormat } from '../shared/srt.js';
// Dropdown collaborators (S17 move; plain imports — no injection seam):
import { loadSpeechSettings, onSettingsChanged, saveSpeechSettings } from '../shared/store.js';
import { intervalId } from './navigation.js';
import { selectCaptionFileForTTS } from './captions.js';

// Speech settings come from the shared store module (single storage owner);
// same async fill-in pattern as entry.js's and ./captions.js's bindings —
// all subscribers share the memoized load promise and the onSettingsChanged
// stream, so every module holds the same live settings object.
let speechSettings;

loadSpeechSettings().then(settings => {
  speechSettings = settings;
});

onSettingsChanged(settings => {
  speechSettings = settings;
});

// IDs of the containers
const CONTAINER_ID = 'captionDownloadContainer'
const CONTAINER_ID2 = 'captionDownloadContainer2'

let insertPosition

/**
 * Displays a list of subtitles that the video has.
 * @param {Array} captionTracks Subtitles array.
 */
export const buildGui = captionTracks => {
  // GUI labels were extracted verbatim to ./ui-labels.js (S10); the local
  // alias keeps every lookup untouched.
  const languageTexts = GUI_TEXTS;

  removeIfAlreadyExists()

  const userLanguage = navigator.language.substring(0, 2);
  const texts = languageTexts[userLanguage] || languageTexts['en']; // Fallback to English if user language is not defined

  const container = createOutterContainer(texts.subtitleFileDownload, CONTAINER_ID);
  captionTracks.forEach(track => {
    const link = createDownloadLink(track, languageTexts)
    container.appendChild(link)
  });

  const container2 = createOutterContainer(texts.selectSpeechSubtitles, CONTAINER_ID2);
  captionTracks.forEach(track => {
    const link = createSelectionLink(track, languageTexts)
    container2.appendChild(link)
  });

  addToCurrentPage(container);
  addToCurrentPage(container2);
}


/**
 * Add HTML to the current page.
 * @param {HTMLDivElement} container container containing HTML
 */
const addToCurrentPage = container => {
  insertPosition.parentNode.insertBefore(container, insertPosition)
}


/**
 * Only 'view video' page can contain subtitle links.
 * Should only handle 'view video' page, not 'search' page, 'setting' page,...
 * TODO: Having to run according to the YouTube interface, so it should be in Popup to not be dependent.
 * @return {Boolean}
 */
export const canInsert = () => {
  const selectorList = [
    // New GUI in Firefox 103
    '#bottom-row',

    // Old GUI
    '#meta #meta-contents #container #top-row'
  ]

  // find the position above the name of the Channel
  for (const selector of selectorList) {
    insertPosition = document.querySelector(selector)
    if (insertPosition) {
      // insertPosition.style.border = '1rem solid #000'
      return true
    }
  }

  return false
}


/**
 * Create the outter container
 * @param {String} text String of display labels
 * @return {HTMLDivElement}
 */
const createOutterContainer = (text, id) => {
  const container = document.createElement('div')
  container.setAttribute('id', id)
  container.style.padding = '5px 5px 5px 0'
  container.style.margin = '5px 0'
  container.style.fontSize = '1.4rem'
  container.style.overflowWrap = 'break-word'
  container.style.whiteSpace = 'break-spaces'
  container.style.lineHeight = 1
  container.textContent = text
  return container
}


/**
 * Create download link.
 * @param {Object} track subtitle object
 * @return {HTMLLinkElement}
 */
const createDownloadLink = track => {
  const link = document.createElement('a')
  // Don't use the track.languageCode attribute because it's code
  // The track.name.simpleText property is always visible (auto-generated)
  // Also can check by attribute track.kind is asr
  link.textContent = track.name.simpleText
  link.href = 'javascript:;'
  link.title = 'Please click to download'

  // CSS
  link.style.marginLeft = '5px'
  link.style.cursor = 'pointer'
  link.style.color = 'var(--yt-endpoint-hover-color,var(--yt-spec-call-to-action))'
  link.style.fontSize = '1.4rem'
  link.style.textDecoration = 'none'

  // Click to download
  link.addEventListener('click', () => {
    downloadCaptionFile(track)
  })
  return link
}

// Translate dropdown, moved verbatim from entry.js (S17): builds the
// checkbox + track label + auto-translate dropdown row shown under the
// "speech subtitles" container. Collaborators (intervalId,
// selectCaptionFileForTTS, speechSettings) come from the imports above.
const createSelectionLink = (track, languageTexts) => {
  const languages = [
    { languageCode: "af", languageName: "Afrikaans" },
    { languageCode: "ak", languageName: "Akan" },
    { languageCode: "sq", languageName: "Albanian" },
    { languageCode: "am", languageName: "Amharic" },
    { languageCode: "ar", languageName: "Arabic" },
    { languageCode: "hy", languageName: "Armenian" },
    { languageCode: "as", languageName: "Assamese" },
    { languageCode: "ay", languageName: "Aymara" },
    { languageCode: "az", languageName: "Azerbaijani" },
    { languageCode: "bn", languageName: "Bangla" },
    { languageCode: "eu", languageName: "Basque" },
    { languageCode: "be", languageName: "Belarusian" },
    { languageCode: "bho", languageName: "Bhojpuri" },
    { languageCode: "bs", languageName: "Bosnian" },
    { languageCode: "bg", languageName: "Bulgarian" },
    { languageCode: "my", languageName: "Burmese" },
    { languageCode: "ca", languageName: "Catalan" },
    { languageCode: "ceb", languageName: "Cebuano" },
    { languageCode: "zh", languageName: "Chinese (Simplified)" },
    { languageCode: "co", languageName: "Corsican" },
    { languageCode: "hr", languageName: "Croatian" },
    { languageCode: "cs", languageName: "Czech" },
    { languageCode: "da", languageName: "Danish" },
    { languageCode: "dv", languageName: "Divehi" },
    { languageCode: "nl", languageName: "Dutch" },
    { languageCode: "en", languageName: "English" },
    { languageCode: "eo", languageName: "Esperanto" },
    { languageCode: "et", languageName: "Estonian" },
    { languageCode: "ee", languageName: "Ewe" },
    { languageCode: "fil", languageName: "Filipino" },
    { languageCode: "fi", languageName: "Finnish" },
    { languageCode: "fr", languageName: "French" },
    { languageCode: "gl", languageName: "Galician" },
    { languageCode: "lg", languageName: "Ganda" },
    { languageCode: "ka", languageName: "Georgian" },
    { languageCode: "de", languageName: "German" },
    { languageCode: "el", languageName: "Greek" },
    { languageCode: "gn", languageName: "Guarani" },
    { languageCode: "gu", languageName: "Gujarati" },
    { languageCode: "ht", languageName: "Haitian Creole" },
    { languageCode: "ha", languageName: "Hausa" },
    { languageCode: "haw", languageName: "Hawaiian" },
    { languageCode: "iw", languageName: "Hebrew" },
    { languageCode: "hi", languageName: "Hindi" },
    { languageCode: "hmn", languageName: "Hmong" },
    { languageCode: "hu", languageName: "Hungarian" },
    { languageCode: "is", languageName: "Icelandic" },
    { languageCode: "ig", languageName: "Igbo" },
    { languageCode: "id", languageName: "Indonesian" },
    { languageCode: "ga", languageName: "Irish" },
    { languageCode: "it", languageName: "Italian" },
    { languageCode: "ja", languageName: "Japanese" },
    { languageCode: "jv", languageName: "Javanese" },
    { languageCode: "kn", languageName: "Kannada" },
    { languageCode: "kk", languageName: "Kazakh" },
    { languageCode: "km", languageName: "Khmer" },
    { languageCode: "rw", languageName: "Kinyarwanda" },
    { languageCode: "ko", languageName: "Korean" },
    { languageCode: "kri", languageName: "Krio" },
    { languageCode: "ku", languageName: "Kurdish" },
    { languageCode: "ky", languageName: "Kyrgyz" },
    { languageCode: "lo", languageName: "Lao" },
    { languageCode: "la", languageName: "Latin" },
    { languageCode: "lv", languageName: "Latvian" },
    { languageCode: "ln", languageName: "Lingala" },
    { languageCode: "lt", languageName: "Lithuanian" },
    { languageCode: "lb", languageName: "Luxembourgish" },
    { languageCode: "mk", languageName: "Macedonian" },
    { languageCode: "mg", languageName: "Malagasy" },
    { languageCode: "ms", languageName: "Malay" },
    { languageCode: "ml", languageName: "Malayalam" },
    { languageCode: "mt", languageName: "Maltese" },
    { languageCode: "mi", languageName: "Māori" },
    { languageCode: "mr", languageName: "Marathi" },
    { languageCode: "mn", languageName: "Mongolian" },
    { languageCode: "ne", languageName: "Nepali" },
    { languageCode: "nso", languageName: "Northern Sotho" },
    { languageCode: "no", languageName: "Norwegian" },
    { languageCode: "ny", languageName: "Nyanja" },
    { languageCode: "or", languageName: "Odia" },
    { languageCode: "om", languageName: "Oromo" },
    { languageCode: "ps", languageName: "Pashto" },
    { languageCode: "fa", languageName: "Persian" },
    { languageCode: "pl", languageName: "Polish" },
    { languageCode: "pt", languageName: "Portuguese" },
    { languageCode: "pa", languageName: "Punjabi" },
    { languageCode: "qu", languageName: "Quechua" },
    { languageCode: "ro", languageName: "Romanian" },
    { languageCode: "ru", languageName: "Russian" },
    { languageCode: "sm", languageName: "Samoan" },
    { languageCode: "sa", languageName: "Sanskrit" },
    { languageCode: "gd", languageName: "Scottish Gaelic" },
    { languageCode: "sr", languageName: "Serbian" },
    { languageCode: "sn", languageName: "Shona" },
    { languageCode: "sd", languageName: "Sindhi" },
    { languageCode: "si", languageName: "Sinhala" },
    { languageCode: "sk", languageName: "Slovak" },
    { languageCode: "sl", languageName: "Slovenian" },
    { languageCode: "so", languageName: "Somali" },
    { languageCode: "st", languageName: "Southern Sotho" },
    { languageCode: "es", languageName: "Spanish" },
    { languageCode: "su", languageName: "Sundanese" },
    { languageCode: "sw", languageName: "Swahili" },
    { languageCode: "sv", languageName: "Swedish" },
    { languageCode: "tg", languageName: "Tajik" },
    { languageCode: "ta", languageName: "Tamil" },
    { languageCode: "tt", languageName: "Tatar" },
    { languageCode: "te", languageName: "Telugu" },
    { languageCode: "th", languageName: "Thai" },
    { languageCode: "ti", languageName: "Tigrinya" },
    { languageCode: "ts", languageName: "Tsonga" },
    { languageCode: "tr", languageName: "Turkish" },
    { languageCode: "tk", languageName: "Turkmen" },
    { languageCode: "uk", languageName: "Ukrainian" },
    { languageCode: "ur", languageName: "Urdu" },
    { languageCode: "ug", languageName: "Uyghur" },
    { languageCode: "uz", languageName: "Uzbek" },
    { languageCode: "vi", languageName: "Vietnamese" },
    { languageCode: "cy", languageName: "Welsh" },
    { languageCode: "fy", languageName: "Western Frisian" },
    { languageCode: "xh", languageName: "Xhosa" },
    { languageCode: "yi", languageName: "Yiddish" },
    { languageCode: "yo", languageName: "Yoruba" },
    { languageCode: "zu", languageName: "Zulu" }]

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `checkbox_${track.name.simpleText.replace(/\s/g, '_')}`;
  checkbox.style.marginLeft = '0px';

  const label = document.createElement('label');
  label.textContent = track.name.simpleText;
  label.htmlFor = checkbox.id;
  label.style.cursor = 'pointer';
  label.style.fontSize = '1.4rem';
  label.style.color = "var(--yt-formatted-string-bold-color,inherit)"
  label.style.fontWeight = "var(--yt-formatted-string-bold-font-weight,500)"
  label.style.lineHeight = "2rem"

  const dropdown = document.createElement('select');
  dropdown.id = `dropdown_${track.name.simpleText.replace(/\s/g, '_')}`;
  dropdown.style.cursor = 'pointer';
  dropdown.style.marginLeft = '10px';

  const defaultOption = document.createElement('option');

  const userLanguage = navigator.language.substring(0, 2);
  const texts = languageTexts[userLanguage] || languageTexts['en']; // Fallback to English if user language is not define

  if (speechSettings.rememberUserLastSelectedAutoTranslateToLanguageCode !== null) {
    for (const language of languages) {
      if (language.languageCode == speechSettings.rememberUserLastSelectedAutoTranslateToLanguageCode) {
        defaultOption.value = language.languageCode;
        defaultOption.text = language.languageName;
        break;
      }
    }
  } else { defaultOption.text = texts.AutoTranslateTo; }

  dropdown.add(defaultOption);

  languages.forEach((language) => {
    const option = document.createElement('option');
    option.value = language.languageCode;
    option.text = language.languageName;
    dropdown.add(option);
  });

  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.appendChild(checkbox);
  container.appendChild(label);
  container.appendChild(dropdown);

  let selectedLanguageCode = null;

  // Click event listener for the checkbox
  checkbox.addEventListener('change', () => {
    clearInterval(intervalId);
    window.speechSynthesis.cancel();

    if (checkbox.checked) {

      // Retrieve the selected language code from the dropdown
      const selectedLanguageCode = dropdown.value;

      if (selectedLanguageCode) {
        selectCaptionFileForTTS(track, selectedLanguageCode);
      } else if (speechSettings.rememberUserLastSelectedAutoTranslateToLanguageCode !== null) {
        selectCaptionFileForTTS(track, speechSettings.rememberUserLastSelectedAutoTranslateToLanguageCode);
      }
      else {
        selectCaptionFileForTTS(track);
      }

      // Deselect other checkboxes
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((otherCheckbox) => {
        if (otherCheckbox !== checkbox) {
          otherCheckbox.checked = false;
        }
      });
    }
  });

  // Change event listener for the dropdown
  dropdown.addEventListener('change', () => {
    clearInterval(intervalId);
    window.speechSynthesis.cancel();

    if (dropdown.value === '') {
      selectedLanguageCode = null;
    } else {
      selectedLanguageCode = dropdown.value;

      const dropdowns = document.querySelectorAll('[id^="dropdown_"]');

      // Get the value of the dropdown this was called from
      const value = dropdown.value;

      // Loop through the other dropdowns using forEach
      dropdowns.forEach((dropdown) => {
        // Set the value of the other dropdowns to the value of the first dropdown
        dropdown.value = value;
      });
    }
    speechSettings.rememberUserLastSelectedAutoTranslateToLanguageCode = selectedLanguageCode;

    // S17 born-in: persist the remember-key immediately through the store.
    // (Pre-extraction, this write only mutated the shared in-memory object;
    // it reached storage whenever a later settings-message save happened.)
    // One-field patch (not the full object) so a stale binding cannot clobber
    // popup-written keys — mirrors the tts.js:115 patch pattern.
    saveSpeechSettings({
      rememberUserLastSelectedAutoTranslateToLanguageCode: selectedLanguageCode,
    });

    checkbox.checked = true;

    //below is important, as `checkbox.checked = true` doesn't trigger event listener for some reason
    selectCaptionFileForTTS(track, selectedLanguageCode);

  });

  return container;
};

/**
 * Check if the container already exists (so we don't have to process again).
 */
const removeIfAlreadyExists = () => {

  const container = document.getElementById(CONTAINER_ID)
  if (container != null) container.parentNode.removeChild(container);

  const container2 = document.getElementById(CONTAINER_ID2)
  if (container2 != null) container2.parentNode.removeChild(container2);
}


/**
 * Notify that there is no subtitle.
 */
export const notifyNotFound = () => {
  // "No subtitles" labels were extracted verbatim to ./ui-labels.js (S10);
  // the local alias keeps the lookup below untouched.
  const languageTexts = NOT_FOUND_TEXTS;

  const userLanguage = navigator.language.substring(0, 2);
  const text = languageTexts[userLanguage] || languageTexts['en']; // Fallback to English if user language is not defined

  removeIfAlreadyExists()
  const container = createOutterContainer(text.NoSubtitleAvailableForThisVideo, CONTAINER_ID)
  addToCurrentPage(container)
}

/**
 * Download subtitle files.
 * @param {Object} track subtitle object
 */
export const downloadCaptionFile = async track => {
  const url = track.baseUrl
  const xml = await fetch(url).then(resp => resp.text())
  const content = convertFromTimedToSrtFormat(xml)
  const fileName = document.title.replace(/ - YouTube/gi, '') + '.' + track.languageCode + '.srt'
  saveTextAsFile(content, fileName)
}

/**
 * Save text file (by JS).
 * @param {String} text The content of the text to be saved
 * @param {String} fileName Filename
 */
export const saveTextAsFile = (text, fileName) => {
  const textFileAsBlob = new Blob([text], { type: 'text/plain' })
  const hrefLink = window.URL.createObjectURL(textFileAsBlob)

  const downloadLink = document.createElement('a')
  downloadLink.download = fileName
  downloadLink.textContent = 'Download file'
  downloadLink.href = hrefLink
  downloadLink.style.display = 'none'
  downloadLink.addEventListener('click', evt => {
    document.body.removeChild(evt.target)
  })
  document.body.appendChild(downloadLink)
  downloadLink.click()

  // S16 born-in: the Blob URL has served its purpose once the click handed
  // the download off to the browser; revoking it here releases the Blob
  // instead of leaking one object URL per downloaded subtitle file.
  window.URL.revokeObjectURL(hrefLink)
}
