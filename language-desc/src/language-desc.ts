import {Language} from "@codemirror/next/language"
import {Extension} from "@codemirror/next/state"
import {StreamParser} from "@codemirror/next/stream-parser"

/// Language descriptions are used to store metadata about languages
/// and to dynamically load them. Their main role is finding the
/// appropriate language for a filename or dynamically loading nested
/// parsers.
export class LanguageDescription {
  /// If the language has been loaded, this will hold its value.
  language: Language | undefined = undefined
  /// If the language has been loaded _and_ it provides support
  /// extensions, they will be available here.
  support: Extension | undefined = undefined

  private loading: Promise<LanguageDescription> | null = null

  private constructor(
    /// The name of this mode.
    readonly name: string,
    /// Alternative names for the mode (lowercased, includes `this.name`).
    readonly alias: readonly string[],
    /// File extensions associated with this language.
    readonly extensions: readonly string[],
    /// Optional filename pattern that should be associated with this
    /// language.
    readonly filename: RegExp | undefined,
    private loadFunc: () => Promise<{language: Language, support?: Extension}>
  ) {}

  /// Start loading the the language. Will return a promise that
  /// resolves to this object itself when the language successfully
  /// loads.
  load(): Promise<LanguageDescription> {
    return this.loading || (this.loading = this.loadFunc().then(result => {
      this.language = result.language
      this.support = result.support
      return this
    }, err => {
      this.loading = null
      throw err
    }))
  }

  /// Create a language description.
  static of(spec: {
    /// The language's name.
    name: string,
    /// An optional array of alternative names.
    alias?: readonly string[],
    /// An optional array of extensions associated with this language.
    extensions?: readonly string[],
    /// An optional filename pattern associated with this language.
    filename?: RegExp,
    /// A function that will asynchronously load the language.
    load: () => Promise<{language: Language, support?: Extension}>
  }) {
    return new LanguageDescription(spec.name, (spec.alias || []).concat(spec.name).map(s => s.toLowerCase()),
                                   spec.extensions || [], spec.filename, spec.load)
  }

  /// Look for a language in the given array of descriptions that
  /// matches the filename. Will first match
  /// [`filename`](#language.LanguageDescription.filename) patterns,
  /// and then [extensions](#language.LanguageDescription.extensions),
  /// and return the first language that matches.
  static matchFilename(descs: readonly LanguageDescription[], filename: string) {
    for (let d of descs) if (d.filename && d.filename.test(filename)) return d
    let ext = /\.([^.]+)$/.exec(filename)
    if (ext) for (let d of descs) if (d.extensions.indexOf(ext[1]) > -1) return d
    return null
  }

  /// Look for a language whose name or alias matches the the given
  /// name (case-insensitively). If `fuzzy` istrue, and no direct
  /// matchs is found, this'll also search for a language whose name
  /// or alias occurs in the string (for names shorter than three
  /// characters, only when surrounded by non-word characters).
  static matchLanguageName(descs: readonly LanguageDescription[], name: string, fuzzy = true) {
    name = name.toLowerCase()
    for (let d of descs) if (d.alias.some(a => a == name)) return d
    if (fuzzy) for (let d of descs) for (let a of d.alias) {
      let found = name.indexOf(a)
      if (found > -1 && (a.length > 2 || !/\w/.test(name[found - 1]) && !/\w/.test(name[found + a.length])))
        return d
    }
    return null
  }
}

function legacy(parser: StreamParser<unknown>): Promise<{language: Language}> {
  return import("@codemirror/next/stream-parser").then(m => ({language: m.StreamLanguage.define(parser)}))
}

function sql(dialectName: keyof typeof import("@codemirror/next/lang-sql")) {
  return import("@codemirror/next/lang-sql").then(m => {
    let dialect = (m as any)[dialectName]
    return {language: dialect.language, support: m.sqlSupport({dialect})}
  })
}

