import {base, keyName} from "w3c-keyname"
import {EditorView, Command} from "../../view"

/// A keymap associates key names with
/// [command](#view.Command)-style functions.
///
/// Key names may be strings like `"Shift-Ctrl-Enter"`—a key identifier
/// prefixed with zero or more modifiers. Key identifiers are based on
/// the strings that can appear in
/// [`KeyEvent.key`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key).
/// Use lowercase letters to refer to letter keys (or uppercase letters
/// if you want shift to be held). You may use `"Space"` as an alias
/// for the `" "` name.
///
/// Modifiers can be given in any order. `Shift-` (or `s-`), `Alt-` (or
/// `a-`), `Ctrl-` (or `c-` or `Control-`) and `Cmd-` (or `m-` or
/// `Meta-`) are recognized.
///
/// You can use `Mod-` as a shorthand for `Cmd-` on Mac and `Ctrl-` on
/// other platforms. So `Mod-b` is `Ctrl-b` on Linux but `Cmd-b` on
/// macOS.
export type Keymap = {[key: string]: Command | undefined}

const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform) : false

function normalizeKeyName(name: string): string {
  const parts = name.split(/-(?!$)/)
  let result = parts[parts.length - 1]
  if (result == "Space") result = " "
  let alt, ctrl, shift, meta
  for (let i = 0; i < parts.length - 1; ++i) {
    const mod = parts[i]
    if (/^(cmd|meta|m)$/i.test(mod)) meta = true
    else if (/^a(lt)?$/i.test(mod)) alt = true
    else if (/^(c|ctrl|control)$/i.test(mod)) ctrl = true
    else if (/^s(hift)?$/i.test(mod)) shift = true
    else if (/^mod$/i.test(mod)) { if (mac) meta = true; else ctrl = true }
    else throw new Error("Unrecognized modifier name: " + mod)
  }
  if (alt) result = "Alt-" + result
  if (ctrl) result = "Ctrl-" + result
  if (meta) result = "Meta-" + result
  if (shift) result = "Shift-" + result
  return result
}

function modifiers(name: string, event: KeyboardEvent, shift: boolean) {
  if (event.altKey) name = "Alt-" + name
  if (event.ctrlKey) name = "Ctrl-" + name
  if (event.metaKey) name = "Meta-" + name
  if (shift !== false && event.shiftKey) name = "Shift-" + name
  return name
}

/// Create a view extension that registers a keymap.
///
/// You can add multiple keymap behaviors to an editor. Their
/// priorities determine their precedence (the ones specified early or
/// with high priority get to dispatch first). When a handler has
/// returned `true` for a given key, no further handlers are called.
export const keymap = (map: Keymap) => {
  let set = new NormalizedKeymap(map)
  return EditorView.domEventHandlers({
    keydown(event: KeyboardEvent, view: EditorView) {
      let handler = set.get(event)
      return handler ? handler(view) : false
    }
  })
}

/// Stores a set of keybindings in normalized form, and helps looking
/// up the binding for a keyboard event. Only needed when binding keys
/// in some custom way.
export class NormalizedKeymap<T> {
  private map: {[key: string]: T} = Object.create(null)

  /// Create a normalized map.
  constructor(map: {[key: string]: T}) {
    for (const prop in map) this.map[normalizeKeyName(prop)] = map[prop]
  }

  /// Look up the binding for the given keyboard event, or `undefined`
  /// if none is found.
  get(event: KeyboardEvent): T | undefined {
    const name = keyName(event), isChar = name.length == 1 && name != " "
    const direct = this.map[modifiers(name, event, !isChar)]
    if (direct) return direct
    let baseName
    if (isChar && (event.shiftKey || event.altKey || event.metaKey) &&
        (baseName = base[event.keyCode]) && baseName != name) {
      const fromCode = this.map[modifiers(baseName, event, true)]
      if (fromCode) return fromCode
    }
    return undefined
  }
}
