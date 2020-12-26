import {LanguageSupport, LanguageDescription} from "@codemirror/next/language"
import {StreamParser} from "@codemirror/next/stream-parser"

function legacy(parser: StreamParser<unknown>): Promise<LanguageSupport> {
  return import("@codemirror/next/stream-parser").then(m => new LanguageSupport(m.StreamLanguage.define(parser)))
}

function sql(dialectName: keyof typeof import("@codemirror/next/lang-sql")) {
  return import("@codemirror/next/lang-sql").then(m => m.sql({dialect: (m as any)[dialectName]}))
}

/// An array of language descriptions for known language packages.
export const languages = [
  // New-style language modes

  LanguageDescription.of({
    name: "C",
    extensions: ["c","h","ino"],
    load() {
      return import("@codemirror/next/lang-cpp").then(m => m.cpp())
    }
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp"],
    extensions: ["cpp","c++","cc","cxx","hpp","h++","hh","hxx"],
    load() {
      return import("@codemirror/next/lang-cpp").then(m => m.cpp())
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
      return import("@codemirror/next/lang-css").then(m => m.css())
    }
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["xhtml"],
    extensions: ["html", "htm", "handlebars", "hbs"],
    load() {
      return import("@codemirror/next/lang-html").then(m => m.html())
    }
  }),
  LanguageDescription.of({
    name: "Java",
    extensions: ["java"],
    load() {
      return import("@codemirror/next/lang-java").then(m => m.java())
    }
  }),
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["ecmascript","js","node"],
    extensions: ["js", "mjs", "cjs"],
    load() {
      return import("@codemirror/next/lang-javascript").then(m => m.javascript())
    }
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json5"],
    extensions: ["json","map"],
    load() {
      return import("@codemirror/next/lang-json").then(m => m.json())
    }
  }),
  LanguageDescription.of({
    name: "JSX",
    extensions: ["jsx"],
    load() {
      return import("@codemirror/next/lang-javascript").then(m => m.javascript({jsx: true}))
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
      return import("@codemirror/next/lang-markdown").then(m => m.markdown())
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
      return import("@codemirror/next/lang-python").then(m => m.python())
    }
  }),
  LanguageDescription.of({
    name: "Rust",
    extensions: ["rs"],
    load() {
      return import("@codemirror/next/lang-rust").then(m => m.rust())
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
      return import("@codemirror/next/lang-javascript").then(m => m.javascript({jsx: true, typescript: true}))
    }
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts"],
    extensions: ["ts"],
    load() {
      return import("@codemirror/next/lang-javascript").then(m => m.javascript({typescript: true}))
    }
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["rss","wsdl","xsd"],
    extensions: ["xml","xsl","xsd","svg"],
    load() {
      return import("@codemirror/next/lang-xml").then(m => m.xml())
    }
  }),

  // Legacy modes ported from CodeMirror 5

  LanguageDescription.of({
    name: "APL",
    extensions: ["dyalog","apl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/apl").then(m => legacy(m.apl))
    }
  }),
  LanguageDescription.of({
    name: "PGP",
    alias: ["asciiarmor"],
    extensions: ["asc","pgp","sig"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/asciiarmor").then(m => legacy(m.asciiArmor))
    }
  }),
  LanguageDescription.of({
    name: "ASN.1",
    extensions: ["asn","asn1"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/asn1").then(m => legacy(m.asn1({})))
    }
  }),
  LanguageDescription.of({
    name: "Asterisk",
    filename: /^extensions\.conf$/i,
    load() {
      return import("@codemirror/next/legacy-modes/mode/asterisk").then(m => legacy(m.asterisk))
    }
  }),
  LanguageDescription.of({
    name: "Brainfuck",
    extensions: ["b","bf"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/brainfuck").then(m => legacy(m.brainfuck))
    }
  }),
  LanguageDescription.of({
    name: "Cobol",
    extensions: ["cob","cpy"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/cobol").then(m => legacy(m.cobol))
    }
  }),
  LanguageDescription.of({
    name: "C#",
    alias: ["csharp","cs"],
    extensions: ["cs"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clike").then(m => legacy(m.csharp))
    }
  }),
  LanguageDescription.of({
    name: "Clojure",
    extensions: ["clj","cljc","cljx"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clojure").then(m => legacy(m.clojure))
    }
  }),
  LanguageDescription.of({
    name: "ClojureScript",
    extensions: ["cljs"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clojure").then(m => legacy(m.clojure))
    }
  }),
  LanguageDescription.of({
    name: "Closure Stylesheets (GSS)",
    extensions: ["gss"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/css").then(m => legacy(m.gss))
    }
  }),
  LanguageDescription.of({
    name: "CMake",
    extensions: ["cmake","cmake.in"],
    filename: /^CMakeLists\.txt$/,
    load() {
      return import("@codemirror/next/legacy-modes/mode/cmake").then(m => legacy(m.cmake))
    }
  }),
  LanguageDescription.of({
    name: "CoffeeScript",
    alias: ["coffee","coffee-script"],
    extensions: ["coffee"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/coffeescript").then(m => legacy(m.coffeeScript))
    }
  }),
  LanguageDescription.of({
    name: "Common Lisp",
    alias: ["lisp"],
    extensions: ["cl","lisp","el"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/commonlisp").then(m => legacy(m.commonLisp))
    }
  }),
  LanguageDescription.of({
    name: "Cypher",
    extensions: ["cyp","cypher"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/cypher").then(m => legacy(m.cypher))
    }
  }),
  LanguageDescription.of({
    name: "Cython",
    extensions: ["pyx","pxd","pxi"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/python").then(m => legacy(m.cython))
    }
  }),
  LanguageDescription.of({
    name: "Crystal",
    extensions: ["cr"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/crystal").then(m => legacy(m.crystal))
    }
  }),
  LanguageDescription.of({
    name: "D",
    extensions: ["d"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/d").then(m => legacy(m.d))
    }
  }),
  LanguageDescription.of({
    name: "Dart",
    extensions: ["dart"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clike").then(m => legacy(m.dart))
    }
  }),
  LanguageDescription.of({
    name: "diff",
    extensions: ["diff","patch"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/diff").then(m => legacy(m.diff))
    }
  }),
  LanguageDescription.of({
    name: "Dockerfile",
    filename: /^Dockerfile$/,
    load() {
      return import("@codemirror/next/legacy-modes/mode/dockerfile").then(m => legacy(m.dockerFile))
    }
  }),
  LanguageDescription.of({
    name: "DTD",
    extensions: ["dtd"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/dtd").then(m => legacy(m.dtd))
    }
  }),
  LanguageDescription.of({
    name: "Dylan",
    extensions: ["dylan","dyl","intr"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/dylan").then(m => legacy(m.dylan))
    }
  }),
  LanguageDescription.of({
    name: "EBNF",
    load() {
      return import("@codemirror/next/legacy-modes/mode/ebnf").then(m => legacy(m.ebnf))
    }
  }),
  LanguageDescription.of({
    name: "ECL",
    extensions: ["ecl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/ecl").then(m => legacy(m.ecl))
    }
  }),
  LanguageDescription.of({
    name: "edn",
    extensions: ["edn"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clojure").then(m => legacy(m.clojure))
    }
  }),
  LanguageDescription.of({
    name: "Eiffel",
    extensions: ["e"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/eiffel").then(m => legacy(m.eiffel))
    }
  }),
  LanguageDescription.of({
    name: "Elm",
    extensions: ["elm"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/elm").then(m => legacy(m.elm))
    }
  }),
  LanguageDescription.of({
    name: "Erlang",
    extensions: ["erl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/erlang").then(m => legacy(m.erlang))
    }
  }),
  LanguageDescription.of({
    name: "Esper",
    load() {
      return import("@codemirror/next/legacy-modes/mode/sql").then(m => legacy(m.esper))
    }
  }),
  LanguageDescription.of({
    name: "Factor",
    extensions: ["factor"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/factor").then(m => legacy(m.factor))
    }
  }),
  LanguageDescription.of({
    name: "FCL",
    load() {
      return import("@codemirror/next/legacy-modes/mode/fcl").then(m => legacy(m.fcl))
    }
  }),
  LanguageDescription.of({
    name: "Forth",
    extensions: ["forth","fth","4th"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/forth").then(m => legacy(m.forth))
    }
  }),
  LanguageDescription.of({
    name: "Fortran",
    extensions: ["f","for","f77","f90","f95"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/fortran").then(m => legacy(m.fortran))
    }
  }),
  LanguageDescription.of({
    name: "F#",
    alias: ["fsharp"],
    extensions: ["fs"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/mllike").then(m => legacy(m.fSharp))
    }
  }),
  LanguageDescription.of({
    name: "Gas",
    extensions: ["s"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/gas").then(m => legacy(m.gas))
    }
  }),
  LanguageDescription.of({
    name: "Gherkin",
    extensions: ["feature"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/gherkin").then(m => legacy(m.gherkin))
    }
  }),
  LanguageDescription.of({
    name: "Go",
    extensions: ["go"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/go").then(m => legacy(m.go))
    }
  }),
  LanguageDescription.of({
    name: "Groovy",
    extensions: ["groovy","gradle"],
    filename: /^Jenkinsfile$/,
    load() {
      return import("@codemirror/next/legacy-modes/mode/groovy").then(m => legacy(m.groovy))
    }
  }),
  LanguageDescription.of({
    name: "Haskell",
    extensions: ["hs"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/haskell").then(m => legacy(m.haskell))
    }
  }),
  LanguageDescription.of({
    name: "Haxe",
    extensions: ["hx"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/haxe").then(m => legacy(m.haxe))
    }
  }),
  LanguageDescription.of({
    name: "HXML",
    extensions: ["hxml"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/haxe").then(m => legacy(m.hxml))
    }
  }),
  LanguageDescription.of({
    name: "HTTP",
    load() {
      return import("@codemirror/next/legacy-modes/mode/http").then(m => legacy(m.http))
    }
  }),
  LanguageDescription.of({
    name: "IDL",
    extensions: ["pro"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/idl").then(m => legacy(m.idl))
    }
  }),
  LanguageDescription.of({
    name: "JSON-LD",
    alias: ["jsonld"],
    extensions: ["jsonld"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/javascript").then(m => legacy(m.jsonld))
    }
  }),
  LanguageDescription.of({
    name: "Jinja2",
    extensions: ["j2","jinja","jinja2"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/jinja2").then(m => legacy(m.jinja2))
    }
  }),
  LanguageDescription.of({
    name: "Julia",
    extensions: ["jl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/julia").then(m => legacy(m.julia))
    }
  }),
  LanguageDescription.of({
    name: "Kotlin",
    extensions: ["kt"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clike").then(m => legacy(m.kotlin))
    }
  }),
  LanguageDescription.of({
    name: "LESS",
    extensions: ["less"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/css").then(m => legacy(m.less))
    }
  }),
  LanguageDescription.of({
    name: "LiveScript",
    alias: ["ls"],
    extensions: ["ls"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/livescript").then(m => legacy(m.liveScript))
    }
  }),
  LanguageDescription.of({
    name: "Lua",
    extensions: ["lua"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/lua").then(m => legacy(m.lua))
    }
  }),
  LanguageDescription.of({
    name: "mIRC",
    load() {
      return import("@codemirror/next/legacy-modes/mode/mirc").then(m => legacy(m.mirc))
    }
  }),
  LanguageDescription.of({
    name: "Mathematica",
    extensions: ["m","nb","wl","wls"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/mathematica").then(m => legacy(m.mathematica))
    }
  }),
  LanguageDescription.of({
    name: "Modelica",
    extensions: ["mo"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/modelica").then(m => legacy(m.modelica))
    }
  }),
  LanguageDescription.of({
    name: "MUMPS",
    extensions: ["mps"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/mumps").then(m => legacy(m.mumps))
    }
  }),
  LanguageDescription.of({
    name: "mbox",
    extensions: ["mbox"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/mbox").then(m => legacy(m.mbox))
    }
  }),
  LanguageDescription.of({
    name: "Nginx",
    filename: /nginx.*\.conf$/i,
    load() {
      return import("@codemirror/next/legacy-modes/mode/nginx").then(m => legacy(m.nginx))
    }
  }),
  LanguageDescription.of({
    name: "NSIS",
    extensions: ["nsh","nsi"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/nsis").then(m => legacy(m.nsis))
    }
  }),
  LanguageDescription.of({
    name: "NTriples",
    extensions: ["nt","nq"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/ntriples").then(m => legacy(m.ntriples))
    }
  }),
  LanguageDescription.of({
    name: "Objective-C",
    alias: ["objective-c","objc"],
    extensions: ["m"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clike").then(m => legacy(m.objectiveC))
    }
  }),
  LanguageDescription.of({
    name: "Objective-C++",
    alias: ["objective-c++","objc++"],
    extensions: ["mm"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clike").then(m => legacy(m.objectiveCpp))
    }
  }),
  LanguageDescription.of({
    name: "OCaml",
    extensions: ["ml","mli","mll","mly"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/mllike").then(m => legacy(m.oCaml))
    }
  }),
  LanguageDescription.of({
    name: "Octave",
    extensions: ["m"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/octave").then(m => legacy(m.octave))
    }
  }),
  LanguageDescription.of({
    name: "Oz",
    extensions: ["oz"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/oz").then(m => legacy(m.oz))
    }
  }),
  LanguageDescription.of({
    name: "Pascal",
    extensions: ["p","pas"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/pascal").then(m => legacy(m.pascal))
    }
  }),
  LanguageDescription.of({
    name: "Perl",
    extensions: ["pl","pm"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/perl").then(m => legacy(m.perl))
    }
  }),
  LanguageDescription.of({
    name: "Pig",
    extensions: ["pig"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/pig").then(m => legacy(m.pig))
    }
  }),
  LanguageDescription.of({
    name: "PowerShell",
    extensions: ["ps1","psd1","psm1"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/powershell").then(m => legacy(m.powerShell))
    }
  }),
  LanguageDescription.of({
    name: "Properties files",
    alias: ["ini","properties"],
    extensions: ["properties","ini","in"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/properties").then(m => legacy(m.properties))
    }
  }),
  LanguageDescription.of({
    name: "ProtoBuf",
    extensions: ["proto"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/protobuf").then(m => legacy(m.protobuf))
    }
  }),
  LanguageDescription.of({
    name: "Puppet",
    extensions: ["pp"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/puppet").then(m => legacy(m.puppet))
    }
  }),
  LanguageDescription.of({
    name: "Q",
    extensions: ["q"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/q").then(m => legacy(m.q))
    }
  }),
  LanguageDescription.of({
    name: "R",
    alias: ["rscript"],
    extensions: ["r","R"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/r").then(m => legacy(m.r))
    }
  }),
  LanguageDescription.of({
    name: "RPM Changes",
    load() {
      return import("@codemirror/next/legacy-modes/mode/rpm").then(m => legacy(m.rpmChanges))
    }
  }),
  LanguageDescription.of({
    name: "RPM Spec",
    extensions: ["spec"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/rpm").then(m => legacy(m.rpmSpec))
    }
  }),
  LanguageDescription.of({
    name: "Ruby",
    alias: ["jruby","macruby","rake","rb","rbx"],
    extensions: ["rb"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/ruby").then(m => legacy(m.ruby))
    }
  }),
  LanguageDescription.of({
    name: "SAS",
    extensions: ["sas"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/sas").then(m => legacy(m.sas))
    }
  }),
  LanguageDescription.of({
    name: "Scala",
    extensions: ["scala"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clike").then(m => legacy(m.scala))
    }
  }),
  LanguageDescription.of({
    name: "Scheme",
    extensions: ["scm","ss"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/scheme").then(m => legacy(m.scheme))
    }
  }),
  LanguageDescription.of({
    name: "SCSS",
    extensions: ["scss"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/css").then(m => legacy(m.sCSS))
    }
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["bash","sh","zsh"],
    extensions: ["sh","ksh","bash"],
    filename: /^PKGBUILD$/,
    load() {
      return import("@codemirror/next/legacy-modes/mode/shell").then(m => legacy(m.shell))
    }
  }),
  LanguageDescription.of({
    name: "Sieve",
    extensions: ["siv","sieve"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/sieve").then(m => legacy(m.sieve))
    }
  }),
  LanguageDescription.of({
    name: "Smalltalk",
    extensions: ["st"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/smalltalk").then(m => legacy(m.smalltalk))
    }
  }),
  LanguageDescription.of({
    name: "Solr",
    load() {
      return import("@codemirror/next/legacy-modes/mode/solr").then(m => legacy(m.solr))
    }
  }),
  LanguageDescription.of({
    name: "SML",
    extensions: ["sml","sig","fun","smackspec"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/mllike").then(m => legacy(m.sml))
    }
  }),
  LanguageDescription.of({
    name: "SPARQL",
    alias: ["sparul"],
    extensions: ["rq","sparql"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/sparql").then(m => legacy(m.sparql))
    }
  }),
  LanguageDescription.of({
    name: "Spreadsheet",
    alias: ["excel","formula"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/spreadsheet").then(m => legacy(m.spreadsheet))
    }
  }),
  LanguageDescription.of({
    name: "SQL",
    extensions: ["sql"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/sql").then(m => legacy(m.standardSQL))
    }
  }),
  LanguageDescription.of({
    name: "SQLite",
    load() {
      return import("@codemirror/next/legacy-modes/mode/sql").then(m => legacy(m.sqlite))
    }
  }),
  LanguageDescription.of({
    name: "Squirrel",
    extensions: ["nut"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/clike").then(m => legacy(m.squirrel))
    }
  }),
  LanguageDescription.of({
    name: "Stylus",
    extensions: ["styl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/stylus").then(m => legacy(m.stylus))
    }
  }),
  LanguageDescription.of({
    name: "Swift",
    extensions: ["swift"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/swift").then(m => legacy(m.swift))
    }
  }),
  LanguageDescription.of({
    name: "sTeX",
    load() {
      return import("@codemirror/next/legacy-modes/mode/stex").then(m => legacy(m.stex))
    }
  }),
  LanguageDescription.of({
    name: "LaTeX",
    alias: ["tex"],
    extensions: ["text","ltx","tex"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/stex").then(m => legacy(m.stex))
    }
  }),
  LanguageDescription.of({
    name: "SystemVerilog",
    extensions: ["v","sv","svh"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/verilog").then(m => legacy(m.verilog))
    }
  }),
  LanguageDescription.of({
    name: "Tcl",
    extensions: ["tcl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/tcl").then(m => legacy(m.tcl))
    }
  }),
  LanguageDescription.of({
    name: "Textile",
    extensions: ["textile"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/textile").then(m => legacy(m.textile))
    }
  }),
  LanguageDescription.of({
    name: "TiddlyWiki",
    load() {
      return import("@codemirror/next/legacy-modes/mode/tiddlywiki").then(m => legacy(m.tiddlyWiki))
    }
  }),
  LanguageDescription.of({
    name: "Tiki wiki",
    load() {
      return import("@codemirror/next/legacy-modes/mode/tiki").then(m => legacy(m.tiki))
    }
  }),
  LanguageDescription.of({
    name: "TOML",
    extensions: ["toml"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/toml").then(m => legacy(m.toml))
    }
  }),
  LanguageDescription.of({
    name: "troff",
    extensions: ["1","2","3","4","5","6","7","8","9"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/troff").then(m => legacy(m.troff))
    }
  }),
  LanguageDescription.of({
    name: "TTCN",
    extensions: ["ttcn","ttcn3","ttcnpp"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/ttcn").then(m => legacy(m.ttcn))
    }
  }),
  LanguageDescription.of({
    name: "TTCN_CFG",
    extensions: ["cfg"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/ttcn-cfg").then(m => legacy(m.ttcnCfg))
    }
  }),
  LanguageDescription.of({
    name: "Turtle",
    extensions: ["ttl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/turtle").then(m => legacy(m.turtle))
    }
  }),
  LanguageDescription.of({
    name: "Web IDL",
    extensions: ["webidl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/webidl").then(m => legacy(m.webIDL))
    }
  }),
  LanguageDescription.of({
    name: "VB.NET",
    extensions: ["vb"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/vb").then(m => legacy(m.vb))
    }
  }),
  LanguageDescription.of({
    name: "VBScript",
    extensions: ["vbs"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/vbscript").then(m => legacy(m.vbScript))
    }
  }),
  LanguageDescription.of({
    name: "Velocity",
    extensions: ["vtl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/velocity").then(m => legacy(m.velocity))
    }
  }),
  LanguageDescription.of({
    name: "Verilog",
    extensions: ["v"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/verilog").then(m => legacy(m.verilog))
    }
  }),
  LanguageDescription.of({
    name: "VHDL",
    extensions: ["vhd","vhdl"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/vhdl").then(m => legacy(m.vhdl))
    }
  }),
  LanguageDescription.of({
    name: "XQuery",
    extensions: ["xy","xquery"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/xquery").then(m => legacy(m.xQuery))
    }
  }),
  LanguageDescription.of({
    name: "Yacas",
    extensions: ["ys"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/yacas").then(m => legacy(m.yacas))
    }
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml"],
    extensions: ["yaml","yml"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/yaml").then(m => legacy(m.yaml))
    }
  }),
  LanguageDescription.of({
    name: "Z80",
    extensions: ["z80"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/z80").then(m => legacy(m.z80))
    }
  }),
  LanguageDescription.of({
    name: "mscgen",
    extensions: ["mscgen","mscin","msc"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/mscgen").then(m => legacy(m.mscgen))
    }
  }),
  LanguageDescription.of({
    name: "xu",
    extensions: ["xu"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/mscgen").then(m => legacy(m.xu))
    }
  }),
  LanguageDescription.of({
    name: "msgenny",
    extensions: ["msgenny"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/mscgen").then(m => legacy(m.msgenny))
    }
  }),
  LanguageDescription.of({
    name: "WebAssembly",
    extensions: ["wat","wast"],
    load() {
      return import("@codemirror/next/legacy-modes/mode/wast").then(m => legacy(m.wast))
    }
  })
]
