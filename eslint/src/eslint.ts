import Linter from "./eslint4b"
import {linter} from "../../lint"
import {Text} from "../../state"

let eslint = new Linter

export const defaultConfig: any = {
  parserOptions: {ecmaVersion: 2019},
  env: {browser: true, node: true, es6: true, es2015: true, es2017: true, es2020: true},
  rules: {}
}

eslint.getRules().forEach((desc: any, name: string) => {
  if (desc.meta.docs.recommended) defaultConfig.rules[name] = 2
})

export function esLint(config: any = defaultConfig) {
  return linter(view => eslint.verify(view.state.doc.toString(), config)
                .map((val: any) => translateDiagnostic(val, view.state.doc)))
}

function mapPos(line: number, col: number, doc: Text) {
  return doc.line(line).start + col - 1
}

function translateDiagnostic(input: any, doc: Text) {
  let start = mapPos(input.line, input.column, doc)
  return {
    from: start,
    to: input.endLine != null ? mapPos(input.endLine, input.endColumn, doc) : start,
    message: input.message,
    source: input.ruleId ? "jshint:" + input.ruleId : "jshint",
    severity: input.severity == 1 ? "warning" : "error"
  } // FIXME actions
}
