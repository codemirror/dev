import typescript from "rollup-plugin-typescript2";

export default {
  input: "./demo/demo.ts",
  output: {
    format: "umd",
    file: "./demo/demo_built.js",
    sourcemap: true
  },
  plugins: [
    typescript({
      tsconfigOverride: {
        compilerOptions: {lib: ["ES6", "dom"], sourceMap: true, target: "es5", strict: false},
        include: null
      }
    })
  ]
}
