import typescript from "rollup-plugin-typescript2"
import commonjs from "rollup-plugin-commonjs"
import nodeResolve from "rollup-plugin-node-resolve"

export default {
  input: "./view/test/test.ts",
  output: {
    format: "umd",
    file: "./view/test/test_built.js",
    sourcemap: true
  },
  plugins: [
    nodeResolve(),
    typescript({
      check: false,
      tsconfigOverride: {
        compilerOptions: {lib: ["ES6", "dom"], sourceMap: false, target: "es5", strict: false},
        include: null
      }
    }),
    commonjs()
  ]
}
