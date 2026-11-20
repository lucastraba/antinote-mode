# Antinote Mode

Turn Obsidian into an [Antinote](https://antinote.io)-style translucent scratchpad, and back, with one command.

**Unofficial.** This plugin is a loving imitation of Antinote's look for Obsidian, built with no involvement from Antinote's developer. If you want the real thing (instant summon/dismiss, auto-clearing notes, the text-first tooling), [buy Antinote](https://antinote.io). The bundled palette is a port of Antinote's *Vendetta* theme; more themes live in the [antinote-extensions](https://github.com/johnsonfung/antinote-extensions) repo and are a 26-value swap away.

## What it does

One master command (`Toggle Antinote mode`) flips these modules, each individually optional:

- **Glass theme:** macOS vibrancy with the Vendetta palette, Menlo type, Antinote's flat heading ramp, tunable background tint. Falls back to a flat dark theme in fullscreen and on non-macOS platforms.
- **Hide chrome:** ribbon, status bar, tab headers, view header. Just text on glass.
- **Scrollbars only while scrolling:** thumbs appear while you scroll and vanish 800 ms after you stop.
- **Traffic lights on hover:** window buttons appear only when the cursor is in their corner (macOS).
- **Styled checkboxes** *(off by default)*: extra task states (`[!]`, `[?]`, `[>]`, …) with icons, extracted from [AnuPpuccin](https://github.com/AnubisNekhet/AnuPpuccin).

Toggling off restores stock Obsidian: every style is gated on body classes, and nothing is patched or persisted outside plugin settings.

## Sharing a vault with a regular theme

You don't need a separate vault for the glass look. With **Replace the vault theme** on (the default), turning the mode on unloads the vault's theme and CSS snippets and turns on translucency, all in memory. Turning it off loads them back, so the vault keeps its usual theme in `appearance.json`. Other options:

- **Scratch note:** a vault path to open in a new tab when the mode turns on. Sidebars collapse, and the layout from before is restored when it turns off.
- **Font size while on:** a separate text size for the glass mode.
- **Run when turned on / off:** shell commands, with `{windowId}` replaced by the macOS window number. With AeroSpace, `aerospace layout floating --window-id {windowId}` and `aerospace layout tiling --window-id {windowId}` give you a floating pad and a tiled window. The pad's size is remembered between switches.

`Turn Antinote mode on` and `Turn Antinote mode off` are idempotent, for scripts and global hotkeys that can't see the current state, e.g. `obsidian command id=antinote-mode:enable` with the Obsidian CLI.

## What it deliberately does not do

Summon/dismiss. Antinote's global-hotkey show/hide depends on your environment: window manager, hotkey daemons, other apps competing for the key. Bind your own: a Raycast "toggle application" hotkey on Obsidian works well. If you run AeroSpace, set `automatically-unhide-macos-hidden-apps = false` or AeroSpace will undo every hide.

## Requirements and caveats

- Desktop only. The full glass effect is macOS only (vibrancy is an AppKit feature); Windows and Linux get the flat theme.
- Turn on **Settings → Appearance → Translucent window**, or there is no glass to see through.
- Requires a reasonably current Obsidian installer (the plugin's CSS uses native nesting, Chromium 120+). Check Settings → General → "Installer version"; re-download from obsidian.md if it's ancient.

### Optional: keep the glass alive when unfocused

Out of the box, macOS dims vibrancy when the window loses focus, and Obsidian doesn't expose Electron's `visualEffectState` option to prevent it. If the dimming bothers you, `scripts/patch-vibrancy.sh` patches your local Obsidian to keep vibrancy active:

```sh
./scripts/patch-vibrancy.sh                    # patch (writes a .bak backup)
./scripts/patch-vibrancy.sh --disable-updates  # also pin the Obsidian version
```

Obsidian updates replace the patched file. Re-run the script after updating, or use `--disable-updates` and update Obsidian manually. This is an at-your-own-risk modification of your local install; the plugin works fine without it.

## Install (manual, for now)

Copy `manifest.json`, `main.js` and `styles.css` into `<vault>/.obsidian/plugins/antinote-mode/` and enable the plugin in Community plugins.

## Credits

- [Antinote](https://antinote.io) by Johnson Fung is the entire inspiration. Vendetta palette values are ported from Antinote's theme model.
- Checkbox styles extracted from [AnuPpuccin](https://github.com/AnubisNekhet/AnuPpuccin) (MIT) with [Catppuccin](https://github.com/catppuccin) colors (MIT); icons from Font Awesome Free (CC BY 4.0) and [Lucide](https://lucide.dev) (ISC).

## License

MIT. Antinote is a trademark of its author; this project is unaffiliated.
