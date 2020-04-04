import ist from "ist"
// import {handleInsertion, handleBackspace} from "@codemirror/next/closebrackets"
import {EditorState, EditorSelection, SelectionRange} from "@codemirror/next/state"
// import {Text} from "@codemirror/next/text"
// import {StreamSyntax} from "@codemirror/next/stream-syntax"
import { getLinesAcrossRange } from "@codemirror/next/comment"

function s(doc = "", anchor = 0, head = anchor) {
  return EditorState.create({doc, selection: EditorSelection.single(anchor, head)})
}

// function same(s0: null | {doc: Text, selection: EditorSelection}, s1: {doc: Text, selection: EditorSelection}) {
//   ist(s0)
//   ist(s0!.doc.toString(), s1.doc.toString())
//   ist(JSON.stringify(s0!.selection), JSON.stringify(s1.selection))
// }

//                 0          1           2          3 
//                 0123456 7890123 456789 0123456 7890123456789
let testState = s("Line 1\nLine 2\nLine 3\nLine 4\Line 5")

describe("comment", () => {
  it("get lines across range", () => {
    ist(getLinesAcrossRange(testState.doc, new SelectionRange(0, 6)).map(l => l.start).join(","), "0")
    ist(getLinesAcrossRange(testState.doc, new SelectionRange(4, 8)).map(l => l.start).join(","), "0,7")
    ist(getLinesAcrossRange(testState.doc, new SelectionRange(3, 17)).map(l => l.start).join(","), "0,7,14")
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
