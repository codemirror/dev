const ist = require("ist")
import {EditorState, Facet, Extension} from ".."

function mk(...extensions: Extension[]) {
  return EditorState.create({extensions})
}

let num = Facet.define<number>(), str = Facet.define<string>()

describe("EditorState facets", () => {
  it("allows querying of facets", () => {
    let st = mk(num.of(10), num.of(20), str.of("x"), str.of("y"))
    ist(st.facet(num).join(), "10,20")
    ist(st.facet(str).join(), "x,y")
  })

  it("includes sub-extenders", () => {
    let e = (s: string) => [num.of(s.length), num.of(+s)]
    let st = mk(num.of(5), e("20"), num.of(40), e("100"))
    ist(st.facet(num).join(), "5,2,20,40,3,100")
  })

  it("only includes duplicated extensions once", () => {
    let e = num.of(50)
    let st = mk(num.of(1), e, num.of(4), e)
    ist(st.facet(num).join(), "1,50,4")
  })

  it("returns an empty array for absent facet", () => {
    let st = mk()
    ist(JSON.stringify(st.facet(num)), "[]")
  })

  it("sorts extensions by priority", () => {
    let st = mk(str.of("a"), str.of("b"), Facet.extend(str.of("c")),
                 Facet.override(str.of("d")), Facet.fallback(str.of("e")),
                 Facet.extend(str.of("f")), str.of("g"))
    ist(st.facet(str).join(), "d,c,f,a,b,g,e")
  })

  it("lets sub-extensions inherit their parent's priority", () => {
    let e = (n: number) => num.of(n)
    let st = mk(num.of(1), Facet.override(e(2)), e(4))
    ist(st.facet(num).join(), "2,1,4")
  })

  it("supports dynamic facet", () => {
    let st = mk(num.of(1), num.derive([], () => 88))
    ist(st.facet(num).join(), "1,88")
  })

  it("only recomputes a facet value when necessary", () => {
    let st = mk(num.of(1), num.derive([str], s => s.facet(str).join().length), str.of("hello"))
    let array = st.facet(num)
    ist(array.join(), "1,5")
    ist(st.t().apply().facet(num), array)
  })
})
