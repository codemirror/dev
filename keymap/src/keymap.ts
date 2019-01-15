import {base, keyName} from "w3c-keyname"
import {EditorView, ViewExtension} from "../../view/src"

export type Command = (view: EditorView) => boolean
export type Keymap = {[key: string]: Command}

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

function normalize(map: Keymap): Keymap {
  const copy = Object.create(null)
  for (const prop in map) copy[normalizeKeyName(prop)] = map[prop]
  return copy
}

function modifiers(name: string, event: KeyboardEvent, shift: boolean) {
  if (event.altKey) name = "Alt-" + name
  if (event.ctrlKey) name = "Ctrl-" + name
  if (event.metaKey) name = "Meta-" + name
  if (shift !== false && event.shiftKey) name = "Shift-" + name
  return name
}

// Behavior for defining keymaps
//
// Specs are objects that map key names to command-style functions,
// which will be called with an editor view and should return true
// when they've handled the key.
//
// Key names may be strings like `"Shift-Ctrl-Enter"`—a key identifier
// prefixed with zero or more modifiers. Key identifiers are based on
// the strings that can appear in
// [`KeyEvent.key`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key).
// Use lowercase letters to refer to letter keys (or uppercase letters
// if you want shift to be held). You may use `"Space"` as an alias
// for the `" "` name.
//
// Modifiers can be given in any order. `Shift-` (or `s-`), `Alt-` (or
// `a-`), `Ctrl-` (or `c-` or `Control-`) and `Cmd-` (or `m-` or
// `Meta-`) are recognized.
//
// You can use `Mod-` as a shorthand for `Cmd-` on Mac and `Ctrl-` on
// other platforms.
//
// You can add multiple keymap behaviors to an editor. Their
// priorities determine their precedence (the ones specified early or
// with high priority get to dispatch first).
export const keymap = (map: Keymap) => ViewExtension.handleDOMEvents({
  keydown: keydownHandler(normalize(map))
})

function keydownHandler(map: Keymap): (view: EditorView, event: KeyboardEvent) => boolean {
  return function(view, event) {
    const name = keyName(event), isChar = name.length == 1 && name != " "
    const direct = map[modifiers(name, event, !isChar)]
    let baseName
    if (direct && direct(view)) return true
    if (isChar && (event.shiftKey || event.altKey || event.metaKey) &&
        (baseName = base[event.keyCode]) && baseName != name) {
      const fromCode = map[modifiers(baseName, event, true)]
      if (fromCode && fromCode(view)) return true
    }
    return false
  }
}
