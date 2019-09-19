const ist = require("ist")
import {Extension, ExtensionType, Values} from "../src/extension"

let tp = new ExtensionType(), v = new Values

function mk(...extensions: Extension[]) {
  return tp.resolve(extensions)
}

let num = tp.behavior<number>()

describe("EditorState behavior", () => {
  it("allows querying of behaviors", () => {
    let str = tp.behavior<string>()
    let set = mk(num(10), num(20), str("x"), str("y"))
    ist(set.getBehavior(num, v).join(), "10,20")
    ist(set.getBehavior(str, v).join(), "x,y")
  })

  it("includes sub-extenders", () => {
    let e = (s: string) => Extension.all(num(s.length), num(+s))
    let set = mk(num(5), e("20"), num(40), e("100"))
    ist(set.getBehavior(num, v).join(), "5,2,20,40,3,100")
  })

  it("only includes sub-behaviors of unique extensions once", () => {
    let e = tp.unique<number>(ns => num(ns.reduce((a, b) => a + b, 0)))
    let set = mk(num(1), e(2), num(4), e(8))
    ist(set.getBehavior(num, v).join(), "1,10,4")
  })

  it("returns an empty array for absent behavior", () => {
    let set = mk()
    ist(JSON.stringify(set.getBehavior(num, v)), "[]")
  })

  it("sorts extensions by priority", () => {
    let str = tp.behavior<string>()
    let set = mk(str("a"), str("b"), str("c").extend(),
                 str("d").override(), str("e").fallback(),
                 str("f").extend(), str("g"))
    ist(set.getBehavior(str, v).join(), "d,c,f,a,b,g,e")
  })

  it("lets sub-extensions inherit their parent's priority", () => {
    let e = (n: number) => num(n)
    let set = mk(num(1), e(2).override(), e(4))
    ist(set.getBehavior(num, v).join(), "2,1,4")
  })

  it("uses default specs", () => {
    let e = tp.unique((specs: number[]) => num(specs.reduce((a, b) => a + b)), 10)
    let set = mk(e(), e(5))
    ist(set.getBehavior(num, v).join(), "15")
  })

  it("only allows omitting use argument when there's a default", () => {
    let e = tp.unique((specs: number[]) => num(0))
    ist.throws(() => e())
  })

  it("can reconfigure a single extension group", () => {
    let tag = Extension.defineTag()
    let set = mk(num(1), tag(Extension.all(num(2), num(3))))
    ist(set.getBehavior(num, v).join(), "1,2,3")
    let newSet = set.replaceExtensions([tag(num(4).override())])
    ist(newSet.getBehavior(num, v).join(), "4,1")
    ist(newSet.replaceExtensions([]).getBehavior(num, v).join(), "4,1")
    ist(newSet.replaceExtensions([tag(num(2))]).getBehavior(num, v).join(), "1,2")
  })
})
