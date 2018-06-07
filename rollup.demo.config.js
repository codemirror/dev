import typescript from "rollup-plugin-typescript2";
import commonjs from "rollup-plugin-commonjs";

export default {
  input: "./demo/demo.ts",
  output: {
    format: "umd",
    file: "./demo/demo_built.js",
    sourcemap: true
  },
  plugins: [
    commonjs(),
    {transform(code) { return {code: code.replace(/const keyName = require\("w3c-keyname"\)/g, 'import keyName from "w3c-keyname"') }}},
    typescript({
      tsconfigOverride: {
        compilerOptions: {lib: ["ES6", "dom"], sourceMap: true, target: "es5", strict: false},
        include: null
      }
    })
  ]
}
