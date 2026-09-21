// Ad-skip watchdog, extracted verbatim from src/content/entry.js (S11). The
// 1-second interval clicks overlay-banner close buttons, hides side ads,
// clicks the skip button, hides the incoming-ad message, removes companion
// slots, and fast-forwards unskippable ads (playbackRate 16).
//
// Registration must stay single: entry.js calls startAdSkip() exactly once,
// at the same top-level lifecycle point where the bare interval used to
// live. stopAdSkip() is exported for future lifecycle teardown.

let adSkipIntervalId = null // keeps the interval ID so stopAdSkip() can clear it

/**
 * Ads were breaking up my extension experience to end users. If they have an ad blocker installed, then that wasn't even an issue, but for the ones without an ad blocker, it was a problem. Therefore, the solution is to remove YouTube ads.
 */
export function startAdSkip () {
  adSkipIntervalId = setInterval(function () {
    if (document.getElementsByClassName("video-stream html5-main-video")[0] !== undefined) {
      let ad = document.getElementsByClassName("video-ads ytp-ad-module")[0];
      let vid = document.getElementsByClassName("video-stream html5-main-video")[0];

      let closeAble = document.getElementsByClassName("ytp-ad-overlay-close-button");
      for (let i = 0; i < closeAble.length; i++) {
        closeAble[i].click();
        //console.log("ad banner closed!")
      }
      if (document.getElementsByClassName("style-scope ytd-watch-next-secondary-results-renderer sparkles-light-cta GoogleActiveViewElement")[0] !== undefined) {
        let sideAd = document.getElementsByClassName("style-scope ytd-watch-next-secondary-results-renderer sparkles-light-cta GoogleActiveViewElement")[0];
        sideAd.style.display = "none";
        //console.log("side ad removed!")
      }
      if (document.getElementsByClassName("style-scope ytd-item-section-renderer sparkles-light-cta")[0] !== undefined) {
        let sideAd_ = document.getElementsByClassName("style-scope ytd-item-section-renderer sparkles-light-cta")[0];
        sideAd_.style.display = "none";
        //console.log("side ad removed!")
      }
      if (document.getElementsByClassName("ytp-ad-text ytp-ad-skip-button-text")[0] !== undefined) {
        let skipBtn = document.getElementsByClassName("ytp-ad-text ytp-ad-skip-button-text")[0];
        skipBtn.click();
        //console.log("skippable ad skipped!")
      }
      if (document.getElementsByClassName("ytp-ad-message-container")[0] !== undefined) {
        let incomingAd = document.getElementsByClassName("ytp-ad-message-container")[0];
        incomingAd.style.display = "none";
        //console.log("removed incoming ad alert!")
      }
      if (document.getElementsByClassName("style-scope ytd-companion-slot-renderer")[0] !== undefined) {
        document.getElementsByClassName("style-scope ytd-companion-slot-renderer")[0].remove();
        //console.log("side ad removed!")
      }
      if (ad !== undefined) {
        if (ad.children.length > 0) {
          if (document.getElementsByClassName("ytp-ad-text ytp-ad-preview-text")[0] !== undefined) {
            vid.playbackRate = 16; //16 is the maximum
            //console.log("Incrementally skipped unskippable ad!")
          }
        }
      }
    }
  }, 1000)
}

/**
 * Stops the interval registered by startAdSkip() (a no-op when not running).
 */
export function stopAdSkip () {
  if (adSkipIntervalId !== null) {
    clearInterval(adSkipIntervalId)
    adSkipIntervalId = null
  }
}
