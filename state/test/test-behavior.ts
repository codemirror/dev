const ist = require("ist")
import {Behavior, Extension, Extender, Priority, EditorState} from "../src"

function mk(...extensions: Extender[]) { return EditorState.create({extensions}) }

let num = Behavior.define<number>()

describe("EditorState behavior", () => {
  it("allows querying of behaviors", () => {
    let str = Behavior.define<string>()
    let state = mk(num.use(10), num.use(20), str.use("x"), str.use("y"))
    ist(num.get(state).join(), "10,20")
    ist(str.get(state).join(), "x,y")
  })

  it("includes sub-extenders", () => {
    let a = Extension.define<number>(n => [num.use(n)])
    let b = Extension.define<string>(s => [a.use(s.length), num.use(+s)])
    let state = mk(a.use(5), b.use("20"), num.use(40), b.use("100"))
    ist(num.get(state).join(), "5,2,20,40,3,100")
  })

  it("only includes sub-behaviors of unique extensions once", () => {
    let e = Extension.defineUnique<number>(ns => [num.use(ns.reduce((a, b) => a + b, 0))])
    let state = mk(num.use(1), e.use(2), num.use(4), e.use(8))
    ist(num.get(state).join(), "1,10,4")
  })

  it("returns an empty array for absent behavior", () => {
    ist(JSON.stringify(num.get(mk())), "[]")
  })

  it("raises an error duplicated unique behavior", () => {
    let u = Behavior.define<number>({unique: true})
    ist.throws(() => mk(u.use(1), u.use(2)))
  })

  it("sorts extensions by priority", () => {
    let str = Behavior.define<string>()
    let state = mk(str.use("a"), str.use("b"), str.use("c", Priority.extend),
                   str.use("d", Priority.override), str.use("e", Priority.fallback),
                   str.use("f", Priority.extend), str.use("g"))
    ist(str.get(state).join(), "d,c,f,a,b,g,e")
  })

  it("lets sub-extensions inherit their parent's priority", () => {
    let e = Extension.define<number>(n => [num.use(n)])
    let state = mk(num.use(1), e.use(2, Priority.override), e.use(4))
    ist(num.get(state).join(), "2,1,4")
  })

  it("uses default specs", () => {
    let e = Extension.define<number>(s => [num.use(s)], 6)
    let state = mk(e.use(), e.use(5))
    ist(num.get(state).join(), "6,5")
  })

  it("only allows omitting use argument when there's a default", () => {
    let e = Extension.define<number>(s => [])
    ist.throws(() => e.use())
  })
})
