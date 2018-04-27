import typescript from "rollup-typescript";

export default {
  input: "./demo/demo.ts",
  output: {format: "umd", file: "./demo/demo_built.js"},
  sourcemap: true,
  plugins: [typescript()]
}
