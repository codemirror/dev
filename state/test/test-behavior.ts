const ist = require("ist")
import {StateBehavior, StateExtender, EditorState} from "../src"

function mk(...extensions: StateExtender[]) { return EditorState.create({extensions}) }

let num = StateBehavior.define<number>()

describe("EditorState behavior", () => {
  it("allows querying of behaviors", () => {
    let str = StateBehavior.define<string>()
    let state = mk(num(10), num(20), str("x"), str("y"))
    ist(state.behavior(num).join(), "10,20")
    ist(state.behavior(str).join(), "x,y")
  })

  it("includes sub-extenders", () => {
    let a = StateBehavior.defineExtension<number>(n => [num(n)])
    let b = StateBehavior.defineExtension<string>(s => [a(s.length), num(+s)])
    let state = mk(a(5), b("20"), num(40), b("100"))
    ist(state.behavior(num).join(), "5,2,20,40,3,100")
  })

  it("only includes sub-behaviors of unique extensions once", () => {
    let e = StateBehavior.defineUniqueExtension<number>(ns => [num(ns.reduce((a, b) => a + b, 0))])
    let state = mk(num(1), e(2), num(4), e(8))
    ist(state.behavior(num).join(), "1,10,4")
  })

  it("returns an empty array for absent behavior", () => {
    ist(JSON.stringify(mk().behavior(num)), "[]")
  })

  it("raises an error duplicated unique behavior", () => {
    let u = StateBehavior.define<number>({unique: true})
    ist.throws(() => mk(u(1), u(2)))
  })

  it("sorts extensions by priority", () => {
    let str = StateBehavior.define<string>()
    let state = mk(str("a"), str("b"), str("c", StateBehavior.Priority.extend),
                   str("d", StateBehavior.Priority.override), str("e", StateBehavior.Priority.fallback),
                   str("f", StateBehavior.Priority.extend), str("g"))
    ist(state.behavior(str).join(), "d,c,f,a,b,g,e")
  })

  it("lets sub-extensions inherit their parent's priority", () => {
    let e = StateBehavior.defineExtension<number>(n => [num(n)])
    let state = mk(num(1), e(2, StateBehavior.Priority.override), e(4))
    ist(state.behavior(num).join(), "2,1,4")
  })

  it("uses default specs", () => {
    let e = StateBehavior.defineExtension<number>(s => [num(s)], 6)
    let state = mk(e(), e(5))
    ist(state.behavior(num).join(), "6,5")
  })

  it("only allows omitting use argument when there's a default", () => {
    let e = StateBehavior.defineExtension<number>(s => [])
    ist.throws(() => e())
  })
})
