import {Diagnostic} from "../../lint"
import {Text} from "../../state"
import {EditorView} from "../../view"

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
  return (view: EditorView) => eslint.verify(view.state.doc.toString(), config)
                .map((val: any) => translateDiagnostic(val, view.state.doc))
}

function mapPos(line: number, col: number, doc: Text) {
  return doc.line(line).start + col - 1
}

function translateDiagnostic(input: any, doc: Text): Diagnostic {
  let start = mapPos(input.line, input.column, doc)
  return {
    from: start,
    to: input.endLine != null ? mapPos(input.endLine, input.endColumn, doc) : start,
    message: input.message,
    source: input.ruleId ? "jshint:" + input.ruleId : "jshint",
    severity: input.severity == 1 ? "warning" : "error"
  } // FIXME actions
}
