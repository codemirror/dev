import ist from "ist"
import {SelectionRange, EditorState, EditorSelection, Transaction } from "@codemirror/next/state"
import {Text} from "@codemirror/next/text"
import { toggleLineComment, getLinesInRange, insertLineComment, removeLineComment, CommentOption, toggleBlockComment } from "@codemirror/next/comment"

describe("comment", () => {
  it("get lines across range", () => {
    //                 0          1          2           3
    //                 0123456 7890123 4567890 1234567 8901234 5
    let doc = Text.of("Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n\n".split("\n"))
    const t = (from: number, to: number, expectedLinesNo: number[]) => {
      let lines = getLinesInRange(doc, new SelectionRange(from, to))
      ist(lines.map(l => l.start).join(","), expectedLinesNo.join(","))
    }

    t(0, 0, [0])
    t(7, 7, [7])
    t(16, 16, [14])
    t(0, 35, [0,7,14,21,28,35])
    t(0, 6, [0])
    t(4, 8, [0,7])
    t(3, 17, [0,7,14])
  })

  /// Creates a new `EditorState` using `doc` as the document text.
  /// The selection ranges in the returned state can be specified
  /// within the `doc` argument:
  /// The character `|` is used a marker to indicate both the
  /// start and the end of a `SelectionRange`, *e.g.*,
  ///
  /// ```typescript
  /// s("line 1\nlin|e 2\nline 3")
  /// ```
  function s(doc: string): EditorState {
    const markers = []
    let pos = doc.indexOf("|", 0)
    while (pos >= 0) {
      markers.push(pos)
      doc = doc.slice(0, pos) + doc.slice(pos + 1)
      pos = doc.indexOf("|", pos)
    }

    if (markers.length > 2 && markers.length % 2 != 0) {
      throw "Markers for multiple selections need to be even.";
    }

    const ranges: SelectionRange[] = []
    for (let i = 0; i < markers.length; i += 2) {
      if (i + 1 < markers.length) {
        ranges.push(new SelectionRange(markers[i], markers[i+1]))
      } else {
        ranges.push(new SelectionRange(markers[i]))
      }
    }
    if (ranges.length == 0) {
        ranges.push(new SelectionRange(0))
    }

    return EditorState.create({
      doc,
      selection: EditorSelection.create(ranges),
      extensions: EditorState.allowMultipleSelections.of(true),
      })
  }

  function same(actualState: null | {doc: Text, selection: EditorSelection}, expectedState: {doc: Text, selection: EditorSelection}) {
    ist(actualState)
    ist(actualState!.doc.toString(), expectedState.doc.toString())
    ist(JSON.stringify(actualState!.selection), JSON.stringify(expectedState.selection))
  }

  const checkToggleChain = (toggle: (st: EditorState) => Transaction | null) => (...states: EditorState[]) => {
    let st = states[0]
    for (let i = 1; i < states.length; i++) {
      st = toggle(st)!.apply()
      same(st, states[i])
    }
    return {
      tie: (index: number) => {
        st = toggle(st)!.apply()
        same(st, states[index])
      }
    }
  }

  /// Runs all tests for the given line-comment token, `k`.
  function runLineCommentTests(k: string) {

    it(`inserts/removes '${k}' line comment in a single line`, () => {
      let st0 = s(`line 1\n${k}line 2\nline 3`)
      let st1 = removeLineComment(st0.t(), 7, k, 0).apply()
      same(st1, s(`line 1\nline 2\nline 3`))
      let st2 = insertLineComment(st1.t(), 7, k).apply()
      same(st2, s(`line 1\n${k} line 2\nline 3`))
      let st3 = removeLineComment(st2.t(), 7, k).apply()
      same(st3, st1)
    })

    const check = checkToggleChain(toggleLineComment(CommentOption.Toggle, k))

    it(`toggles '${k}' comments in an empty single selection`, () => {
      check(
        s(`\nline 1\n  ${k} ${k} ${k} ${k}line| 2\nline 3\n`),
        s(`\nline 1\n  ${k} ${k} ${k}line| 2\nline 3\n`),
        s(`\nline 1\n  ${k} ${k}line| 2\nline 3\n`),
        s(`\nline 1\n  ${k}line| 2\nline 3\n`),
        s(`\nline 1\n  line| 2\nline 3\n`),
        s(`\nline 1\n  ${k} line| 2\nline 3\n`)
        ).tie(4)

      check(
        s(`\nline 1\n  ${k}line 2|\nline 3\n`),
        s(`\nline 1\n  line 2|\nline 3\n`),
        s(`\nline 1\n  ${k} line 2|\nline 3\n`)
        ).tie(1)

      check(
        s(`\nline 1\n|  ${k}line 2\nline 3\n`),
        s(`\nline 1\n|  line 2\nline 3\n`),
        s(`\nline 1\n|  ${k} line 2\nline 3\n`)
        ).tie(1)

      check(
        s(`\nline 1\n|${k}\nline 3\n`),
        s(`\nline 1\n|\nline 3\n`),
        s(`\nline 1\n|${k} \nline 3\n`)
        ).tie(1)

      check(
        s(`\nline 1\n line 2\nline 3\n|${k}`),
        s(`\nline 1\n line 2\nline 3\n|`),
        s(`\nline 1\n line 2\nline 3\n|${k} `)
        ).tie(1)
    })

    it(`toggles '${k}' comments in a single line selection`, () => {
      check(
        s(`line 1\n  ${k}li|ne |2\nline 3\n`),
        s(`line 1\n  li|ne |2\nline 3\n`),
        s(`line 1\n  ${k} li|ne |2\nline 3\n`)
        ).tie(1)
    })

    it(`toggles '${k}' comments in a multi-line selection`, () => {
      check(
        s(`\n  ${k}lin|e 1\n  ${k}  line 2\n  ${k} line |3\n`),
        s(`\n  lin|e 1\n   line 2\n  line |3\n`),
        s(`\n  ${k} lin|e 1\n  ${k}  line 2\n  ${k} line |3\n`),
        ).tie(1)

      check(
        s(`\n  ${k}lin|e 1\n  ${k}  line 2\n   line 3\n  ${k} li|ne 4\n`),
        s(`\n  ${k} ${k}lin|e 1\n  ${k} ${k}  line 2\n  ${k}  line 3\n  ${k} ${k} li|ne 4\n`),
        ).tie(0)

      check(
        s(`\n  ${k} lin|e 1\n\n  ${k} line |3\n`),
        s(`\n  lin|e 1\n\n  line |3\n`),
        ).tie(0)

      check(
        s(`\n  ${k} lin|e 1\n     \n  ${k} line |3\n`),
        s(`\n  lin|e 1\n     \n  line |3\n`),
        ).tie(0)

      check(
        s(`\n|\n  ${k} line 2\n    | \n`),
        s(`\n|\n  line 2\n    | \n`),
        ).tie(0)

      check(
        s(`\n|\n\n    | \n`),
        s(`\n|\n\n    | \n`),
        ).tie(0)
    })

    it(`toggles '${k}' comments in a multi-line multi-range selection`, () => {
      check(
        s(`\n  lin|e 1\n  line |2\n  line 3\n  l|ine 4\n  line| 5\n`),
        s(`\n  ${k} lin|e 1\n  ${k} line |2\n  line 3\n  ${k} l|ine 4\n  ${k} line| 5\n`),
        ).tie(0)
    })

  }

  /// Runs all tests for the given block-comment tokens.
  function runBlockCommentTests(o: string, c: string) {

    const check = checkToggleChain(toggleBlockComment(CommentOption.Toggle, {open: o, close: c}))

    it.skip(`toggles ${o} ${c} block comment in multi-line selection`, () => {
      check(
        s(`\n  lin|e 1\n  line 2\n  line 3\n  line |4\n  line 5\n`),
        s(`\n  lin${o}|e 1\n  line 2\n  line 3\n  line |${c}4\n  line 5\n`),
        ).tie(0)
    })

  }

  runLineCommentTests("//")

  runLineCommentTests("#")

  runBlockCommentTests("/*", "*/")

  runBlockCommentTests("<!--", "-->")

})
