import ist from "ist"
import {EditorState, StateField, Facet, tagExtension, EditorSelection, SelectionRange, Annotation} from "@codemirror/next/state"

describe("EditorState", () => {
  it("holds doc and selection properties", () => {
    let state = EditorState.create({doc: "hello"})
    ist(state.doc.toString(), "hello")
    ist(state.selection.primary.from, 0)
  })

  it("can apply changes", () => {
    let state = EditorState.create({doc: "hello"})
    let transaction = state.tr({changes: [{from: 2, to: 4, insert: "w"}, {from: 5, insert: "!"}]})
    ist(transaction.state.doc.toString(), "hewo!")
  })

  it("maps selection through changes", () => {
    let state = EditorState.create({doc: "abcdefgh",
                                    extensions: [EditorState.allowMultipleSelections.of(true)],
                                    selection: EditorSelection.create([0, 4, 8].map(n => new SelectionRange(n)))})
    let newState = state.tr(state.replaceSelection("Q")).state
    ist(newState.doc.toString(), "QabcdQefghQ")
    ist(newState.selection.ranges.map(r => r.from).join("/"), "1/6/11")
  })

  const someAnnotation = Annotation.define<number>()

  it("can store annotations on transactions", () => {
    let tr = EditorState.create({doc: "foo"}).tr({annotations: someAnnotation.of(55)})
    ist(tr.annotation(someAnnotation), 55)
  })

  it("throws when a change's bounds are invalid", () => {
    let state = EditorState.create({doc: "1234"})
    ist.throws(() => state.tr({changes: {from: -1, to: 1}}))
    ist.throws(() => state.tr({changes: {from: 2, to: 1}}))
    ist.throws(() => state.tr({changes: {from: 2, to: 10, insert: "x"}}))
  })

  it("stores and updates tab size", () => {
    let deflt = EditorState.create({}), two = EditorState.create({extensions: [EditorState.tabSize.of(2)]})
    ist(deflt.tabSize, 4)
    ist(two.tabSize, 2)
    let updated = deflt.tr({reconfigure: [EditorState.tabSize.of(8)]}).state
    ist(updated.tabSize, 8)
  })

  it("stores and updates the line separator", () => {
    let deflt = EditorState.create({}), crlf = EditorState.create({extensions: [EditorState.lineSeparator.of("\r\n")]})
    ist(deflt.joinLines(["a", "b"]), "a\nb")
    ist(deflt.splitLines("foo\rbar").length, 2)
    ist(crlf.joinLines(["a", "b"]), "a\r\nb")
    ist(crlf.splitLines("foo\nbar\r\nbaz").length, 2)
    let updated = crlf.tr({reconfigure: [EditorState.lineSeparator.of("\n")]}).state
    ist(updated.joinLines(["a", "b"]), "a\nb")
    ist(updated.splitLines("foo\nbar").length, 2)
  })

  it("stores and updates fields", () => {
    let field1 = StateField.define<number>({create: () => 0, update: val => val + 1})
    let field2 = StateField.define<number>({create: state => state.field(field1) + 10, update: val => val})
    let state = EditorState.create({extensions: [field1, field2]})
    ist(state.field(field1), 0)
    ist(state.field(field2), 10)
    let newState = state.tr({}).state
    ist(newState.field(field1), 1)
    ist(newState.field(field2), 10)
  })

  it("can preserve fields across reconfiguration", () => {
    let field = StateField.define({create: () => 0, update: val => val + 1})
    let start = EditorState.create({extensions: [field]}).tr({}).state
    ist(start.field(field), 1)
    ist(start.tr({reconfigure: [field]}).state.field(field), 2)
    ist(start.tr({reconfigure: []}).state.field(field, false), undefined)
  })

  it("can replace extension groups", () => {
    let g = Symbol("A"), f = Facet.define<number>()
    let state = EditorState.create({extensions: [tagExtension(g, f.of(10)), f.of(20)]})
    ist(state.facet(f).join(), "10,20")
    let state2 = state.tr({replaceExtensions: {[g]: [f.of(1), f.of(2)]}}).state
    ist(state2.facet(f).join(), "1,2,20")
    let state3 = state2.tr({replaceExtensions: {[g]: f.of(3)}}).state
    ist(state3.facet(f).join(), "3,20")
  })

  it("raises an error on duplicate extension groups", () => {
    let g = Symbol("A"), f = Facet.define<number>()
    ist.throws(() => EditorState.create({extensions: [tagExtension(g, f.of(1)), tagExtension(g, f.of(2))]}),
               /duplicate use of tag/i)
    ist.throws(() => EditorState.create({extensions: tagExtension(g, tagExtension(g, f.of(1)))}),
               /duplicate use of tag/i)
  })

  it("allows facets computed from fields", () => {
    let field = StateField.define({create: () => [0], update: (v, tr, state) => tr.docChanged ? [state.doc.length] : v})
    let facet = Facet.define<number>()
    let state = EditorState.create({
      extensions: [field, facet.compute([field], state => state.field(field)[0]), facet.of(1)]
    })
    ist(state.facet(facet).join(), "0,1")
    let state2 = state.tr({}).state
    ist(state2.facet(facet), state.facet(facet))
    let state3 = state.tr({changes: {insert: "hi", from: 0}}).state
    ist(state3.facet(facet).join(), "2,1")
  })

  describe("changeFilter", () => {
    it("can cancel changes", () => {
      // Cancels all changes that add length
      let state = EditorState.create({extensions: [
        EditorState.changeFilter.of(({changes}) => changes.newLength <= changes.length)
      ], doc: "one two"})
      let tr1 = state.tr({changes: {from: 3, insert: " three"}, selection: {anchor: 13}})
      ist(tr1.state.doc.toString(), "one two")
      ist(tr1.state.selection.primary.head, 7)
      let tr2 = state.tr({changes: {from: 4, to: 7, insert: "2"}})
      ist(tr2.state.doc.toString(), "one 2")
    })

    it("can split changes", () => {
      // Only allows changes in the middle third of the document
      let state = EditorState.create({extensions: [
        EditorState.changeFilter.of((_tr, state) => [Math.floor(state.doc.length / 3), Math.floor(2 * state.doc.length / 3)])
      ], doc: "onetwo"})
      ist(state.tr({changes: {from: 0, to: 6}}).state.doc.toString(), "onwo")
    })

    it("combines filter masks", () => {
      let state = EditorState.create({extensions: [
        EditorState.changeFilter.of(() => [0, 4]),
        EditorState.changeFilter.of(() => [2, 6])
      ], doc: "onetwo"})
      ist(state.tr({changes: {from: 0, to: 6}}).state.doc.toString(), "onwo")
    })

    it("can be turned off", () => {
      let state = EditorState.create({extensions: [EditorState.changeFilter.of(() => false)]})
      ist(state.tr({changes: {from: 0, insert: "hi"}}).state.doc.length, 0)
      ist(state.tr({changes: {from: 0, insert: "hi"}, filter: false}).state.doc.length, 2)
    })
  })

  describe("selectionFilter", () => {
    it("can constrain the selection", () => {
      let state = EditorState.create({
        extensions: [EditorState.selectionFilter.of(sel => sel.primary.to < 4 ? sel : EditorSelection.single(4))],
        doc: "one two"
      })
      ist(state.tr({selection: {anchor: 3}}).selection!.primary.to, 3)
      ist(state.tr({selection: {anchor: 7}}).selection!.primary.to, 4)
    })
  })
})
