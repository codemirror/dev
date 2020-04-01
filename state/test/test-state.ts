import ist from "ist"
import {EditorState, StateField, Facet, ExtensionGroup, Change, EditorSelection, SelectionRange, Annotation} from "@codemirror/next/state"

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
    let field1 = StateField.define<number>({create: () => 0, update: val => val + 1})
    let field2 = StateField.define<number>({create: state => state.field(field1) + 10, update: val => val})
    let state = EditorState.create({extensions: [field1, field2]})
    ist(state.field(field1), 0)
    ist(state.field(field2), 10)
    let newState = state.t().apply()
    ist(newState.field(field1), 1)
    ist(newState.field(field2), 10)
  })

  it("can preserve fields across reconfiguration", () => {
    let field = StateField.define({create: () => 0, update: val => val + 1})
    let start = EditorState.create({extensions: [field]}).t().apply()
    ist(start.field(field), 1)
    ist(start.t().reconfigure([field]).apply().field(field), 2)
    ist(start.t().reconfigure([]).apply().field(field, false), undefined)
  })

  it("can replace extension groups", () => {
    let g = new ExtensionGroup("A"), f = Facet.define<number>()
    let state = EditorState.create({extensions: [g.of(f.of(10)), f.of(20)]})
    ist(state.facet(f).join(), "10,20")
    let state2 = state.t().replaceExtension(g, [f.of(1), f.of(2)]).apply()
    ist(state2.facet(f).join(), "1,2,20")
    let state3 = state2.t().replaceExtension(g, f.of(3)).apply()
    ist(state3.facet(f).join(), "3,20")
  })

  it("raises an error on duplicate extension groups", () => {
    let g = new ExtensionGroup("g"), f = Facet.define<number>()
    ist.throws(() => EditorState.create({extensions: [g.of(f.of(1)), g.of(f.of(2))]}),
               /duplicate use of group/i)
    ist.throws(() => EditorState.create({extensions: g.of(g.of(f.of(1)))}),
               /duplicate use of group/i)
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

  describe("changeFilter", () => {
    it("can cancel changes", () => {
      // Cancels changes that start on an odd position
      let state = EditorState.create({extensions: [EditorState.changeFilter.of(change => change.from % 2 ? [] : null)],
                                      doc: "one two"})
      state = state.t().replace(1, 5, "x").apply()
      ist(state.doc.toString(), "one two")
      state = state.t().replace(0, 1, "x").replace(1, 2, "x").replace(2, 3, "x").apply()
      ist(state.doc.toString(), "xnx two")
    })

    it("can split changes", () => {
      let state = EditorState.create({
        extensions: [EditorState.changeFilter.of(change => {
          return [new Change(change.from, change.from + 1, change.text),
                  new Change(change.to - 1, change.to, ["."])]
        })],
        doc: "one two"
      })
      ist(state.t().replace(0, 7, "--").doc.toString(), "--ne tw.")
    })

    it("properly maps changes for multiple splits", () => {
      let state = EditorState.create({
        extensions: [EditorState.changeFilter.of(ch => [new Change(ch.from, ch.from, ["x"]), new Change(ch.from, ch.from, ch.text)]),
                     EditorState.changeFilter.of(ch => [new Change(ch.from, ch.from, ["y"]), new Change(ch.from, ch.from, ch.text)])]
      })
      ist(state.t().replace(0, 0, "?").doc.toString(), "xyx?")
    })
  })

  describe("selectionFilter", () => {
    it("can constrain the selection", () => {
      let state = EditorState.create({
        extensions: [EditorState.selectionFilter.of(sel => sel.primary.to < 4 ? sel : EditorSelection.single(4))],
        doc: "one two"
      })
      let tr = state.t()
      tr.setSelection(EditorSelection.single(3))
      ist(tr.selection.primary.to, 3)
      tr.setSelection(EditorSelection.single(7))
      ist(tr.selection.primary.to, 4)
      ist(tr.apply().selection.primary.to, 4)
    })
  })
})
