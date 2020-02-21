import {NormalizedKeymap} from ".."
import ist from "ist"

function mk(map: {[key: string]: string}) {
  return new NormalizedKeymap(map)
}

function get(map: NormalizedKeymap<string>, key: string, mods?: any) {
  return map.get(Object.assign({}, mods, {key}))
}

describe("keymap", () => {
  it("calls the correct handler", () => {
    ist(get(mk({KeyA: "a", KeyB: "b"}), "KeyA"), "a")
  })

  it("distinguishes between modifiers", () => {
    let map = mk({"Space": "s", "Control-Space": "cs", "s-c-Space": "scs", "alt-Space": "as"})
    ist(get(map, " ", {ctrlKey: true}), "cs")
    ist(get(map, " ", {ctrlKey: true, shiftKey: true}), "scs")
  })

  it("tries both shifted key and base with shift modifier", () => {
    ist(get(mk({"%": "p"}), "%", {shiftKey: true, keyCode: 53}), "p")
    ist(get(mk({"Shift-5": "s5"}), "%", {shiftKey: true, keyCode: 53}), "s5")
  })

  it("tries keyCode when modifier active", () => {
    ist(get(mk({"Shift-Alt-3": "sa3"}), "×", {shiftKey: true, altKey: true, keyCode: 51}), "sa3")
  })
})