/// An array of language descriptions for known language packages.
export const languages = [
  // New-style language modes

  LanguageDescription.of({
    name: "C",
    extensions: ["c","h","ino"],
    load() {
      return import("@codemirror/next/lang-cpp").then(m => ({language: m.cppLanguage}))
    }
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp"],
    extensions: ["cpp","c++","cc","cxx","hpp","h++","hh","hxx"],
    load() {
      return import("@codemirror/next/lang-cpp").then(m => ({language: m.cppLanguage}))
    }
  }),
  LanguageDescription.of({
    name: "CQL",
    alias: ["cassandra"],
    extensions: ["cql"],
    load() { return sql("Cassandra") }
  }),
  LanguageDescription.of({
    name: "CSS",
    extensions: ["css"],
    load() {
      return import("@codemirror/next/lang-css").then(m => ({language: m.cssLanguage}))
    }
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["xhtml"],
    extensions: ["html", "htm", "handlebars", "hbs"],
    load() {
      return import("@codemirror/next/lang-html").then(m => ({language: m.htmlLanguage, support: m.htmlSupport()}))
    }
  }),
  LanguageDescription.of({
    name: "Java",
    extensions: ["java"],
    load() {
      return import("@codemirror/next/lang-java").then(m => ({language: m.javaLanguage}))
    }
  }),
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["ecmascript","js","node"],
    extensions: ["js", "mjs", "cjs"],
    load() {
      return import("@codemirror/next/lang-javascript").then(m => ({language: m.javascriptLanguage, support: m.javascriptSupport()}))
    }
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json5"],
    extensions: ["json","map"],
    load() {
      return import("@codemirror/next/lang-json").then(m => ({language: m.jsonLanguage}))
    }
  }),
  LanguageDescription.of({
    name: "JSX",
    extensions: ["jsx"],
    load() {
      return import("@codemirror/next/lang-javascript").then(m => ({language: m.jsxLanguage, support: m.javascriptSupport()}))
    }
  }),
  LanguageDescription.of({
    name: "MariaDB SQL",
    load() { return sql("MariaSQL") }
  }),
  LanguageDescription.of({
    name: "Markdown",
    extensions: ["md", "markdown", "mkd"],
    load() {
      return import("@codemirror/next/lang-markdown").then(m => ({language: m.markdownLanguage, support: m.markdownSupport()}))
    }
  }),
  LanguageDescription.of({
    name: "MS SQL",
    load() { return sql("MSSQL") }
  }),
  LanguageDescription.of({
    name: "MySQL",
    load() { return sql("MySQL") }
  }),
  LanguageDescription.of({
    name: "PLSQL",
    extensions: ["pls"],
    load() { return sql("PLSQL") }
  }),
  LanguageDescription.of({
    name: "PostgreSQL",
    load() { return sql("PostgreSQL") }
  }),
  LanguageDescription.of({
    name: "Python",
    extensions: ["BUILD","bzl","py","pyw"],
    filename: /^(BUCK|BUILD)$/,
    load() {
      return import("@codemirror/next/lang-python").then(m => ({language: m.pythonLanguage}))
    }
  }),
  LanguageDescription.of({
    name: "Rust",
    extensions: ["rs"],
    load() {
      return import("@codemirror/next/lang-rust").then(m => ({language: m.rustLanguage}))
    }
  }),
  LanguageDescription.of({
    name: "SQL",
    extensions: ["sql"],
    load() { return sql("StandardSQL") }
  }),
  LanguageDescription.of({
    name: "SQLite",
    load() { return sql("SQLite") }
  }),
  LanguageDescription.of({
    name: "TSX",
    extensions: ["tsx"],
    load() {
      return import("@codemirror/next/lang-javascript").then(m => ({language: m.tsxLanguage, support: m.javascriptSupport()}))
    }
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts"],
    extensions: ["ts"],
    load() {
      return import("@codemirror/next/lang-javascript").then(m => ({language: m.typescriptLanguage, support: m.javascriptSupport()}))
    }
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["rss","wsdl","xsd"],
    extensions: ["xml","xsl","xsd","svg"],
    load() {
      return import("@codemirror/next/lang-xml").then(m => ({language: m.xmlLanguage, support: m.xmlSupport()}))
    }
  }),

  // Legacy modes ported from CodeMirror 5

  LanguageDescription.of({
    name: "APL",
    extensions: ["dyalog","apl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/apl").then(m => legacy(m.apl))
    }
  }),
  LanguageDescription.of({
    name: "PGP",
    alias: ["asciiarmor"],
    extensions: ["asc","pgp","sig"],
    load() {
      return import("@codemirror/next/legacy-modes/src/asciiarmor").then(m => legacy(m.asciiArmor))
    }
  }),
  LanguageDescription.of({
    name: "ASN.1",
    extensions: ["asn","asn1"],
    load() {
      return import("@codemirror/next/legacy-modes/src/asn1").then(m => legacy(m.asn1({})))
    }
  }),
  LanguageDescription.of({
    name: "Asterisk",
    filename: /^extensions\.conf$/i,
    load() {
      return import("@codemirror/next/legacy-modes/src/asterisk").then(m => legacy(m.asterisk))
    }
  }),
  LanguageDescription.of({
    name: "Brainfuck",
    extensions: ["b","bf"],
    load() {
      return import("@codemirror/next/legacy-modes/src/brainfuck").then(m => legacy(m.brainfuck))
    }
  }),
  LanguageDescription.of({
    name: "Cobol",
    extensions: ["cob","cpy"],
    load() {
      return import("@codemirror/next/legacy-modes/src/cobol").then(m => legacy(m.cobol))
    }
  }),
  LanguageDescription.of({
    name: "C#",
    alias: ["csharp","cs"],
    extensions: ["cs"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clike").then(m => legacy(m.csharp))
    }
  }),
  LanguageDescription.of({
    name: "Clojure",
    extensions: ["clj","cljc","cljx"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clojure").then(m => legacy(m.clojure))
    }
  }),
  LanguageDescription.of({
    name: "ClojureScript",
    extensions: ["cljs"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clojure").then(m => legacy(m.clojure))
    }
  }),
  LanguageDescription.of({
    name: "Closure Stylesheets (GSS)",
    extensions: ["gss"],
    load() {
      return import("@codemirror/next/legacy-modes/src/css").then(m => legacy(m.gss))
    }
  }),
  LanguageDescription.of({
    name: "CMake",
    extensions: ["cmake","cmake.in"],
    filename: /^CMakeLists\.txt$/,
    load() {
      return import("@codemirror/next/legacy-modes/src/cmake").then(m => legacy(m.cmake))
    }
  }),
  LanguageDescription.of({
    name: "CoffeeScript",
    alias: ["coffee","coffee-script"],
    extensions: ["coffee"],
    load() {
      return import("@codemirror/next/legacy-modes/src/coffeescript").then(m => legacy(m.coffeeScript))
    }
  }),
  LanguageDescription.of({
    name: "Common Lisp",
    alias: ["lisp"],
    extensions: ["cl","lisp","el"],
    load() {
      return import("@codemirror/next/legacy-modes/src/commonlisp").then(m => legacy(m.commonLisp))
    }
  }),
  LanguageDescription.of({
    name: "Cypher",
    extensions: ["cyp","cypher"],
    load() {
      return import("@codemirror/next/legacy-modes/src/cypher").then(m => legacy(m.cypher))
    }
  }),
  LanguageDescription.of({
    name: "Cython",
    extensions: ["pyx","pxd","pxi"],
    load() {
      return import("@codemirror/next/legacy-modes/src/python").then(m => legacy(m.cython))
    }
  }),
  LanguageDescription.of({
    name: "Crystal",
    extensions: ["cr"],
    load() {
      return import("@codemirror/next/legacy-modes/src/crystal").then(m => legacy(m.crystal))
    }
  }),
  LanguageDescription.of({
    name: "D",
    extensions: ["d"],
    load() {
      return import("@codemirror/next/legacy-modes/src/d").then(m => legacy(m.d))
    }
  }),
  LanguageDescription.of({
    name: "Dart",
    extensions: ["dart"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clike").then(m => legacy(m.dart))
    }
  }),
  LanguageDescription.of({
    name: "diff",
    extensions: ["diff","patch"],
    load() {
      return import("@codemirror/next/legacy-modes/src/diff").then(m => legacy(m.diff))
    }
  }),
  LanguageDescription.of({
    name: "Dockerfile",
    filename: /^Dockerfile$/,
    load() {
      return import("@codemirror/next/legacy-modes/src/dockerfile").then(m => legacy(m.dockerFile))
    }
  }),
  LanguageDescription.of({
    name: "DTD",
    extensions: ["dtd"],
    load() {
      return import("@codemirror/next/legacy-modes/src/dtd").then(m => legacy(m.dtd))
    }
  }),
  LanguageDescription.of({
    name: "Dylan",
    extensions: ["dylan","dyl","intr"],
    load() {
      return import("@codemirror/next/legacy-modes/src/dylan").then(m => legacy(m.dylan))
    }
  }),
  LanguageDescription.of({
    name: "EBNF",
    load() {
      return import("@codemirror/next/legacy-modes/src/ebnf").then(m => legacy(m.ebnf))
    }
  }),
  LanguageDescription.of({
    name: "ECL",
    extensions: ["ecl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/ecl").then(m => legacy(m.ecl))
    }
  }),
  LanguageDescription.of({
    name: "edn",
    extensions: ["edn"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clojure").then(m => legacy(m.clojure))
    }
  }),
  LanguageDescription.of({
    name: "Eiffel",
    extensions: ["e"],
    load() {
      return import("@codemirror/next/legacy-modes/src/eiffel").then(m => legacy(m.eiffel))
    }
  }),
  LanguageDescription.of({
    name: "Elm",
    extensions: ["elm"],
    load() {
      return import("@codemirror/next/legacy-modes/src/elm").then(m => legacy(m.elm))
    }
  }),
  LanguageDescription.of({
    name: "Erlang",
    extensions: ["erl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/erlang").then(m => legacy(m.erlang))
    }
  }),
  LanguageDescription.of({
    name: "Esper",
    load() {
      return import("@codemirror/next/legacy-modes/src/sql").then(m => legacy(m.esper))
    }
  }),
  LanguageDescription.of({
    name: "Factor",
    extensions: ["factor"],
    load() {
      return import("@codemirror/next/legacy-modes/src/factor").then(m => legacy(m.factor))
    }
  }),
  LanguageDescription.of({
    name: "FCL",
    load() {
      return import("@codemirror/next/legacy-modes/src/fcl").then(m => legacy(m.fcl))
    }
  }),
  LanguageDescription.of({
    name: "Forth",
    extensions: ["forth","fth","4th"],
    load() {
      return import("@codemirror/next/legacy-modes/src/forth").then(m => legacy(m.forth))
    }
  }),
  LanguageDescription.of({
    name: "Fortran",
    extensions: ["f","for","f77","f90","f95"],
    load() {
      return import("@codemirror/next/legacy-modes/src/fortran").then(m => legacy(m.fortran))
    }
  }),
  LanguageDescription.of({
    name: "F#",
    alias: ["fsharp"],
    extensions: ["fs"],
    load() {
      return import("@codemirror/next/legacy-modes/src/mllike").then(m => legacy(m.fSharp))
    }
  }),
  LanguageDescription.of({
    name: "Gas",
    extensions: ["s"],
    load() {
      return import("@codemirror/next/legacy-modes/src/gas").then(m => legacy(m.gas))
    }
  }),
  LanguageDescription.of({
    name: "Gherkin",
    extensions: ["feature"],
    load() {
      return import("@codemirror/next/legacy-modes/src/gherkin").then(m => legacy(m.gherkin))
    }
  }),
  LanguageDescription.of({
    name: "Go",
    extensions: ["go"],
    load() {
      return import("@codemirror/next/legacy-modes/src/go").then(m => legacy(m.go))
    }
  }),
  LanguageDescription.of({
    name: "Groovy",
    extensions: ["groovy","gradle"],
    filename: /^Jenkinsfile$/,
    load() {
      return import("@codemirror/next/legacy-modes/src/groovy").then(m => legacy(m.groovy))
    }
  }),
  LanguageDescription.of({
    name: "Haskell",
    extensions: ["hs"],
    load() {
      return import("@codemirror/next/legacy-modes/src/haskell").then(m => legacy(m.haskell))
    }
  }),
  LanguageDescription.of({
    name: "Haxe",
    extensions: ["hx"],
    load() {
      return import("@codemirror/next/legacy-modes/src/haxe").then(m => legacy(m.haxe))
    }
  }),
  LanguageDescription.of({
    name: "HXML",
    extensions: ["hxml"],
    load() {
      return import("@codemirror/next/legacy-modes/src/haxe").then(m => legacy(m.hxml))
    }
  }),
  LanguageDescription.of({
    name: "HTTP",
    load() {
      return import("@codemirror/next/legacy-modes/src/http").then(m => legacy(m.http))
    }
  }),
  LanguageDescription.of({
    name: "IDL",
    extensions: ["pro"],
    load() {
      return import("@codemirror/next/legacy-modes/src/idl").then(m => legacy(m.idl))
    }
  }),
  LanguageDescription.of({
    name: "JSON-LD",
    alias: ["jsonld"],
    extensions: ["jsonld"],
    load() {
      return import("@codemirror/next/legacy-modes/src/javascript").then(m => legacy(m.jsonld))
    }
  }),
  LanguageDescription.of({
    name: "Jinja2",
    extensions: ["j2","jinja","jinja2"],
    load() {
      return import("@codemirror/next/legacy-modes/src/jinja2").then(m => legacy(m.jinja2))
    }
  }),
  LanguageDescription.of({
    name: "Julia",
    extensions: ["jl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/julia").then(m => legacy(m.julia))
    }
  }),
  LanguageDescription.of({
    name: "Kotlin",
    extensions: ["kt"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clike").then(m => legacy(m.kotlin))
    }
  }),
  LanguageDescription.of({
    name: "LESS",
    extensions: ["less"],
    load() {
      return import("@codemirror/next/legacy-modes/src/css").then(m => legacy(m.less))
    }
  }),
  LanguageDescription.of({
    name: "LiveScript",
    alias: ["ls"],
    extensions: ["ls"],
    load() {
      return import("@codemirror/next/legacy-modes/src/livescript").then(m => legacy(m.liveScript))
    }
  }),
  LanguageDescription.of({
    name: "Lua",
    extensions: ["lua"],
    load() {
      return import("@codemirror/next/legacy-modes/src/lua").then(m => legacy(m.lua))
    }
  }),
  LanguageDescription.of({
    name: "mIRC",
    load() {
      return import("@codemirror/next/legacy-modes/src/mirc").then(m => legacy(m.mirc))
    }
  }),
  LanguageDescription.of({
    name: "Mathematica",
    extensions: ["m","nb","wl","wls"],
    load() {
      return import("@codemirror/next/legacy-modes/src/mathematica").then(m => legacy(m.mathematica))
    }
  }),
  LanguageDescription.of({
    name: "Modelica",
    extensions: ["mo"],
    load() {
      return import("@codemirror/next/legacy-modes/src/modelica").then(m => legacy(m.modelica))
    }
  }),
  LanguageDescription.of({
    name: "MUMPS",
    extensions: ["mps"],
    load() {
      return import("@codemirror/next/legacy-modes/src/mumps").then(m => legacy(m.mumps))
    }
  }),
  LanguageDescription.of({
    name: "mbox",
    extensions: ["mbox"],
    load() {
      return import("@codemirror/next/legacy-modes/src/mbox").then(m => legacy(m.mbox))
    }
  }),
  LanguageDescription.of({
    name: "Nginx",
    filename: /nginx.*\.conf$/i,
    load() {
      return import("@codemirror/next/legacy-modes/src/nginx").then(m => legacy(m.nginx))
    }
  }),
  LanguageDescription.of({
    name: "NSIS",
    extensions: ["nsh","nsi"],
    load() {
      return import("@codemirror/next/legacy-modes/src/nsis").then(m => legacy(m.nsis))
    }
  }),
  LanguageDescription.of({
    name: "NTriples",
    extensions: ["nt","nq"],
    load() {
      return import("@codemirror/next/legacy-modes/src/ntriples").then(m => legacy(m.ntriples))
    }
  }),
  LanguageDescription.of({
    name: "Objective-C",
    alias: ["objective-c","objc"],
    extensions: ["m"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clike").then(m => legacy(m.objectiveC))
    }
  }),
  LanguageDescription.of({
    name: "Objective-C++",
    alias: ["objective-c++","objc++"],
    extensions: ["mm"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clike").then(m => legacy(m.objectiveCpp))
    }
  }),
  LanguageDescription.of({
    name: "OCaml",
    extensions: ["ml","mli","mll","mly"],
    load() {
      return import("@codemirror/next/legacy-modes/src/mllike").then(m => legacy(m.oCaml))
    }
  }),
  LanguageDescription.of({
    name: "Octave",
    extensions: ["m"],
    load() {
      return import("@codemirror/next/legacy-modes/src/octave").then(m => legacy(m.octave))
    }
  }),
  LanguageDescription.of({
    name: "Oz",
    extensions: ["oz"],
    load() {
      return import("@codemirror/next/legacy-modes/src/oz").then(m => legacy(m.oz))
    }
  }),
  LanguageDescription.of({
    name: "Pascal",
    extensions: ["p","pas"],
    load() {
      return import("@codemirror/next/legacy-modes/src/pascal").then(m => legacy(m.pascal))
    }
  }),
  LanguageDescription.of({
    name: "Perl",
    extensions: ["pl","pm"],
    load() {
      return import("@codemirror/next/legacy-modes/src/perl").then(m => legacy(m.perl))
    }
  }),
  LanguageDescription.of({
    name: "Pig",
    extensions: ["pig"],
    load() {
      return import("@codemirror/next/legacy-modes/src/pig").then(m => legacy(m.pig))
    }
  }),
  LanguageDescription.of({
    name: "PowerShell",
    extensions: ["ps1","psd1","psm1"],
    load() {
      return import("@codemirror/next/legacy-modes/src/powershell").then(m => legacy(m.powerShell))
    }
  }),
  LanguageDescription.of({
    name: "Properties files",
    alias: ["ini","properties"],
    extensions: ["properties","ini","in"],
    load() {
      return import("@codemirror/next/legacy-modes/src/properties").then(m => legacy(m.properties))
    }
  }),
  LanguageDescription.of({
    name: "ProtoBuf",
    extensions: ["proto"],
    load() {
      return import("@codemirror/next/legacy-modes/src/protobuf").then(m => legacy(m.protobuf))
    }
  }),
  LanguageDescription.of({
    name: "Puppet",
    extensions: ["pp"],
    load() {
      return import("@codemirror/next/legacy-modes/src/puppet").then(m => legacy(m.puppet))
    }
  }),
  LanguageDescription.of({
    name: "Q",
    extensions: ["q"],
    load() {
      return import("@codemirror/next/legacy-modes/src/q").then(m => legacy(m.q))
    }
  }),
  LanguageDescription.of({
    name: "R",
    alias: ["rscript"],
    extensions: ["r","R"],
    load() {
      return import("@codemirror/next/legacy-modes/src/r").then(m => legacy(m.r))
    }
  }),
  LanguageDescription.of({
    name: "RPM Changes",
    load() {
      return import("@codemirror/next/legacy-modes/src/rpm").then(m => legacy(m.rpmChanges))
    }
  }),
  LanguageDescription.of({
    name: "RPM Spec",
    extensions: ["spec"],
    load() {
      return import("@codemirror/next/legacy-modes/src/rpm").then(m => legacy(m.rpmSpec))
    }
  }),
  LanguageDescription.of({
    name: "Ruby",
    alias: ["jruby","macruby","rake","rb","rbx"],
    extensions: ["rb"],
    load() {
      return import("@codemirror/next/legacy-modes/src/ruby").then(m => legacy(m.ruby))
    }
  }),
  LanguageDescription.of({
    name: "SAS",
    extensions: ["sas"],
    load() {
      return import("@codemirror/next/legacy-modes/src/sas").then(m => legacy(m.sas))
    }
  }),
  LanguageDescription.of({
    name: "Scala",
    extensions: ["scala"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clike").then(m => legacy(m.scala))
    }
  }),
  LanguageDescription.of({
    name: "Scheme",
    extensions: ["scm","ss"],
    load() {
      return import("@codemirror/next/legacy-modes/src/scheme").then(m => legacy(m.scheme))
    }
  }),
  LanguageDescription.of({
    name: "SCSS",
    extensions: ["scss"],
    load() {
      return import("@codemirror/next/legacy-modes/src/css").then(m => legacy(m.sCSS))
    }
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["bash","sh","zsh"],
    extensions: ["sh","ksh","bash"],
    filename: /^PKGBUILD$/,
    load() {
      return import("@codemirror/next/legacy-modes/src/shell").then(m => legacy(m.shell))
    }
  }),
  LanguageDescription.of({
    name: "Sieve",
    extensions: ["siv","sieve"],
    load() {
      return import("@codemirror/next/legacy-modes/src/sieve").then(m => legacy(m.sieve))
    }
  }),
  LanguageDescription.of({
    name: "Smalltalk",
    extensions: ["st"],
    load() {
      return import("@codemirror/next/legacy-modes/src/smalltalk").then(m => legacy(m.smalltalk))
    }
  }),
  LanguageDescription.of({
    name: "Solr",
    load() {
      return import("@codemirror/next/legacy-modes/src/solr").then(m => legacy(m.solr))
    }
  }),
  LanguageDescription.of({
    name: "SML",
    extensions: ["sml","sig","fun","smackspec"],
    load() {
      return import("@codemirror/next/legacy-modes/src/mllike").then(m => legacy(m.sml))
    }
  }),
  LanguageDescription.of({
    name: "SPARQL",
    alias: ["sparul"],
    extensions: ["rq","sparql"],
    load() {
      return import("@codemirror/next/legacy-modes/src/sparql").then(m => legacy(m.sparql))
    }
  }),
  LanguageDescription.of({
    name: "Spreadsheet",
    alias: ["excel","formula"],
    load() {
      return import("@codemirror/next/legacy-modes/src/spreadsheet").then(m => legacy(m.spreadsheet))
    }
  }),
  LanguageDescription.of({
    name: "SQL",
    extensions: ["sql"],
    load() {
      return import("@codemirror/next/legacy-modes/src/sql").then(m => legacy(m.standardSQL))
    }
  }),
  LanguageDescription.of({
    name: "SQLite",
    load() {
      return import("@codemirror/next/legacy-modes/src/sql").then(m => legacy(m.sqlite))
    }
  }),
  LanguageDescription.of({
    name: "Squirrel",
    extensions: ["nut"],
    load() {
      return import("@codemirror/next/legacy-modes/src/clike").then(m => legacy(m.squirrel))
    }
  }),
  LanguageDescription.of({
    name: "Stylus",
    extensions: ["styl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/stylus").then(m => legacy(m.stylus))
    }
  }),
  LanguageDescription.of({
    name: "Swift",
    extensions: ["swift"],
    load() {
      return import("@codemirror/next/legacy-modes/src/swift").then(m => legacy(m.swift))
    }
  }),
  LanguageDescription.of({
    name: "sTeX",
    load() {
      return import("@codemirror/next/legacy-modes/src/stex").then(m => legacy(m.stex))
    }
  }),
  LanguageDescription.of({
    name: "LaTeX",
    alias: ["tex"],
    extensions: ["text","ltx","tex"],
    load() {
      return import("@codemirror/next/legacy-modes/src/stex").then(m => legacy(m.stex))
    }
  }),
  LanguageDescription.of({
    name: "SystemVerilog",
    extensions: ["v","sv","svh"],
    load() {
      return import("@codemirror/next/legacy-modes/src/verilog").then(m => legacy(m.verilog))
    }
  }),
  LanguageDescription.of({
    name: "Tcl",
    extensions: ["tcl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/tcl").then(m => legacy(m.tcl))
    }
  }),
  LanguageDescription.of({
    name: "Textile",
    extensions: ["textile"],
    load() {
      return import("@codemirror/next/legacy-modes/src/textile").then(m => legacy(m.textile))
    }
  }),
  LanguageDescription.of({
    name: "TiddlyWiki",
    load() {
      return import("@codemirror/next/legacy-modes/src/tiddlywiki").then(m => legacy(m.tiddlyWiki))
    }
  }),
  LanguageDescription.of({
    name: "Tiki wiki",
    load() {
      return import("@codemirror/next/legacy-modes/src/tiki").then(m => legacy(m.tiki))
    }
  }),
  LanguageDescription.of({
    name: "TOML",
    extensions: ["toml"],
    load() {
      return import("@codemirror/next/legacy-modes/src/toml").then(m => legacy(m.toml))
    }
  }),
  LanguageDescription.of({
    name: "troff",
    extensions: ["1","2","3","4","5","6","7","8","9"],
    load() {
      return import("@codemirror/next/legacy-modes/src/troff").then(m => legacy(m.troff))
    }
  }),
  LanguageDescription.of({
    name: "TTCN",
    extensions: ["ttcn","ttcn3","ttcnpp"],
    load() {
      return import("@codemirror/next/legacy-modes/src/ttcn").then(m => legacy(m.ttcn))
    }
  }),
  LanguageDescription.of({
    name: "TTCN_CFG",
    extensions: ["cfg"],
    load() {
      return import("@codemirror/next/legacy-modes/src/ttcn-cfg").then(m => legacy(m.ttcnCfg))
    }
  }),
  LanguageDescription.of({
    name: "Turtle",
    extensions: ["ttl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/turtle").then(m => legacy(m.turtle))
    }
  }),
  LanguageDescription.of({
    name: "Web IDL",
    extensions: ["webidl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/webidl").then(m => legacy(m.webIDL))
    }
  }),
  LanguageDescription.of({
    name: "VB.NET",
    extensions: ["vb"],
    load() {
      return import("@codemirror/next/legacy-modes/src/vb").then(m => legacy(m.vb))
    }
  }),
  LanguageDescription.of({
    name: "VBScript",
    extensions: ["vbs"],
    load() {
      return import("@codemirror/next/legacy-modes/src/vbscript").then(m => legacy(m.vbScript))
    }
  }),
  LanguageDescription.of({
    name: "Velocity",
    extensions: ["vtl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/velocity").then(m => legacy(m.velocity))
    }
  }),
  LanguageDescription.of({
    name: "Verilog",
    extensions: ["v"],
    load() {
      return import("@codemirror/next/legacy-modes/src/verilog").then(m => legacy(m.verilog))
    }
  }),
  LanguageDescription.of({
    name: "VHDL",
    extensions: ["vhd","vhdl"],
    load() {
      return import("@codemirror/next/legacy-modes/src/vhdl").then(m => legacy(m.vhdl))
    }
  }),
  LanguageDescription.of({
    name: "XQuery",
    extensions: ["xy","xquery"],
    load() {
      return import("@codemirror/next/legacy-modes/src/xquery").then(m => legacy(m.xQuery))
    }
  }),
  LanguageDescription.of({
    name: "Yacas",
    extensions: ["ys"],
    load() {
      return import("@codemirror/next/legacy-modes/src/yacas").then(m => legacy(m.yacas))
    }
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml"],
    extensions: ["yaml","yml"],
    load() {
      return import("@codemirror/next/legacy-modes/src/yaml").then(m => legacy(m.yaml))
    }
  }),
  LanguageDescription.of({
    name: "Z80",
    extensions: ["z80"],
    load() {
      return import("@codemirror/next/legacy-modes/src/z80").then(m => legacy(m.z80))
    }
  }),
  LanguageDescription.of({
    name: "mscgen",
    extensions: ["mscgen","mscin","msc"],
    load() {
      return import("@codemirror/next/legacy-modes/src/mscgen").then(m => legacy(m.mscgen))
    }
  }),
  LanguageDescription.of({
    name: "xu",
    extensions: ["xu"],
    load() {
      return import("@codemirror/next/legacy-modes/src/mscgen").then(m => legacy(m.xu))
    }
  }),
  LanguageDescription.of({
    name: "msgenny",
    extensions: ["msgenny"],
    load() {
      return import("@codemirror/next/legacy-modes/src/mscgen").then(m => legacy(m.msgenny))
    }
  }),
  LanguageDescription.of({
    name: "WebAssembly",
    extensions: ["wat","wast"],
    load() {
      return import("@codemirror/next/legacy-modes/src/wast").then(m => legacy(m.wast))
    }
  })
]
