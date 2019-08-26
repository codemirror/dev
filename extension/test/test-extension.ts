const ist = require("ist")
import {Extension, ExtensionType} from "../src/extension"

let tp = new ExtensionType

function mk(...extensions: Extension[]) { return tp.resolve(extensions) }

let num = tp.behavior<number>()

describe("EditorState behavior", () => {
  it("allows querying of behaviors", () => {
    let str = tp.behavior<string>()
    let store = mk(num(10), num(20), str("x"), str("y"))
    ist(store.get(num).join(), "10,20")
    ist(store.get(str).join(), "x,y")
  })

  it("includes sub-extenders", () => {
    let e = (s: string) => Extension.all(num(s.length), num(+s))
    let store = mk(num(5), e("20"), num(40), e("100"))
    ist(store.get(num).join(), "5,2,20,40,3,100")
  })

  it("only includes sub-behaviors of unique extensions once", () => {
    let e = tp.unique<number>(ns => num(ns.reduce((a, b) => a + b, 0)))
    let store = mk(num(1), e(2), num(4), e(8))
    ist(store.get(num).join(), "1,10,4")
  })

  it("returns an empty array for absent behavior", () => {
    ist(JSON.stringify(mk().get(num)), "[]")
  })

  it("sorts extensions by priority", () => {
    let str = tp.behavior<string>()
    let store = mk(str("a"), str("b"), str("c").extend(),
                   str("d").override(), str("e").fallback(),
                   str("f").extend(), str("g"))
    ist(store.get(str).join(), "d,c,f,a,b,g,e")
  })

  it("lets sub-extensions inherit their parent's priority", () => {
    let e = (n: number) => num(n)
    let store = mk(num(1), e(2).override(), e(4))
    ist(store.get(num).join(), "2,1,4")
  })

  it("uses default specs", () => {
    let e = tp.unique((specs: number[]) => num(specs.reduce((a, b) => a + b)), 10)
    let store = mk(e(), e(5))
    ist(store.get(num).join(), "15")
  })

  it("only allows omitting use argument when there's a default", () => {
    let e = tp.unique((specs: number[]) => num(0))
    ist.throws(() => e())
  })
})
