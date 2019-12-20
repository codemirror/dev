import {keymap, Keymap} from ".."
import {EditorView} from "../../view"
import {EditorState} from "../../state"
import ist from "ist"

const fakeView = {state: {}, dispatch: () => {}}

function mk(map: Keymap) {
  return EditorState.create({extensions: [keymap(map)]}).facet(EditorView.handleDOMEvents)[0]
}

function dispatch(handlers: any, key: string, mods?: any) {
  let event: Partial<KeyboardEvent> = Object.assign({}, mods, {key})
  handlers.keydown(fakeView, event)
}

function counter() {
  const result = Object.assign(() => { result.count++; return true }, {count: 0})
  return result
}

describe("keymap", () => {
  it("calls the correct handler", () => {
    let a = counter(), b = counter()
    dispatch(mk({KeyA: a, KeyB: b}), "KeyA")
    ist(a.count, 1)
    ist(b.count, 0)
  })

  it("distinguishes between modifiers", () => {
    let s = counter(), c_s = counter(), s_c_s = counter(), a_s = counter()
    let map = mk({"Space": s, "Control-Space": c_s, "s-c-Space": s_c_s, "alt-Space": a_s})
    dispatch(map, " ", {ctrlKey: true})
    dispatch(map, " ", {ctrlKey: true, shiftKey: true})
    ist(s.count, 0)
    ist(c_s.count, 1)
    ist(s_c_s.count, 1)
    ist(a_s.count, 0)
  })

  it("passes the state, dispatch, and view", () => {
    let called = false
    dispatch(mk({X: (view) => {
      ist(view, fakeView)
      return called = true
    }}), "X")
    ist(called)
  })

  it("tries both shifted key and base with shift modifier", () => {
    let percent = counter(), shift5 = counter()
    dispatch(mk({"%": percent}), "%", {shiftKey: true, keyCode: 53})
    ist(percent.count, 1)
    dispatch(mk({"Shift-5": shift5}), "%", {shiftKey: true, keyCode: 53})
    ist(shift5.count, 1)
  })

  it("tries keyCode when modifier active", () => {
    let count = counter()
    dispatch(mk({"Shift-Alt-3": count}), "×", {shiftKey: true, altKey: true, keyCode: 51})
    ist(count.count, 1)
  })
})
