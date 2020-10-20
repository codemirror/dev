import {Diagnostic} from "../../lint/src/lint"
import {EditorView} from "../../view/src"
import {Text} from "../../text"

/// Calls
/// [`JSON.parse`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse)
/// on the document and, if that throws an error, reports it as a
/// single diagnostic.
export const jsonParseLinter = () => (view: EditorView): Diagnostic[] => {
  try {
    JSON.parse(view.state.doc.toString())
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e
    const pos = getErrorPosition(e, view.state.doc)
    return [{
      from: pos,
      message: e.message,
      severity: 'error',
      to: pos
    }]
  }
  return []
}

function getErrorPosition(error: SyntaxError, doc: Text): number {
  let m
  if (m = error.message.match(/at position (\d+)/))
    return Math.min(+m[1], doc.length)
  if (m = error.message.match(/at line (\d+) column (\d+)/))
    return Math.min(doc.line(+m[1]).from + (+m[2]) - 1, doc.length)
  return 0
}
