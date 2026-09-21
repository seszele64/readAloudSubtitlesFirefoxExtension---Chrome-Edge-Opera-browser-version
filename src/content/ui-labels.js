// On-page GUI translation labels for the caption-download UI, extracted
// verbatim from src/content/entry.js (S10). Each dict maps a 2-letter
// navigator.language code to its label set; callers fall back to the 'en'
// entry when the user's language has no block:
//   const texts = DICT[userLanguage] || DICT['en']
//
// Provenance: the translate-dropdown's `languages` option list that used to
// sit next to these dicts in entry.js carried two "zh" entries ("Chinese
// (Simplified)" and "Chinese (Traditional)") sharing the same languageCode
// 'zh', so the second could never select anything the first did not already
// select. That duplicate was removed from entry.js in S10; the dropdown
// itself (and its `languages` list) still lives in entry.js until S17.

// Labels used by buildGui() and createSelectionLink() in entry.js.
export const GUI_TEXTS = {
  en: {
    subtitleFileDownload: 'Subtitle file download: ',
    selectSpeechSubtitles: 'Select speech subtitles to play alongside the video: ',
    AutoTranslateTo: 'Auto translate to:'
  },
  fr: {
    subtitleFileDownload: 'Téléchargement du fichier de sous-titres : ',
    selectSpeechSubtitles: 'Sélectionnez les sous-titres audio à lire avec la vidéo : ',
    AutoTranslateTo: 'Traduire automatiquement vers:'
  },
  uk: {
    subtitleFileDownload: 'Завантажити файл субтитрів: ',
    selectSpeechSubtitles: 'Виберіть мову субтитрів для відтворення поряд із відео: ',
    AutoTranslateTo: 'Автоматичний переклад на:'
  },
  ru: {
    subtitleFileDownload: 'Скачать файл субтитров: ',
    selectSpeechSubtitles: 'Выберите речевые субтитры для воспроизведения вместе с видео: ',
    AutoTranslateTo: 'Автоматический перевод на:'
  },
  tr: {
    subtitleFileDownload: 'Altyazı dosyasını indir: ',
    selectSpeechSubtitles: 'Videonun yanında oynatılacak konuşma altyazısını seçin: ',
    AutoTranslateTo: 'Şu dile otomatik çevir:'
  },
  it: {
    subtitleFileDownload: 'Download file dei sottotitoli: ',
    selectSpeechSubtitles: 'Seleziona i sottotitoli audio da riprodurre insieme al video: ',
    AutoTranslateTo: 'Traduzione automatica in:'
  },
  ko: {
    subtitleFileDownload: '자막 파일 다운로드: ',
    selectSpeechSubtitles: '비디오와 함께 재생할 음성 자막을 선택하세요: ',
    AutoTranslateTo: '다음으로 자동 번역:'
  },
  pl: {
    subtitleFileDownload: 'Pobierz plik napisów: ',
    selectSpeechSubtitles: 'Wybierz napisy mowy do odtwarzania podczas wideo: ',
    AutoTranslateTo: 'Automatyczne tłumaczenie na:'
  },
  pt: {
    subtitleFileDownload: 'Download do arquivo de legendas: ',
    selectSpeechSubtitles: 'Selecione as legendas de fala para reproduzir junto com o vídeo: ',
    AutoTranslateTo: 'Tradução automática para:'
  },
  ar: {
    subtitleFileDownload: 'تحميل ملف الترجمة: ',
    selectSpeechSubtitles: 'حدد ترجمات الكلام لتشغيلها جنبًا إلى جنب مع الفيديو: ',
    AutoTranslateTo: 'ترجمة تلقائية إلى:'
  },
  hi: {
    subtitleFileDownload: 'सबटाइटल फ़ाइल डाउनलोड करें: ',
    selectSpeechSubtitles: 'वीडियो के साथ खेलने के लिए भाषण उपशीर्षक का चयन करें: ',
    AutoTranslateTo: 'स्वतः इसका अनुवाद करें:'
  },
  zh: {
    subtitleFileDownload: '字幕文件下载：',
    selectSpeechSubtitles: '选择要与视频一起播放的语音字幕：',
    AutoTranslateTo: '自动翻译成：'
  },
  es: {
    subtitleFileDownload: 'Descargar archivo de subtítulos: ',
    selectSpeechSubtitles: 'Seleccione los subtítulos de voz para reproducir junto al video: ',
    AutoTranslateTo: 'Traducir automáticamente a:'
  },
};

// Labels used by notifyNotFound() in entry.js.
export const NOT_FOUND_TEXTS = {
  en: {
    NoSubtitleAvailableForThisVideo: 'No subtitles provided for this video'
  },
  fr: {
    NoSubtitleAvailableForThisVideo: 'Aucun sous-titre disponible pour cette vidéo'
  },
  uk: {
    NoSubtitleAvailableForThisVideo: 'Субтитрів немає для цього відео'
  },
  ru: {
    NoSubtitleAvailableForThisVideo: 'Для этого видео нет субтитров'
  },
  tr: {
    NoSubtitleAvailableForThisVideo: 'Bu video için altyazı mevcut değil'
  },
  it: {
    NoSubtitleAvailableForThisVideo: 'Nessun sottotitolo disponibile per questo video'
  },
  ko: {
    NoSubtitleAvailableForThisVideo: '이 비디오에는 자막이 없습니다'
  },
  pl: {
    NoSubtitleAvailableForThisVideo: 'Brak dostępnych napisów dla tego filmu'
  },
  pt: {
    NoSubtitleAvailableForThisVideo: 'Nenhum legenda disponível para este vídeo'
  },
  ar: {
    NoSubtitleAvailableForThisVideo: 'لا توجد ترجمة متاحة لهذا الفيديو'
  },
  hi: {
    NoSubtitleAvailableForThisVideo: 'इस वीडियो के लिए कोई उपशीर्षक उपलब्ध नहीं है'
  },
  zh: {
    NoSubtitleAvailableForThisVideo: '此视频无字幕'
  },
  es: {
    NoSubtitleAvailableForThisVideo: 'No hay subtítulos disponibles para este video'
  },
};
