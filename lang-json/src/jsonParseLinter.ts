import {Diagnostic} from "../../lint/src/lint"
import {EditorView} from "../../view/src"
import {Text} from '../../text'

export const jsonParseLinter = () => (view: EditorView): Diagnostic[] => {
  try {
    JSON.parse(view.state.doc.toString())
  } catch (e) {
    if (e instanceof SyntaxError) {
      const [from, to] = getErrorPosition(e, view.state.doc)
      return [{
        from,
        message: e.message,
        severity: 'error',
        to,
      }]
    }
  }
  return []
}

function getErrorPosition(error: SyntaxError, doc: Text): [number, number] {
  const positionMatch = error.message.match(/at (?:position|line) (\d+)(?: column (\d+))?/)
  let from = 0
  if (positionMatch) {
    const first = from = parseInt(positionMatch[1])
    if (positionMatch[2]) {
      const line = first
      const column = parseInt(positionMatch[2]) - 1
      from = doc.line(line).from + column
    }
  }
  return [from, from]
}