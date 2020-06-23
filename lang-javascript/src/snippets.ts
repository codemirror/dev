import {SnippetSpec} from "@codemirror/next/autocomplete"

/// A collection of JavaScript-related
/// [snippets](#autocomplete.snippet).
export const snippets: readonly SnippetSpec[] = [
  {keyword: "function",
   name: "function definition",
   snippet: "function ${name}(${params}) {\n\t${}\n}"},
  {keyword: "for",
   name: "for loop",
   snippet: "for (let ${index} = 0; ${index} < ${bound}; ${index}++) {\n\t${}\n}"},
  {keyword: "for",
   name: "for of loop",
   snippet: "for (let ${name} of ${collection}) {\n\t${}\n}"},
  {keyword: "try",
   name: "try block",
   snippet: "try {\n\t${}\n} catch (${error}) {\n\t${}\n}"},
  {keyword: "class",
   name: "class definition",
   snippet: "class ${name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}"},
  {keyword: "import",
   name: "import named",
   snippet: "import {${names}} from \"${module}\"\n${}"},
  {keyword: "import",
   name: "import default",
   snippet: "import ${name} from \"${module}\"\n${}"}
]
