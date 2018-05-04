export default {
  input: "./view/test/test.ts",
  output: {
    format: "umd",
    file: "./view/test/test_built.js",
    sourcemap: true
  },
  plugins: [require("rollup-typescript")(), require("rollup-plugin-commonjs")()]
}
