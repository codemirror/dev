import ist from "ist"
// import {handleInsertion, handleBackspace} from "@codemirror/next/closebrackets"
import {SelectionRange} from "@codemirror/next/state"
import {Text} from "@codemirror/next/text"
// import {StreamSyntax} from "@codemirror/next/stream-syntax"
import { getLinesAcrossRange } from "@codemirror/next/comment"

// function s(doc = "", anchor = 0, head = anchor) {
//   return EditorState.create({doc, selection: EditorSelection.single(anchor, head)})
// }

// function same(s0: null | {doc: Text, selection: EditorSelection}, s1: {doc: Text, selection: EditorSelection}) {
//   ist(s0)
//   ist(s0!.doc.toString(), s1.doc.toString())
//   ist(JSON.stringify(s0!.selection), JSON.stringify(s1.selection))
// }

let lines = [
      '<script>',
      '  // This is a line comment',
      '  const /* inline block-comment */ {readFile} = require("fs");',
      '  /* This is a block comment',
      '     spanning multiple lines */',
      '  readFile("package.json", "utf8", (err, data) => { });',
      '</script>',
      '',
      '<!-- HTML only provides',
      '     block comments -->']

let testDoc = Text.of(lines)

function find(line: number, column: number): number {
  let pos = 0;
  for (let i = 0; i < line - 1; i++) {
    pos += lines[i].length + 1;
  }
  return pos + column - 1;
}

//                 0          1          2           3           4
//                 0123456 7890123 4567890 1234567 8901234 5 67890

      // Text.of((config.doc || "").split(configuration.staticFacet(EditorState.lineSeparator) || DefaultSplit))
// let testState = s("Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n\n")

// let testState = s(testDoc)

describe("comment", () => {
  it("get lines across range", () => {
    const t = (from: number, to: number, expectedLinesNo: number[]) => {
      let lines = getLinesAcrossRange(testDoc, new SelectionRange(from, to))
      ist(lines.map(l => l.start).join(","), expectedLinesNo.join(","))
    }

    t(find(1, 1), find(1, 1), [find(1, 1)])
    t(find(2, 1), find(2, 1), [find(2, 1)])
    t(find(7, 1), find(7, 1), [find(7, 1)])
    // t(find(1, 1), find(lines.length, lines[lines.length-1].length + 1), [find(7, 1)])
    // t(0, 35, [0,7,14,21,28,35])
    // t(0, 6, [0])
    // t(4, 8, [0,7])
    // t(3, 17, [0,7,14])
  })

  it("get range", () => {
    // const t = (from: number, to: number, expectedLinesNo: number[]) => {
    //   toggleComment(CommentOption.Toggle, )
    //   let lines = getLinesAcrossRange(testState.doc, new SelectionRange(from, to))
    //   ist(lines.map(l => l.start).join(","), expectedLinesNo.join(","))
    // }
})
  // const syntax = new StreamSyntax({
  //   docProps: [[languageData, {closeBrackets: {brackets: ["(", "'", "'''"]}}]],
  //   token(stream) {
  //     if (stream.match("'''")) {
  //       while (!stream.match("'''") && !stream.eol()) stream.next()
  //       return "string"
  //     } else if (stream.match("'")) {
  //       while (!stream.match("'") && !stream.eol()) stream.next()
  //       return "string"
  //     } else {
  //       stream.next()
  //       return ""
  //     }
  //   }
  // })

  // function st(doc = "", anchor = 0, head = anchor) {
  //   return EditorState.create({doc, selection: EditorSelection.single(anchor, head), extensions: [syntax.extension]})
  // }

})
