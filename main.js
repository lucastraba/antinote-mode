'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, Platform } = require('obsidian');

// NSVisualEffectView materials, most-to-least translucent. Antinote uses
// SwiftUI's Material.ultraThin; 'hud' and 'under-window' read closest.
const MATERIALS = [
  'under-window',
  'hud',
  'fullscreen-ui',
  'popover',
  'menu',
  'content',
  'window',
  'sidebar',
];

const DEFAULT_SETTINGS = {
  enabled: false,
  modTheme: true,
  modChrome: true,
  modScrollbar: true,
  modTrafficLights: true,
  modCheckboxes: false,
  material: 'hud',
  tint: 0.15,
};

// Every visual module is a body class; styles.css gates all its rules on
// these, so toggling a module is a class flip — nothing to inject or undo.
const MODULE_CLASSES = {
  modTheme: 'an-theme',
  modChrome: 'an-chrome',
  modScrollbar: 'an-scrollbar',
  modCheckboxes: 'an-checkboxes',
};

// Obsidian sets `electronWindow` on every window it creates (main and
// popout) during bootstrap, using the bundled @electron/remote.
function electronWindowFor(win) {
  return (win || window).electronWindow || null;
}

module.exports = class AntinoteModePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.buttonsVisible = null;

    this.addSettingTab(new AntinoteModeSettingTab(this.app, this));

    this.addCommand({
      id: 'toggle',
      name: 'Toggle Antinote mode',
      callback: () => this.setEnabled(!this.settings.enabled),
    });

    this.addCommand({
      id: 'cycle-material',
      name: 'Cycle vibrancy material',
      checkCallback: (checking) => {
        if (!this.settings.enabled || !Platform.isMacOS) return false;
        if (!checking) {
          const i = MATERIALS.indexOf(this.settings.material);
          this.settings.material = MATERIALS[(i + 1) % MATERIALS.length];
          this.applyVibrancy(electronWindowFor());
          this.saveSettings();
          new Notice(`Vibrancy: ${this.settings.material}`);
        }
        return true;
      },
    });

    // Scrollbars only while scrolling: styles.css keeps thumbs transparent
    // unless body carries an-scrolling. 'scroll' does not bubble — capture.
    this.scrollTimer = 0;
    this.registerDomEvent(
      document,
      'scroll',
      () => {
        if (!this.settings.enabled || !this.settings.modScrollbar) return;
        document.body.classList.add('an-scrolling');
        window.clearTimeout(this.scrollTimer);
        this.scrollTimer = window.setTimeout(
          () => document.body.classList.remove('an-scrolling'),
          800
        );
      },
      { capture: true }
    );

    // Traffic lights only when hovering the traffic-light corner. The
    // native buttons sit ON TOP of the web view, so DOM hover events are
    // useless around them — poll the real cursor position instead.
    if (Platform.isMacOS) {
      this.registerInterval(
        window.setInterval(() => {
          if (!this.settings.enabled || !this.settings.modTrafficLights) return;
          const w = electronWindowFor();
          if (!w) return;
          let screen;
          try {
            screen = window.require('@electron/remote').screen;
          } catch (e) {
            return;
          }
          const p = screen.getCursorScreenPoint();
          const b = w.getBounds();
          this.setButtons(
            p.x >= b.x && p.x <= b.x + 100 && p.y >= b.y && p.y <= b.y + 44
          );
        }, 250)
      );
    }

    // Popouts inherit body classes but NOT vibrancy — Obsidian only ever
    // calls setVibrancy on the main window.
    this.registerEvent(
      this.app.workspace.on('window-open', (leaf, win) => {
        if (!this.settings.enabled || !this.settings.modTheme) return;
        this.applyVibrancy(electronWindowFor(win));
      })
    );

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enabled) this.apply();
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  setEnabled(on) {
    this.settings.enabled = on;
    this.saveSettings();
    if (on) this.apply();
    else this.restore();
    new Notice(on ? 'Antinote mode on' : 'Antinote mode off');
  }

  apply() {
    const body = document.body;
    body.classList.add('antinote-mode');
    for (const [key, cls] of Object.entries(MODULE_CLASSES)) {
      body.classList.toggle(cls, !!this.settings[key]);
    }
    body.style.setProperty('--an-tint', String(this.settings.tint));

    if (this.settings.modTheme && Platform.isMacOS) {
      if (!this.app.vault.getConfig('translucency')) {
        new Notice(
          'Antinote Mode: enable Settings → Appearance → "Translucent window" for the glass effect.',
          8000
        );
      }
      this.applyVibrancy(electronWindowFor());
    }
  }

  restore() {
    const body = document.body;
    body.classList.remove('antinote-mode', 'an-scrolling');
    for (const cls of Object.values(MODULE_CLASSES)) body.classList.remove(cls);
    body.style.removeProperty('--an-tint');

    const w = electronWindowFor();
    if (!w) return;
    if (Platform.isMacOS) {
      // Back to what Obsidian itself sets: 'sidebar' when its Translucent
      // window option is on, no vibrancy otherwise.
      try {
        w.setVibrancy(this.app.vault.getConfig('translucency') ? 'sidebar' : null);
      } catch (e) {
        /* window API unavailable */
      }
      this.setButtons(true);
    }
  }

  applyVibrancy(w) {
    if (!w || !Platform.isMacOS) return;
    try {
      w.setBackgroundColor('#00000000');
      w.setVibrancy(this.settings.material);
    } catch (e) {
      console.error('antinote-mode: setVibrancy failed', e);
    }
  }

  setButtons(visible) {
    if (this.buttonsVisible === visible) return;
    const w = electronWindowFor();
    if (!w) return;
    this.buttonsVisible = visible;
    try {
      w.setWindowButtonVisibility(visible);
    } catch (e) {
      /* not macOS or frameless */
    }
  }

  onunload() {
    window.clearTimeout(this.scrollTimer);
    this.restore();
  }
};

class AntinoteModeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const p = this.plugin;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Antinote mode')
      .setDesc('Master switch. Also available as a command for hotkeys.')
      .addToggle((t) =>
        t.setValue(p.settings.enabled).onChange((v) => p.setEnabled(v))
      );

    const module = (key, name, desc) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((t) =>
          t.setValue(p.settings[key]).onChange(async (v) => {
            p.settings[key] = v;
            await p.saveSettings();
            if (p.settings.enabled) p.apply();
          })
        );

    module(
      'modTheme',
      'Glass theme',
      'Vendetta palette, Menlo type, translucent note surface. macOS vibrancy where available; flat dark fallback elsewhere.'
    );
    module('modChrome', 'Hide chrome', 'Ribbon, status bar, tab headers, view header.');
    module('modScrollbar', 'Scrollbars only while scrolling', '');
    if (Platform.isMacOS)
      module(
        'modTrafficLights',
        'Traffic lights on hover',
        'Window buttons appear only when the cursor is in their corner.'
      );
    module(
      'modCheckboxes',
      'Styled checkboxes',
      'Extra task states ([!], [?], [>], …) with icons. Extracted from AnuPpuccin.'
    );

    if (Platform.isMacOS)
      new Setting(containerEl)
        .setName('Vibrancy material')
        .setDesc('Most translucent first. Antinote itself is closest to hud / under-window.')
        .addDropdown((d) => {
          for (const m of MATERIALS) d.addOption(m, m);
          d.setValue(p.settings.material).onChange(async (v) => {
            p.settings.material = v;
            await p.saveSettings();
            if (p.settings.enabled) p.applyVibrancy(electronWindowFor());
          });
        });

    new Setting(containerEl)
      .setName('Background tint')
      .setDesc('0 = bare vibrancy (Antinote\'s "most translucent"), 1 = solid theme background.')
      .addSlider((s) =>
        s
          .setLimits(0, 1, 0.05)
          .setValue(p.settings.tint)
          .setDynamicTooltip()
          .onChange(async (v) => {
            p.settings.tint = v;
            await p.saveSettings();
            if (p.settings.enabled)
              document.body.style.setProperty('--an-tint', String(v));
          })
      );
  }
}
