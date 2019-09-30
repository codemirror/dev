import typescript from "rollup-plugin-ts"
import commonjs from "rollup-plugin-commonjs"
import nodeResolve from "rollup-plugin-node-resolve"

let plugins5 = [
  nodeResolve(),
  typescript({
    check: false,
    tsconfigOverride: {
      compilerOptions: {lib: ["es5", "es6", "dom"], sourceMap: true, target: "es5", strict: false},
      include: null
    }
  }),
  commonjs()
]
let plugins6 = plugins5.slice()
plugins6[1] = typescript({
  check: false,
  tsconfigOverride: {
    compilerOptions: {lib: ["es5", "es6", "dom"], sourceMap: true, target: "es6", strict: false},
    include: null
  }
})

let result = []

for (let module of ["rangeset/src/rangeset.ts",
                    "text/src/index.ts",
                    "state/src/index.ts",
                    "history/src/index.ts"]) { // FIXME
  let base = /[^\/]+/.exec(module)[0]
  result.push({
    input: `./${module}`,
    output: {
      format: "cjs",
      file: `./${base}/dist/index.js`,
      sourcemap: true
    },
    plugins: plugins5
  }, {
    input: `./${module}`,
    output: {
      format: "esm",
      file: `./${base}/dist/index.esm`,
      sourcemap: true
    },
    plugins: plugins6
  })
}

export default result
