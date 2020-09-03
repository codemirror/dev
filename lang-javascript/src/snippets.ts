import {SnippetSpec} from "@codemirror/next/autocomplete"

/// A collection of JavaScript-related
/// [snippets](#autocomplete.snippet).
export const snippets: readonly SnippetSpec[] = [
  {label: "function",
   detail: "definition",
   type: "keyword",
   snippet: "function ${name}(${params}) {\n\t${}\n}"},
  {label: "for",
   detail: "loop",
   type: "keyword",
   snippet: "for (let ${index} = 0; ${index} < ${bound}; ${index}++) {\n\t${}\n}"},
  {label: "for",
   detail: "of loop",
   type: "keyword",
   snippet: "for (let ${name} of ${collection}) {\n\t${}\n}"},
  {label: "try",
   detail: "block",
   type: "keyword",
   snippet: "try {\n\t${}\n} catch (${error}) {\n\t${}\n}"},
  {label: "class",
   detail: "definition",
   type: "keyword",
   snippet: "class ${name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}"},
  {label: "import",
   detail: "named",
   type: "keyword",
   snippet: "import {${names}} from \"${module}\"\n${}"},
  {label: "import",
   detail: "default",
   type: "keyword",
   snippet: "import ${name} from \"${module}\"\n${}"}
]
