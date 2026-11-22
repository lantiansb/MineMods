// MineMods offline bootstrap for the official Blockbench web build.
// Kept as a local external script so the host can use a strict script-src policy.
(function () {
  'use strict';
  const studioSettings = JSON.parse(localStorage.getItem('settings') || '{}');
  studioSettings.language ??= { value: 'zh' };
  localStorage.setItem('settings', JSON.stringify(studioSettings));
  if (typeof module === 'object') {
    window.module = module;
    module = undefined;
  }
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme) {
    try {
      const colors = JSON.parse(storedTheme).colors;
      const darkColor = colors && colors.dark;
      if (darkColor) document.getElementById('theme_css').textContent = `@layer theme {body {--color-dark: ${darkColor};}};`;
    } catch {}
  }
  window.ErrorLog = [];
  window.onerror = (message, file, line) => {
    if (String(message).includes('ResizeObserver loop completed with undelivered notifications')) return;
    window.ErrorLog.push({ message, file, line });
    if (window.Blockbench && window.Blockbench.setup_successful) return;
    const errorElement = document.querySelector('#loading_error_detail');
    if (errorElement && !errorElement.innerText) errorElement.innerText = `${message}\nIn .${String(file).split(location.origin).join('')}:${line}`;
    const version = document.querySelector('#loading_error_version');
    if (version && window.Blockbench) version.innerText = window.Blockbench.version;
  };
  window.factoryResetAndReload = function factoryResetAndReload() {
    const langKey = 'menu.help.developer.reset_storage.confirm';
    const result = window.confirm(window.tl && window.tl(langKey) !== langKey ? window.tl(langKey) : 'Are you sure you want to reset Blockbench to factory settings? This will delete all custom settings, keybindings and installed plugins.');
    if (!result) return;
    localStorage.clear();
    if ('Blockbench' in window) window.Blockbench.addFlag('no_localstorage_saving');
    console.log('Cleared Local Storage');
    window.location.reload();
  };
  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loading_reload_button')?.addEventListener('click', () => {
      if (window.Blockbench) window.Blockbench.reload();
      else window.location.reload();
    });
    document.getElementById('loading_factory_reset_button')?.addEventListener('click', window.factoryResetAndReload);
    document.getElementById('loading_quit_button')?.addEventListener('click', () => window.close());
    document.getElementById('title_bar_home_button')?.addEventListener('click', () => window.Interface?.tab_bar?.openNewTab?.());
  });
}());
