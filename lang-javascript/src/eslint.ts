import {Diagnostic} from "@codemirror/next/lint"
import {Text, EditorState} from "@codemirror/next/state"
import {EditorView} from "@codemirror/next/view"
import {javascriptSyntax} from "./javascript"

/// Connects an [ESLint](https://eslint.org/) linter to CodeMirror's
/// [lint](#lint) integration. `eslint` should be an instance of the
/// [`Linter`](https://eslint.org/docs/developer-guide/nodejs-api#linter)
/// class, and `config` an optional ESLint configuration. The return
/// value of this function can be passed to [`linter`](#lint.linter)
/// to create a JavaScript linting extension.
///
/// Note that ESLint targets node, and is tricky to run in the
/// browser. The [eslint4b](https://github.com/mysticatea/eslint4b)
/// and
/// [eslint4b-prebuilt](https://github.com/marijnh/eslint4b-prebuilt/)
/// packages may help with that.
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
    let fromLine = state.doc.lineAt(from), offset = {line: fromLine.number - 1, col: from - fromLine.from, pos: from}
    return eslint.verify(state.sliceDoc(from, to), config)
      .map((val: any) => translateDiagnostic(val, state.doc, offset))
  }

  return (view: EditorView) => {
    let [syntax] = view.state.facet(EditorState.syntax)
    if (syntax == javascriptSyntax) return range(view.state)
    if (!syntax) return []
    let found: Diagnostic[] = []
    // FIXME move to async parsing?
    syntax.getTree(view.state).iterate({
      enter(type, start, end) {
        if (type.isTop && javascriptSyntax.nodeSet.types[type.id] == type) {
          for (let d of range(view.state, start, end)) found.push(d)
          return false
        }
        return undefined
      }
    })
    return found
  }
}

function mapPos(line: number, col: number, doc: Text, offset: {line: number, col: number, pos: number}) {
  return doc.line(line + offset.line).from + col + (line == 1 ? offset.col - 1 : -1)
}

function translateDiagnostic(input: any, doc: Text, offset: {line: number, col: number, pos: number}): Diagnostic {
  let start = mapPos(input.line, input.column, doc, offset)
  let result: Diagnostic = {
    from: start,
    to: input.endLine != null && input.endColumn != 1 ? mapPos(input.endLine, input.endColumn, doc, offset) : start,
    message: input.message,
    source: input.ruleId ? "jshint:" + input.ruleId : "jshint",
    severity: input.severity == 1 ? "warning" : "error",
  }
  if (input.fix) {
    let {range, text} = input.fix, from = range[0] + offset.pos - start, to = range[1] + offset.pos - start
    result.actions = [{
      name: "fix",
      apply(view: EditorView, start: number) {
        view.dispatch({changes: {from: start + from, to: start + to, insert: text}, scrollIntoView: true})
      }
    }]
  }
  return result
}
