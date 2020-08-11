import ist from "ist"
import {EditorState, StateField, Facet, tagExtension, EditorSelection, Annotation} from "@codemirror/next/state"

describe("EditorState", () => {
  it("holds doc and selection properties", () => {
    let state = EditorState.create({doc: "hello"})
    ist(state.doc.toString(), "hello")
    ist(state.selection.primary.from, 0)
  })

  it("can apply changes", () => {
    let state = EditorState.create({doc: "hello"})
    let transaction = state.update({changes: [{from: 2, to: 4, insert: "w"}, {from: 5, insert: "!"}]})
    ist(transaction.state.doc.toString(), "hewo!")
  })

  it("maps selection through changes", () => {
    let state = EditorState.create({doc: "abcdefgh",
                                    extensions: [EditorState.allowMultipleSelections.of(true)],
                                    selection: EditorSelection.create([0, 4, 8].map(n => EditorSelection.cursor(n)))})
    let newState = state.update(state.replaceSelection("Q")).state
    ist(newState.doc.toString(), "QabcdQefghQ")
    ist(newState.selection.ranges.map(r => r.from).join("/"), "1/6/11")
  })

  const someAnnotation = Annotation.define<number>()

  it("can store annotations on transactions", () => {
    let tr = EditorState.create({doc: "foo"}).update({annotations: someAnnotation.of(55)})
    ist(tr.annotation(someAnnotation), 55)
  })

  it("throws when a change's bounds are invalid", () => {
    let state = EditorState.create({doc: "1234"})
    ist.throws(() => state.update({changes: {from: -1, to: 1}}))
    ist.throws(() => state.update({changes: {from: 2, to: 1}}))
    ist.throws(() => state.update({changes: {from: 2, to: 10, insert: "x"}}))
  })

  it("stores and updates tab size", () => {
    let deflt = EditorState.create({}), two = EditorState.create({extensions: [EditorState.tabSize.of(2)]})
    ist(deflt.tabSize, 4)
    ist(two.tabSize, 2)
    let updated = deflt.update({reconfigure: {full: EditorState.tabSize.of(8)}}).state
    ist(updated.tabSize, 8)
  })

  it("stores and updates the line separator", () => {
    let deflt = EditorState.create({}), crlf = EditorState.create({extensions: [EditorState.lineSeparator.of("\r\n")]})
    ist(deflt.facet(EditorState.lineSeparator), null)
    ist(deflt.toText("a\nb").lines, 2)
    ist(crlf.facet(EditorState.lineSeparator), "\r\n")
    ist(crlf.toText("a\nb").lines, 1)
    let updated = crlf.update({reconfigure: {full: EditorState.lineSeparator.of("\n")}}).state
    ist(updated.facet(EditorState.lineSeparator), "\n")
  })

  it("stores and updates fields", () => {
    let field1 = StateField.define<number>({create: () => 0, update: val => val + 1})
    let field2 = StateField.define<number>({create: state => state.field(field1) + 10, update: val => val})
    let state = EditorState.create({extensions: [field1, field2]})
    ist(state.field(field1), 0)
    ist(state.field(field2), 10)
    let newState = state.update({}).state
    ist(newState.field(field1), 1)
    ist(newState.field(field2), 10)
  })

  it("can preserve fields across reconfiguration", () => {
    let field = StateField.define({create: () => 0, update: val => val + 1})
    let start = EditorState.create({extensions: [field]}).update({}).state
    ist(start.field(field), 1)
    ist(start.update({reconfigure: {full: field}}).state.field(field), 2)
    ist(start.update({reconfigure: {full: []}}).state.field(field, false), undefined)
  })

  it("can replace extension groups", () => {
    let g = Symbol("A"), f = Facet.define<number>()
    let state = EditorState.create({extensions: [tagExtension(g, f.of(10)), f.of(20)]})
    ist(state.facet(f).join(), "10,20")
    let state2 = state.update({reconfigure: {[g]: [f.of(1), f.of(2)]}}).state
    ist(state2.facet(f).join(), "1,2,20")
    let state3 = state2.update({reconfigure: {[g]: f.of(3)}}).state
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
    let field = StateField.define({create: () => [0], update: (v, tr) => tr.docChanged ? [tr.state.doc.length] : v})
    let facet = Facet.define<number>()
    let state = EditorState.create({
      extensions: [field, facet.compute([field], state => state.field(field)[0]), facet.of(1)]
    })
    ist(state.facet(facet).join(), "0,1")
    let state2 = state.update({}).state
    ist(state2.facet(facet), state.facet(facet))
    let state3 = state.update({changes: {insert: "hi", from: 0}}).state
    ist(state3.facet(facet).join(), "2,1")
  })

  it("tracks indent units", () => {
    let s0 = EditorState.create({})
    ist(s0.indentUnit, 2)
    ist(s0.indentString(4), "    ")
    let s1 = EditorState.create({extensions: EditorState.indentUnit.of("   ")})
    ist(s1.indentUnit, 3)
    ist(s1.indentString(4), "    ")
    let s2 = EditorState.create({extensions: [EditorState.indentUnit.of("\t"), EditorState.tabSize.of(8)]})
    ist(s2.indentUnit, 8)
    ist(s2.indentString(16), "\t\t")
  })

  describe("changeByRange", () => {
    it("can make simple changes", () => {
      let state = EditorState.create({doc: "hi"})
      state = state.update(state.changeByRange(r => ({changes: {from: r.from, to: r.from + 1, insert: "q"},
                                                      range: EditorSelection.cursor(r.from + 1)}))).state
      ist(state.doc.toString(), "qi")
      ist(state.selection.primary.from, 1)
    })

    it("does the right thing when there are multiple selections", () => {
      let state = EditorState.create({
        doc: "1 2 3 4",
        selection: EditorSelection.create([EditorSelection.range(0, 1),
                                           EditorSelection.range(2, 3),
                                           EditorSelection.range(4, 5),
                                           EditorSelection.range(6, 7)]),
        extensions: EditorState.allowMultipleSelections.of(true)
      })
      state = state.update(state.changeByRange(r => ({changes: {from: r.from, to: r.to, insert: "-".repeat((r.from >> 1) + 1)},
                                                      range: EditorSelection.range(r.from, r.from + 1 + (r.from >> 1))}))).state
      ist(state.doc.toString(), "- -- --- ----")
      ist(state.selection.ranges.map(r => r.from + "-" + r.to).join(" "), "0-1 2-4 5-8 9-13")
    })
  })

  describe("changeFilter", () => {
    it("can cancel changes", () => {
      // Cancels all changes that add length
      let state = EditorState.create({extensions: [
        EditorState.changeFilter.of(({changes}) => changes.newLength <= changes.length)
      ], doc: "one two"})
      let tr1 = state.update({changes: {from: 3, insert: " three"}, selection: {anchor: 13}})
      ist(tr1.state.doc.toString(), "one two")
      ist(tr1.state.selection.primary.head, 7)
      let tr2 = state.update({changes: {from: 4, to: 7, insert: "2"}})
      ist(tr2.state.doc.toString(), "one 2")
    })

    it("can split changes", () => {
      // Disallows changes in the middle third of the document
      let state = EditorState.create({extensions: [
        EditorState.changeFilter.of(tr => [Math.floor(tr.startState.doc.length / 3),
                                           Math.floor(2 * tr.startState.doc.length / 3)])
      ], doc: "onetwo"})
      ist(state.update({changes: {from: 0, to: 6}}).state.doc.toString(), "et")
    })

    it("combines filter masks", () => {
      let state = EditorState.create({extensions: [
        EditorState.changeFilter.of(() => [0, 2]),
        EditorState.changeFilter.of(() => [4, 6])
      ], doc: "onetwo"})
      ist(state.update({changes: {from: 0, to: 6}}).state.doc.toString(), "onwo")
    })

    it("can be turned off", () => {
      let state = EditorState.create({extensions: [EditorState.changeFilter.of(() => false)]})
      ist(state.update({changes: {from: 0, insert: "hi"}}).state.doc.length, 0)
      ist(state.update({changes: {from: 0, insert: "hi"}, filter: false}).state.doc.length, 2)
    })
  })

  describe("transactionFilter", () => {
    it("can constrain the selection", () => {
      let state = EditorState.create({
        extensions: EditorState.transactionFilter.of(tr => {
          if (tr.selection && tr.selection.primary.to > 4) return [tr, {selection: {anchor: 4}}]
          else return tr
        }),
        doc: "one two"
      })
      ist(state.update({selection: {anchor: 3}}).selection!.primary.to, 3)
      ist(state.update({selection: {anchor: 7}}).selection!.primary.to, 4)
    }),

    it("can append sequential changes", () => {
      let state = EditorState.create({
        extensions: EditorState.transactionFilter.of(tr => {
          return [tr, {changes: {from: tr.changes.newLength, insert: "!"}, sequential: true}]
        }),
        doc: "one two"
      })
      ist(state.update({changes: {from: 3, insert: ","}}).state.doc.toString(), "one, two!")
    })
  })
})
