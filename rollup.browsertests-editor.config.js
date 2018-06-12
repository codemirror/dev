import typescript from "rollup-plugin-typescript2";
import commonjs from "rollup-plugin-commonjs";

export default {
  input: "./browsertests/editor/demo.ts",
  output: {
    format: "umd",
    file: "./browsertests/editor/demo_built.js",
    sourcemap: true
  },
  plugins: [
    commonjs(),
    typescript({
      tsconfigOverride: {
        compilerOptions: {lib: ["ES6", "dom"], sourceMap: true, target: "es5", strict: false},
        include: null
      }
    })
  ]
}
