import ist from "ist"
import {EditorState, StateField, Facet, Change, EditorSelection, SelectionRange, Annotation} from ".."

describe("EditorState", () => {
  it("holds doc and selection properties", () => {
    let state = EditorState.create({doc: "hello"})
    ist(state.doc.toString(), "hello")
    ist(state.selection.primary.from, 0)
  })

  it("can apply changes", () => {
    let state = EditorState.create({doc: "hello"})
    let transaction = state.t().change(new Change(2, 4, ["w"])).change(new Change(4, 4, ["!"]))
    ist(transaction.doc.toString(), "hewo!")
    ist(transaction.apply().doc.toString(), "hewo!")
  })

  it("maps selection through changes", () => {
    let state = EditorState.create({doc: "abcdefgh",
                                    extensions: [EditorState.allowMultipleSelections.of(true)],
                                    selection: EditorSelection.create([0, 4, 8].map(n => new SelectionRange(n)))})
    let newState = state.t().replaceSelection("Q").apply()
    ist(newState.doc.toString(), "QabcdQefghQ")
    ist(newState.selection.ranges.map(r => r.from).join("/"), "1/6/11")
  })

  const someAnnotation = Annotation.define<number>()

  it("can store annotations on transactions", () => {
    let tr = EditorState.create({doc: "foo"}).t().annotate(someAnnotation, 55)
    ist(tr.annotation(someAnnotation), 55)
  })

  it("throws when a change's bounds are invalid", () => {
    let state = EditorState.create({doc: "1234"})
    ist.throws(() => state.t().replace(-1, 1, ""))
    ist.throws(() => state.t().replace(2, 1, ""))
    ist.throws(() => state.t().replace(2, 10, "x"))
  })

  it("stores and updates tab size", () => {
    let deflt = EditorState.create({}), two = EditorState.create({extensions: [EditorState.tabSize.of(2)]})
    ist(deflt.tabSize, 4)
    ist(two.tabSize, 2)
    let updated = deflt.t().reconfigure([EditorState.tabSize.of(8)]).apply()
    ist(updated.tabSize, 8)
  })

  it("stores and updates the line separator", () => {
    let deflt = EditorState.create({}), crlf = EditorState.create({extensions: [EditorState.lineSeparator.of("\r\n")]})
    ist(deflt.joinLines(["a", "b"]), "a\nb")
    ist(deflt.splitLines("foo\rbar").length, 2)
    ist(crlf.joinLines(["a", "b"]), "a\r\nb")
    ist(crlf.splitLines("foo\nbar\r\nbaz").length, 2)
    let updated = crlf.t().reconfigure([EditorState.lineSeparator.of("\n")]).apply()
    ist(updated.joinLines(["a", "b"]), "a\nb")
    ist(updated.splitLines("foo\nbar").length, 2)
  })

  it("stores and updates fields", () => {
    let field1 = StateField.define<number>({create: () => 0, update: (val, tr) => val + 1})
    let field2 = StateField.define<number>({create: state => state.field(field1) + 10, update: (val, tr) => val})
    let state = EditorState.create({extensions: [field1, field2]})
    ist(state.field(field1), 0)
    ist(state.field(field2), 10)
    let newState = state.t().apply()
    ist(newState.field(field1), 1)
    ist(newState.field(field2), 10)
  })

  it("can preserve fields across reconfiguration", () => {
    let field = StateField.define({create: () => 0, update: (val, tr) => val + 1})
    let start = EditorState.create({extensions: [field]}).t().apply()
    ist(start.field(field), 1)
    ist(start.t().reconfigure([field]).apply().field(field), 2)
    ist(start.t().reconfigure([]).apply().field(field, false), undefined)
  })

  it("allows facets computed from fields", () => {
    let field = StateField.define({create: () => [0], update: (v, tr) => tr.docChanged ? [tr.doc.length] : v})
    let facet = Facet.define<number>()
    let state = EditorState.create({
      extensions: [field, facet.compute([field], state => state.field(field)[0]), facet.of(1)]
    })
    ist(state.facet(facet).join(), "0,1")
    let state2 = state.t().apply()
    ist(state2.facet(facet), state.facet(facet))
    let state3 = state.t().replace(0, 0, "hi").apply()
    ist(state3.facet(facet).join(), "2,1")
  })
})
