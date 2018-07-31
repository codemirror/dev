import {keymap} from "../src/keymap"
const ist = require("ist")

const fakeView = {state: {}, dispatch: () => {}}

function dispatch(map, key, mods?) {
  let event = {}
  if (mods) for (let prop in mods) event[prop] = mods[prop]
  event.key = key
  map.view().handleDOMEvents.keydown(fakeView, event)
}

function counter() {
  function result() { result.count++ }
  result.count = 0
  return result
}

describe("keymap", () => {
  it("calls the correct handler", () => {
    let a = counter(), b = counter()
    dispatch(keymap({KeyA: a, KeyB: b}), "KeyA")
    ist(a.count, 1)
    ist(b.count, 0)
  })

  it("distinguishes between modifiers", () => {
    let s = counter(), c_s = counter(), s_c_s = counter(), a_s = counter()
    let map = keymap({"Space": s, "Control-Space": c_s, "s-c-Space": s_c_s, "alt-Space": a_s})
    dispatch(map, " ", {ctrlKey: true})
    dispatch(map, " ", {ctrlKey: true, shiftKey: true})
    ist(s.count, 0)
    ist(c_s.count, 1)
    ist(s_c_s.count, 1)
    ist(a_s.count, 0)
  })

  it("passes the state, dispatch, and view", () => {
    let called = false
    dispatch(keymap({X: (state, dispatch, view) => {
      called = true
      ist(state, fakeView.state)
      ist(dispatch, fakeView.dispatch)
      ist(view, fakeView)
    }}), "X")
    ist(called)
  })

  it("tries both shifted key and base with shift modifier", () => {
    let percent = counter(), shift5 = counter()
    dispatch(keymap({"%": percent}), "%", {shiftKey: true, keyCode: 53})
    ist(percent.count, 1)
    dispatch(keymap({"Shift-5": shift5}), "%", {shiftKey: true, keyCode: 53})
    ist(shift5.count, 1)
  })

  it("tries keyCode when modifier active", () => {
    let count = counter()
    dispatch(keymap({"Shift-Alt-3": count}), "×", {shiftKey: true, altKey: true, keyCode: 51})
    ist(count.count, 1)
  })
})
