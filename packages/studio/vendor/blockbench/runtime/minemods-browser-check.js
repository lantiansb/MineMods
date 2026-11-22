// Blockbench's final browser readiness check, externalized for strict CSP.
(function () {
  'use strict';
  // The upstream runtime is an ES module. Its execution finishes before
  // DOMContentLoaded, after ordinary scripts at the end of this document.
  const check = () => {
  let browserCheckPassed = false;
  try {
    if (typeof Array.prototype.at !== 'function') throw new Error('Array.prototype.at is unavailable');
    const stylesheet = document.getElementById('setup_stylesheet');
    if (!stylesheet || !stylesheet.sheet || !stylesheet.sheet.cssRules.length) throw new Error('Stylesheet not loaded');
    browserCheckPassed = true;
  } catch (error) {
    console.error(error);
    const errorElement = document.querySelector('#loading_error_detail');
    if (errorElement) errorElement.innerHTML = 'Incompatible browser version. Please update your web browser.';
  }
  if (!window.Blockbench || !window.Blockbench.setup_successful || !browserCheckPassed) {
    document.getElementById('loading_error_message').style.display = 'block';
    if (window.require) {
      window.require('@electron/remote').getCurrentWindow().webContents.openDevTools();
    } else if (window.openDevTools) {
      window.openDevTools();
    }
  } else {
    document.getElementById('loading_error_message').style.display = 'none';
  }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true });
  else check();
}());
