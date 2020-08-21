import {SnippetSpec} from "@codemirror/next/autocomplete"

/// A collection of JavaScript-related
/// [snippets](#autocomplete.snippet).
export const snippets: readonly SnippetSpec[] = [
  {keyword: "function",
   detail: "definition",
   snippet: "function ${name}(${params}) {\n\t${}\n}"},
  {keyword: "for",
   detail: "loop",
   snippet: "for (let ${index} = 0; ${index} < ${bound}; ${index}++) {\n\t${}\n}"},
  {keyword: "for",
   detail: "of loop",
   snippet: "for (let ${name} of ${collection}) {\n\t${}\n}"},
  {keyword: "try",
   detail: "block",
   snippet: "try {\n\t${}\n} catch (${error}) {\n\t${}\n}"},
  {keyword: "class",
   detail: "definition",
   snippet: "class ${name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}"},
  {keyword: "import",
   detail: "named",
   snippet: "import {${names}} from \"${module}\"\n${}"},
  {keyword: "import",
   detail: "default",
   snippet: "import ${name} from \"${module}\"\n${}"}
]
