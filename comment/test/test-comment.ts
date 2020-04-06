import ist from "ist"
import {SelectionRange, EditorState, EditorSelection } from "@codemirror/next/state"
import {Text} from "@codemirror/next/text"
import { toggleLineComment, getLinesAcrossRange, insertLineComment, removeLineComment, CommentOption } from "@codemirror/next/comment"

function s(doc: string): EditorState {
  let anchors = []
  let pos = doc.indexOf("|", 0)
  while (pos >= 0) {
    anchors.push(pos)
    doc = doc.slice(0, pos) + doc.slice(pos + 1)
    pos = doc.indexOf("|", pos)
  }

  let selection = []
  for (let i = 0; i < anchors.length; i++) {
    if (i + 1 < anchors.length) {
      selection.push(new SelectionRange(anchors[i], anchors[i+1]))
    } else {
      selection.push(new SelectionRange(anchors[i]))
    }
  }
  if (selection.length == 0) {
      selection.push(new SelectionRange(0))
  }

  return EditorState.create({doc, selection: new EditorSelection(selection)})
}

function same(actualState: null | {doc: Text, selection: EditorSelection}, expectedState: {doc: Text, selection: EditorSelection}) {
  ist(actualState)
  ist(actualState!.doc.toString(), expectedState.doc.toString())
  ist(JSON.stringify(actualState!.selection), JSON.stringify(expectedState.selection))
}

let lines = [
      '<script>',
      '  // This is a line comment',
      '  const {readFile} = require("fs");',
      '',
      '  /* This is an inline block-comment */',
      '  /* This is a block comment',
      '     spanning multiple lines */',
      '  readFile("package.json", "utf8", (err, data) => { });',
      '</script>',
      '<!-- HTML only provides',
      '     block comments -->']

export let testDoc = Text.of(lines)

export function find(line: number, column: number): number {
  let pos = 0;
  for (let i = 0; i < line - 1; i++) {
    pos += lines[i].length + 1;
  }
  return pos + column - 1;
}

describe("comment", () => {
  it("get lines across range", () => {
    //                 0          1          2           3
    //                 0123456 7890123 4567890 1234567 8901234 5
    let doc = Text.of("Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n\n".split("\n"))
    const t = (from: number, to: number, expectedLinesNo: number[]) => {
      let lines = getLinesAcrossRange(doc, new SelectionRange(from, to))
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

  function runCommentTests(k: string) {

    it(`inserts/removes '${k}' line comment in a single line`, () => {
      let st0 = s(`line 1\n${k}line 2\nline 3`)
      let st1 = removeLineComment(st0.t(), 7, k, 0).apply()
      same(st1, s(`line 1\nline 2\nline 3`))
      let st2 = insertLineComment(st1.t(), 7, k).apply()
      same(st2, s(`line 1\n${k} line 2\nline 3`))
      let st3 = removeLineComment(st2.t(), 7, k).apply()
      same(st3, st1)
    })

    function applyToggleChain(...states: EditorState[]) {
      const toggle = (state: EditorState) => 
        toggleLineComment(CommentOption.Toggle, k)(state, state.selection.primary)!

      let st = states[0]
      for (let i = 1; i < states.length; i++) {
        st = toggle(st)?.apply()
        same(st, states[i])
      }
      return {
        tie: (index: number) => {
          st = toggle(st)?.apply()
          same(st, states[index])
        }
      }
    }

    it(`toggles '${k}' comments in an empty single selection`, () => {
      applyToggleChain(
        s(`\nline 1\n  ${k}line| 2\nline 3\n`),
        s(`\nline 1\n  line| 2\nline 3\n`),
        s(`\nline 1\n  ${k} line| 2\nline 3\n`)
        ).tie(1)

      applyToggleChain(
        s(`\nline 1\n  ${k}line 2|\nline 3\n`),
        s(`\nline 1\n  line 2|\nline 3\n`),
        s(`\nline 1\n  ${k} line 2|\nline 3\n`)
        ).tie(1)

      applyToggleChain(
        s(`\nline 1\n|  ${k}line 2\nline 3\n`),
        s(`\nline 1\n|  line 2\nline 3\n`),
        s(`\nline 1\n|  ${k} line 2\nline 3\n`)
        ).tie(1)

      applyToggleChain(
        s(`\nline 1\n|${k}\nline 3\n`),
        s(`\nline 1\n|\nline 3\n`),
        s(`\nline 1\n|${k} \nline 3\n`)
        ).tie(1)

      applyToggleChain(
        s(`\nline 1\n line 2\nline 3\n|${k}`),
        s(`\nline 1\n line 2\nline 3\n|`),
        s(`\nline 1\n line 2\nline 3\n|${k} `)
        ).tie(1)
    })

    it(`toggles '${k}' comments in a single line selection`, () => {
      applyToggleChain(
        s(`line 1\n  ${k}li|ne |2\nline 3\n`),
        s(`line 1\n  li|ne |2\nline 3\n`),
        s(`line 1\n  ${k} li|ne |2\nline 3\n`)
        ).tie(1)
    })

    it(`toggles '${k}' comments in a multi-line selection`, () => {
      applyToggleChain(
        s(`\n  ${k}lin|e 1\n  ${k}  line 2\n  ${k} line |3\n`),
        s(`\n  lin|e 1\n   line 2\n  line |3\n`),
        s(`\n  ${k} lin|e 1\n  ${k}  line 2\n  ${k} line |3\n`)
        ).tie(1)
    })

    it(`toggles '${k}' comments in a multi-line (partially commented) selection`, () => {
      applyToggleChain(
        s(`\n  ${k}lin|e 1\n  ${k}  line 2\n   line 3\n  ${k} li|ne 4\n`),
        s(`\n  ${k} ${k}lin|e 1\n  ${k} ${k}  line 2\n  ${k}  line 3\n  ${k} ${k} li|ne 4\n`)
        ).tie(0)
    })

  }

  runCommentTests("//")

  runCommentTests("#")

})
