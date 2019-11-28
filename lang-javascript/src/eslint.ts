import {Diagnostic} from "../../lint"
import {Text, EditorState} from "../../state"
import {EditorView} from "../../view"
import {javascriptSyntax} from "./javascript"
import {LezerSyntax} from "../../syntax"

export function esLint(eslint: any, config?: any) {
  if (!config) {
    config = {
      parserOptions: {ecmaVersion: 2019, sourceType: "module"},
      env: {browser: true, node: true, es6: true, es2015: true, es2017: true, es2020: true},
      rules: {}
    }
    eslint.getRules().forEach((desc: any, name: string) => {
      if (desc.meta.docs.recommended) config.rules[name] = 2
    })
  }

  function range(state: EditorState, from: number = 0, to: number = state.doc.length) {
    let fromLine = state.doc.lineAt(from)
    return eslint.verify(state.doc.slice(from, to), config)
      .map((val: any) => translateDiagnostic(val, state.doc, fromLine.number - 1, from - fromLine.start))
  }

  return (view: EditorView) => {
    let [syntax] = view.state.behavior(EditorState.syntax)
    if (syntax == javascriptSyntax) return range(view.state)
    if (!syntax || !(syntax instanceof LezerSyntax && syntax.parser.hasNested)) return []
    let found: Diagnostic[] = []
    syntax.getPartialTree(view.state, 0, view.state.doc.length).iterate({
      enter(type, start, end) {
        if (type == javascriptSyntax.docNodeType) {
          for (let d of range(view.state, start, end)) found.push(d)
          return false
        }
        return undefined
      }
    })
    return found
  }
}

function mapPos(line: number, col: number, doc: Text, lineOffset: number, colOffset: number) {
  return doc.line(line + lineOffset).start + col + (line == 1 ? colOffset - 1 : -1)
}

function translateDiagnostic(input: any, doc: Text, lineOffset: number, colOffset: number): Diagnostic {
  let start = mapPos(input.line, input.column, doc, lineOffset, colOffset)
  return {
    from: start,
    to: input.endLine != null ? mapPos(input.endLine, input.endColumn, doc, lineOffset, colOffset) : start,
    message: input.message,
    source: input.ruleId ? "jshint:" + input.ruleId : "jshint",
    severity: input.severity == 1 ? "warning" : "error"
  } // FIXME actions
}
