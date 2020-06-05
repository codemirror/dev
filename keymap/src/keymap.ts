import {base, keyName} from "w3c-keyname"
import {EditorView, Command} from "@codemirror/next/view"
import {Facet} from "@codemirror/next/state"

/// Key bindings associate key names with
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
export type KeyBinding = {
  /// The key name to use for this binding. If the platform-specific
  /// property (`mac`, `win`, or `linux`) for the current platform is
  /// used as well in the binding, that one takes precedence. If `key`
  /// isn't defined and the platform-specific binding isn't either,
  /// a binding is ignored.
  key?: string,
  /// Key to use specifically on macOS.
  mac?: string,
  /// Key to use specifically on Windows.
  win?: string,
  /// Key to use specifically on Linux.
  linux?: string,
  /// The command to execute when this binding is triggered. When the
  /// command function returns `false`, further bindings will be tried
  /// for the key.
  run: Command,
  /// When given, this defines a second binding, using the (possibly
  /// platform-specific) key name prefixed with `Shift-` to activate
  /// this command. This is mostly useful for cursor-motion commands
  /// that also have a cursor-extending variant.
  shift?: Command
  /// By default, key bindings apply when focus is on the editor
  /// content (the `"editor"` scope). Some extensions, mostly those
  /// that define their own panels, might want to allow you to
  /// register bindings local to that panel. Such bindings should use
  /// a custom scope name. You may also set multiple scope names,
  /// separated by spaces.
  scope?: string
}

type PlatformName = "mac" | "win" | "linux" | "key"

const currentPlatform: PlatformName = typeof navigator == "undefined" ? "key"
  : /Mac/.test(navigator.platform) ? "mac"
  : /Win/.test(navigator.platform) ? "win"
  : /Linux|X11/.test(navigator.platform) ? "linux"
  : "key"

function normalizeKeyName(name: string, platform: PlatformName): string {
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
    else if (/^mod$/i.test(mod)) { if (platform == "mac") meta = true; else ctrl = true }
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

type Keymap = {[scope: string]: {[key: string]: Command[]}}

const keymaps = Facet.define<Keymap>()

/// Create a view extension that registers a keymap.
///
/// You can add multiple keymap extensions to an editor. Their
/// priorities determine their precedence (the ones specified early or
/// with high priority get to dispatch first). When a handler has
/// returned `true` for a given key, no further handlers are called.
export function keymap(bindings: readonly KeyBinding[], platform?: "mac" | "win" | "linux") {
  let map = buildKeymap(bindings, platform || "key")
  return [
    EditorView.domEventHandlers({
      keydown(event: KeyboardEvent, view: EditorView) {
        return runHandlers(map, event, view, "editor")
      }
    }),
    keymaps.of(map)
  ]
}

/// Run the key handlers registered for a given scope. Returns true if
/// any of them handled the event.
export function runScopeHandlers(view: EditorView, event: KeyboardEvent, scope: string) {
  return view.state.facet(keymaps).some(map => runHandlers(map, event, view, scope))
}

function buildKeymap(bindings: readonly KeyBinding[], platform = currentPlatform) {
  let bound: Keymap = Object.create(null)

  let add = (scope: string, name: string, command: Command) => {
    let scopeObj = bound[scope] || (bound[scope] = Object.create(null))
    ;(scopeObj[name] || (scopeObj[name] = [])).push(command)
  }

  for (let b of bindings) {
    let name = b[platform] || b.key
    if (!name) continue
    for (let scope of b.scope ? b.scope.split(" ") : ["editor"]) {
      add(scope, normalizeKeyName(name, platform), b.run)
      if (b.shift) add(scope, normalizeKeyName("Shift-" + name, platform), b.shift)
    }
  }
  return bound
}

function runHandlers(map: Keymap, event: KeyboardEvent, view: EditorView, scope: string): boolean {
  let scopeObj = map[scope]
  if (!scopeObj) return false
  let name = keyName(event), isChar = name.length == 1 && name != " "
  let direct = scopeObj[modifiers(name, event, !isChar)]
  if (direct && runFor(direct, view)) return true
  let baseName
  if (isChar && (event.shiftKey || event.altKey || event.metaKey) &&
      (baseName = base[event.keyCode]) && baseName != name) {
    let fromCode = scopeObj[modifiers(baseName, event, true)]
    if (fromCode && runFor(fromCode, view)) return true
  } else if (isChar && event.shiftKey) {
    let withShift = scopeObj[modifiers(name, event, true)]
    if (withShift && runFor(withShift, view)) return true
  }
  return false
}

function runFor(commands: readonly Command[], view: EditorView) {
  for (let cmd of commands) if (cmd(view)) return true
  return false
}
