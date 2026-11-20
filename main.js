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
  // Sharing a vault with a regular theme: while the mode is on, unload the
  // vault's theme and CSS snippets, turn on translucency and use this font
  // size. Nothing is written to the vault's appearance config, so turning
  // the mode off (or a restart with it off) brings the usual look back.
  standalone: true,
  fontSize: 0,
  // Note to open in a fresh tab when the mode turns on; empty opens nothing.
  scratchNote: '',
  // Workspace layout from before the mode turned on, restored when it turns
  // off. Persisted so a restart in Antinote mode can still go back.
  savedLayout: null,
  // Shell commands run when the mode turns on / off, e.g. to float the window
  // in a tiling window manager. {windowId} is the macOS window number, which
  // is also AeroSpace's window id.
  onEnableCommand: '',
  onDisableCommand: '',
  // Window bounds while on, remembered across switches (macOS).
  glassBounds: null,
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

    // Idempotent variants for scripts and global hotkeys (`obsidian command
    // id=antinote-mode:enable`), which can't see the current state.
    this.addCommand({
      id: 'enable',
      name: 'Turn Antinote mode on',
      callback: () => this.setEnabled(true),
    });

    this.addCommand({
      id: 'disable',
      name: 'Turn Antinote mode off',
      callback: () => this.setEnabled(false),
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
      if (!this.settings.enabled) return;
      this.apply();
      this.runHook(this.settings.onEnableCommand, electronWindowFor());
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async setEnabled(on) {
    if (this.settings.enabled === on) return;
    this.settings.enabled = on;
    const w = electronWindowFor();
    if (on) {
      this.settings.savedLayout = this.app.workspace.getLayout();
      await this.saveSettings();
      this.apply();
      this.runHook(this.settings.onEnableCommand, w);
      if (w && this.settings.glassBounds) w.setBounds(this.settings.glassBounds);
      await this.openScratchNote();
      this.redrawVibrancy(w);
    } else {
      if (w && this.settings.onDisableCommand) this.settings.glassBounds = w.getBounds();
      this.restore();
      this.runHook(this.settings.onDisableCommand, w);
      const layout = this.settings.savedLayout;
      this.settings.savedLayout = null;
      await this.saveSettings();
      if (layout) await this.app.workspace.changeLayout(layout);
    }
    new Notice(on ? 'Antinote mode on' : 'Antinote mode off');
  }

  runHook(command, w) {
    if (!command || !Platform.isDesktopApp) return;
    const id = /^window:(\d+):/.exec(w?.getMediaSourceId?.() || '')?.[1] || '';
    try {
      require('child_process').execFileSync('/bin/sh', ['-c', command.replaceAll('{windowId}', id)], {
        timeout: 3000,
      });
    } catch (e) {
      console.error('antinote-mode: hook failed', command, e);
    }
  }

  async openScratchNote() {
    const ws = this.app.workspace;
    ws.leftSplit?.collapse();
    ws.rightSplit?.collapse();
    const file = this.settings.scratchNote
      ? this.app.vault.getFileByPath(this.settings.scratchNote)
      : null;
    if (!file) return;
    const leaf = ws.getLeaf('tab');
    await leaf.openFile(file);
    ws.setActiveLeaf(leaf, { focus: true });
  }

  apply() {
    const body = document.body;
    body.classList.add('antinote-mode');
    for (const [key, cls] of Object.entries(MODULE_CLASSES)) {
      body.classList.toggle(cls, !!this.settings[key]);
    }
    body.style.setProperty('--an-tint', String(this.settings.tint));

    if (this.settings.standalone) this.unloadVaultLook();

    if (this.settings.modTheme && Platform.isMacOS) {
      if (!body.classList.contains('is-translucent')) {
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

    if (this.settings.standalone) this.reloadVaultLook();

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

  // customCss is Obsidian's internal theme manager. Setting its fields and
  // asking it to reload, instead of calling setTheme()/setTranslucency(),
  // keeps the change out of appearance.json.
  unloadVaultLook() {
    const css = this.app.customCss;
    if (!css) return;
    css.theme = '';
    css.requestLoadTheme();
    css.enabledSnippets = new Set();
    css.requestLoadSnippets();
    if (Platform.isMacOS && !document.body.classList.contains('is-translucent'))
      css.enableTranslucency();
    if (this.settings.fontSize)
      document.body.style.setProperty('--font-text-size', `${this.settings.fontSize}px`);
  }

  reloadVaultLook() {
    const css = this.app.customCss;
    if (!css) return;
    const config = (key) => this.app.vault.getConfig(key);
    css.reloadTheme();
    css.enabledSnippets = new Set(config('enabledCssSnippets') || []);
    css.requestLoadSnippets();
    if (Platform.isMacOS && !config('translucency')) css.disableTranslucency();
    if (this.settings.fontSize)
      document.body.style.setProperty('--font-text-size', `${config('baseFontSize') || 16}px`);
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

  // A vibrancy view added to a window that is already on screen isn't drawn
  // until macOS redisplays the window: the glass stays clear until you click
  // or move it. A 1px resize and back forces that redisplay.
  redrawVibrancy(w) {
    if (!w || !Platform.isMacOS || !this.settings.modTheme) return;
    setTimeout(() => {
      try {
        this.applyVibrancy(w);
        const b = w.getBounds();
        w.setBounds({ ...b, width: b.width + 1 });
        setTimeout(() => w.setBounds(b), 50);
      } catch (e) {
        console.error('antinote-mode: vibrancy redraw failed', e);
      }
    }, 150);
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
    if (this.settings.enabled) this.restore();
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

    new Setting(containerEl)
      .setName('Scratch note')
      .setDesc('Vault path of a note to open in a new tab when the mode turns on. Leave empty to keep the current note.')
      .addText((t) =>
        t.setValue(p.settings.scratchNote).onChange(async (v) => {
          p.settings.scratchNote = v.trim();
          await p.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Replace the vault theme')
      .setDesc('While on, unload the vault theme and CSS snippets and turn on translucency, without changing appearance settings.')
      .addToggle((t) =>
        t.setValue(p.settings.standalone).onChange(async (v) => {
          p.settings.standalone = v;
          await p.saveSettings();
        })
      );

    const hook = (key, name) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc('Shell command. {windowId} is the macOS window number (AeroSpace window id). Leave empty for none.')
        .addText((t) =>
          t.setValue(p.settings[key]).onChange(async (v) => {
            p.settings[key] = v;
            await p.saveSettings();
          })
        );
    hook('onEnableCommand', 'Run when turned on');
    hook('onDisableCommand', 'Run when turned off');

    new Setting(containerEl)
      .setName('Font size while on')
      .setDesc('In pixels. 0 keeps the vault font size.')
      .addText((t) =>
        t.setValue(String(p.settings.fontSize)).onChange(async (v) => {
          p.settings.fontSize = Number(v) || 0;
          await p.saveSettings();
        })
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
