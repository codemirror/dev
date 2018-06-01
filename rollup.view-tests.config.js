import typescript from "rollup-plugin-typescript2";
import commonjs from "rollup-plugin-commonjs"

export default {
  input: "./view/test/test.ts",
  output: {
    format: "umd",
    file: "./view/test/test_built.js",
    sourcemap: false
  },
  plugins: [
    typescript({
      tsconfigOverride: {
        compilerOptions: {lib: ["ES6", "dom"], sourceMap: false, target: "es5", strict: false},
        include: null
      }
    }),
    commonjs()
  ]
}
