import {Completion, snippetCompletion as snip} from "@codemirror/next/autocomplete"

/// A collection of JavaScript-related
/// [snippets](#autocomplete.snippet).
export const snippets: readonly Completion[] = [
  snip("function ${name}(${params}) {\n\t${}\n}", {
    label: "function",
    detail: "definition",
    type: "keyword"
  }),
  snip("for (let ${index} = 0; ${index} < ${bound}; ${index}++) {\n\t${}\n}", {
    label: "for",
    detail: "loop",
    type: "keyword"
  }),
  snip("for (let ${name} of ${collection}) {\n\t${}\n}", {
    label: "for",
    detail: "of loop",
    type: "keyword"
  }),
  snip("try {\n\t${}\n} catch (${error}) {\n\t${}\n}", {
    label: "try",
    detail: "block",
    type: "keyword"
  }),
  snip("class ${name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}", {
    label: "class",
    detail: "definition",
    type: "keyword"
  }),
  snip("import {${names}} from \"${module}\"\n${}", {
    label: "import",
    detail: "named",
    type: "keyword"
  }),
  snip("import ${name} from \"${module}\"\n${}", {
    label: "import",
    detail: "default",
    type: "keyword"
  })
]
