import typescript from "rollup-plugin-typescript2"
import commonjs from "rollup-plugin-commonjs"

let mode = process.env.DEVSERVER ? "devserver" : "build"

let cjs = commonjs()
let result = []

function external(id) { return !/^\.?\//.test(id) }

function config(module, format) {
  let [_, base, file] = /^(.+?)\/src\/(.*?)\.ts/.exec(module)
  return {
    input: `./${module}`,
    external,
    output: {
      format,
      file: `./${base}/dist/${file}.${format == "cjs" ? "js" : "esm"}`,
      sourcemap: true,
      externalLiveBindings: false
    },
    plugins: [typescript({
      tsconfig: "./tsconfig.base.json",
      tsconfigOverride: {
        compilerOptions: {
          target: format == "esm" ? "es6" : "es5",
          declarationDir: `./${base}/dist`,
          declarationMap: true
        },
        include: [`./${base}/src/*.ts`]
      },
      useTsconfigDeclarationDir: true
    }), cjs]
  }
}

for (let module of ["text/src/index.ts",
                    "extension/src/extension.ts",
                    "state/src/index.ts",
                    "rangeset/src/rangeset.ts",
                    "history/src/history.ts",
                    "view/src/index.ts",
                    "gutter/src/index.ts",
                    "commands/src/commands.ts",
                    "special-chars/src/special-chars.ts",
                    "syntax/src/index.ts",
                    "matchbrackets/src/matchbrackets.ts",
                    "keymap/src/keymap.ts",
                    "multiple-selections/src/multiple-selections.ts",
                    "theme/src/index.ts",
                    "stream-syntax/src/stream-syntax.ts",
                    "lang-javascript/src/javascript.ts",
                    "lang-css/src/css.ts",
                    "lang-html/src/html.ts"]) {
  result.push(config(module, "cjs"))
  if (mode == "build") result.push(config(module, "esm"))
}


if (mode == "devserver") {
  result.push({
    input: `./demo/demo.ts`,
    external,
    output: {
      format: "cjs",
      file: "./demo/demo.js",
      sourcemap: true,
    },
    plugins: [typescript({
      tsconfigOverride: {
        compilerOptions: {declaration: false},
        include: [`./demo/*.ts`]
      }
    }), cjs]
  }, {
    input: `./view/test/test.ts`,
    external,
    output: {
      format: "cjs",
      file: "./demo/test/test.js",
      sourcemap: true,
      paths: id => id == ".." ? "../../view" : null
    },
    plugins: [typescript({
      tsconfigOverride: {
        compilerOptions: {declaration: false},
        include: [`./view/test/*.ts`]
      }
    }), cjs]
  })

  let root = "./demo"
  let moduleserver = new (require("moduleserve/moduleserver"))({root})
  let ecstatic = require("ecstatic")({root})
  require("http").createServer((req, resp) => {
    moduleserver.handleRequest(req, resp) || ecstatic(req, resp)
  }).listen(8090, process.env.OPEN ? undefined : "127.0.0.1")
  console.log("Dev server listening on 8090")
}

export default result
