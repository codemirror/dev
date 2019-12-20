import ist from "ist"
import {EditorState, EditorSelection, Facet, Extension} from ".."

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
    let st = mk(num.of(1), num.compute([], () => 88))
    ist(st.facet(num).join(), "1,88")
  })

  it("only recomputes a facet value when necessary", () => {
    let st = mk(num.of(1), num.compute([str], s => s.facet(str).join().length), str.of("hello"))
    let array = st.facet(num)
    ist(array.join(), "1,5")
    ist(st.t().apply().facet(num), array)
  })

  it("can specify a dependency on the document", () => {
    let count = 0
    let st = mk(num.compute(["doc"], s => count++))
    ist(st.facet(num).join(), "0")
    st = st.t().replace(0, 0, "hello").apply()
    ist(st.facet(num).join(), "1")
    st = st.t().apply()
    ist(st.facet(num).join(), "1")
  })

  it("can specify a dependency on the selection", () => {
    let count = 0
    let st = mk(num.compute(["selection"], s => count++))
    ist(st.facet(num).join(), "0")
    st = st.t().replace(0, 0, "hello").apply()
    ist(st.facet(num).join(), "1")
    st = st.t().setSelection(EditorSelection.single(2)).apply()
    ist(st.facet(num).join(), "2")
    st = st.t().apply()
    ist(st.facet(num).join(), "2")
  })

  it("can provide multiple values at once", () => {
    let st = mk(num.computeN(["doc"], s => s.doc.length % 2 ? [100, 10] : []), num.of(1))
    ist(st.facet(num).join(), "1")
    st = st.t().replace(0, 0, "hello").apply()
    ist(st.facet(num).join(), "100,10,1")
  })

  it("works with a static combined facet", () => {
    let f = Facet.define<number, number>({combine: ns => ns.reduce((a, b) => a + b, 0)})
    let st = mk(f.of(1), f.of(2), f.of(3))
    ist(st.facet(f), 6)
  })

  it("works with a dynamic combined facet", () => {
    let f = Facet.define<number, number>({combine: ns => ns.reduce((a, b) => a + b, 0)})
    let st = mk(f.of(1), f.compute(["doc"], s => s.doc.length), f.of(3))
    ist(st.facet(f), 4)
    st = st.t().replace(0, 0, "hello").apply()
    ist(st.facet(f), 9)
  })

  it("survives reconfiguration", () => {
    let st = mk(num.compute(["doc"], s => s.doc.length), num.of(2), str.of("3"))
    let st2 = st.t().reconfigure([num.compute(["doc"], s => s.doc.length), num.of(2)]).apply()
    ist(st.facet(num), st2.facet(num))
    ist(st2.facet(str).length, 0)
  })

  it("preserves static facets across reconfiguration", () => {
    let st = mk(num.of(1), num.of(2), str.of("3"))
    let st2 = st.t().reconfigure([num.of(1), num.of(2)]).apply()
    ist(st.facet(num), st2.facet(num))
  })

  it("errors on cyclic dependencies", () => {
    ist.throws(() => mk(num.compute([str], s => s.facet(str).length), str.compute([num], s => s.facet(num).join())),
               /cyclic/i)
  })
})
