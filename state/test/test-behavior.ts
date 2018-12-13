const ist = require("ist")
import {Behavior, BehaviorSpec, Priority, EditorState} from "../src"

function mk(...behaviors: BehaviorSpec[]) { return EditorState.create({behaviors}) }

describe("EditorState behavior", () => {
  it("allows querying of behaviors", () => {
    let a = Behavior.define<number, number>(ns => ns.reduce((a, b) => a + b))
    let b = Behavior.defineSet<string>()
    let state = mk(a.use(10), a.use(20), b.use("x"), b.use("y"))
    ist(a.get(state), 30)
    ist(b.get(state).join(), "x,y")
    let seen: string[] = []
    ist(b.some(state, s => { seen.push(s); return s == "y" ? "OK" : undefined }), "OK")
    ist(seen.join(), "x,y")
  })

  it("includes sub-behaviors", () => {
    let a = Behavior.defineSet<number>()
    let b = Behavior.defineSet<string>(str => [a.use(+str)])
    let state = mk(b.use("5"), b.use("10"), a.use(20), b.use("40"))
    ist(a.get(state).join(), "5,10,20,40")
  })

  it("only includes sub-behaviors of non-set behavior once", () => {
    let a = Behavior.defineSet<number>()
    let b = Behavior.define<number, number>(ns => ns.reduce((a, b) => a + b), n => [a.use(n)])
    let state = mk(a.use(1), b.use(2), a.use(4), b.use(8))
    ist(a.get(state).join(), "1,10,4")
  })

  it("returns an empty array for absent set behavior", () => {
    let a = Behavior.defineSet<number>()
    let state = mk()
    ist(JSON.stringify(a.get(state)), "[]")
  })

  it("sorts behaviors by priority", () => {
    let a = Behavior.defineSet<string>()
    let state = mk(a.use("a"), a.use("b"), a.use("c", Priority.extend),
                   a.use("d", Priority.override), a.use("e", Priority.fallback),
                   a.use("f", Priority.extend), a.use("g"))
    ist(a.get(state).join(), "d,c,f,a,b,g,e")
  })

  it("lets sub-behaviors inherit their parent's priority", () => {
    let a = Behavior.defineSet<number>()
    let b = Behavior.defineSet<number>(n => [a.use(n)])
    let state = mk(a.use(1), b.use(2, Priority.override), b.use(4))
    ist(a.get(state).join(), "2,1,4")
  })
})
