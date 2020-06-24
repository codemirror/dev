import ist from "ist"
import {SelectionRange, EditorState, EditorSelection, Extension, StateCommand} from "@codemirror/next/state"
import {toggleLineComment, CommentTokens, toggleBlockComment} from "@codemirror/next/comment"
import {htmlSyntax} from "@codemirror/next/lang-html"

describe("comment", () => {
  const defaultConfig: CommentTokens = {line: "//", block: {open: "/*", close: "*/"}}

  /// Creates a new `EditorState` using `doc` as the document text.
  /// The selection ranges in the returned state can be specified
  /// within the `doc` argument:
  /// The character `|` is used a marker to indicate both the
  /// start and the end of a `SelectionRange`, *e.g.*,
  ///
  /// ```typescript
  /// s("line 1\nlin|e 2\nline 3")
  /// ```
  function s(doc: string, config: CommentTokens = defaultConfig, extensions: readonly Extension[] = []): EditorState {
    let markers = [], pos
    while ((pos = doc.indexOf("|", 0)) >= 0) {
      markers.push(pos)
      doc = doc.slice(0, pos) + doc.slice(pos + 1)
    }

    const ranges: SelectionRange[] = []
    if (markers.length == 1) {
      ranges.push(EditorSelection.cursor(markers[0]))
    } else if (markers.length % 2 != 0) {
      throw "Markers for multiple selections need to be even.";
    } else {
      for (let i = 0; i < markers.length; i += 2)
        ranges.push(EditorSelection.range(markers[i], markers[i + 1]))
      if (ranges.length == 0) ranges.push(EditorSelection.cursor(0))
    }

    return EditorState.create({
      doc,
      selection: EditorSelection.create(ranges),
      extensions: [EditorState.allowMultipleSelections.of(true),
                   EditorState.globalLanguageData.of({commentTokens: config})].concat(extensions)
    })
  }

  function same(actualState: EditorState, expectedState: EditorState) {
    ist(actualState.doc.toString(), expectedState.doc.toString())
    ist(JSON.stringify(actualState.selection), JSON.stringify(expectedState.selection))
  }

  function checkToggleChain(toggle: StateCommand, config: CommentTokens, docs: string[]) {
    let state = s(docs[0], config)
    for (let i = 1; i <= docs.length; i++) {
      toggle({state, dispatch(tr) { state = tr.state }})
      same(state, s(docs[i == docs.length ? docs.length - 2 : i], config))
    }
  }

  // Runs all tests for the given line-comment token, `k`.
  function runLineCommentTests(k: string) {
    function check(...docs: string[]) {
      checkToggleChain(toggleLineComment, {line: k}, docs)
    }

    describe(`Line comments ('${k}')`, () => {
      it("toggles in an empty single selection", () => {
        check(`\nline 1\n  ${k} ${k} ${k} ${k}line| 2\nline 3\n`,
              `\nline 1\n  ${k} ${k} ${k}line| 2\nline 3\n`,
              `\nline 1\n  ${k} ${k}line| 2\nline 3\n`,
              `\nline 1\n  ${k}line| 2\nline 3\n`,
              `\nline 1\n  line| 2\nline 3\n`,
              `\nline 1\n  ${k} line| 2\nline 3\n`)

        check(`\nline 1\n  ${k}line 2|\nline 3\n`,
              `\nline 1\n  line 2|\nline 3\n`,
              `\nline 1\n  ${k} line 2|\nline 3\n`)

        check(`\nline 1\n|  ${k}line 2\nline 3\n`,
              `\nline 1\n|  line 2\nline 3\n`,
              `\nline 1\n|  ${k} line 2\nline 3\n`)

        check(`\nline 1\n|${k}\nline 3\n`,
              `\nline 1\n|\nline 3\n`,
              `\nline 1\n|${k} \nline 3\n`)

        check(`\nline 1\n line 2\nline 3\n|${k}`,
              `\nline 1\n line 2\nline 3\n|`,
              `\nline 1\n line 2\nline 3\n|${k} `)
      })

      it("toggles comments in a single line when the cursor is at the beginning", () => {
        check(`line 1\n  |line 2\nline 3\n`,
              `line 1\n  |${k} line 2\nline 3\n`)
      })

      it("toggles comments in a single line selection", () => {
        check(`line 1\n  ${k}li|ne |2\nline 3\n`,
              `line 1\n  li|ne |2\nline 3\n`,
              `line 1\n  ${k} li|ne |2\nline 3\n`)
      })

      it("toggles comments in a multi-line selection", () => {
        check(`\n  ${k}lin|e 1\n  ${k}  line 2\n  ${k} line |3\n`,
              `\n  lin|e 1\n   line 2\n  line |3\n`,
              `\n  ${k} lin|e 1\n  ${k}  line 2\n  ${k} line |3\n`)

        check(`\n  ${k}lin|e 1\n  ${k}  line 2\n   line 3\n  ${k} li|ne 4\n`,
              `\n  ${k} ${k}lin|e 1\n  ${k} ${k}  line 2\n  ${k}  line 3\n  ${k} ${k} li|ne 4\n`)

        check(`\n  ${k} lin|e 1\n\n  ${k} line |3\n`,
              `\n  lin|e 1\n\n  line |3\n`)

        check(`\n  ${k} lin|e 1\n     \n  ${k} line |3\n`,
              `\n  lin|e 1\n     \n  line |3\n`)

        check(`\n|\n  ${k} line 2\n    | \n`,
              `\n|\n  line 2\n    | \n`)

        check(`\n|\n\n    | \n`,
              `\n|\n\n    | \n`)
      })

      it("toggles comments in a multi-line multi-range selection", () => {
        check(`\n  lin|e 1\n  line |2\n  line 3\n  l|ine 4\n  line| 5\n`,
              `\n  ${k} lin|e 1\n  ${k} line |2\n  line 3\n  ${k} l|ine 4\n  ${k} line| 5\n`)
      })
    })
  }

  /// Runs all tests for the given block-comment tokens.
  function runBlockCommentTests(o: string, c: string) {
    describe(`Block comments ('${o} ${c}')`, () => {
      function check(...docs: string[]) {
        checkToggleChain(toggleBlockComment, {block: {open: o, close: c}}, docs)
      }

      it("toggles block comment in multi-line selection", () => {
        check(`\n  lin|e 1\n  line 2\n  line 3\n  line |4\n  line 5\n`,
              `\n  lin${o} |e 1\n  line 2\n  line 3\n  line | ${c}4\n  line 5\n`)
      })

      it("toggles block comment in multi-line multi-range selection", () => {
        check(`\n  lin|e 1\n  line |2\n  l|ine 3\n  line 4\n  line |5\n`,
              `\n  lin${o} |e 1\n  line | ${c}2\n  l${o} |ine 3\n  line 4\n  line | ${c}5\n`)
      })

      it("can toggle comments inside the selection", () => {
        check(`|${o} one\ntwo ${c}| three`,
              `|one\ntwo| three`,
              `${o} |one\ntwo| ${c} three`)
      })
    })
  }

  runLineCommentTests("//")

  runLineCommentTests("#")

  runBlockCommentTests("/*", "*/")

  runBlockCommentTests("<!--", "-->")

  it("toggles line comment in multi-language doc", () => {
    let state = s(`<script>
  // This is a |line comment
  console.log("Hello");
</script>
<!-- HTML only provides block comments -->`, undefined, [htmlSyntax])

    toggleLineComment({state, dispatch(tr) { state = tr.state }})
    same(state, s(`<script>
  This is a |line comment
  console.log("Hello");
</script>
<!-- HTML only provides block comments -->`))
  })
})
