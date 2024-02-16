const fs = require("fs"), {join} = require("path")

exports.core = [
  "state",
  "view",
  "language",
  "commands",
  "search",
  "autocomplete",
  "lint",
  "collab",
  "language-data",
  "codemirror",
]
exports.nonCore = [
  "lang-javascript",
  "lang-java",
  "lang-json",
  "lang-cpp",
  "lang-php",
  "lang-python",
  "lang-go",
  "lang-css",
  "lang-sass",
  "lang-html",
  "lang-sql",
  "lang-rust",
  "lang-xml",
  "lang-markdown",
  "lang-lezer",
  "lang-wast",
  "lang-angular",
  "lang-vue",
  "lang-liquid",
  "lang-less",
  "lang-yaml",
  "legacy-modes",
  "theme-one-dark",
  "merge"
]

exports.all = exports.core.concat(exports.nonCore)

class Pkg {
  constructor(name) {
    this.name = name
    this.dir = join(__dirname, "..", name)
    this.main = null
    if (name != "legacy-modes" && fs.existsSync(this.dir)) {
      let files = fs.readdirSync(join(this.dir, "src")).filter(f => /^[^.]+\.ts$/.test(f))
      let main = files.length == 1 ? files[0] : files.includes("index.ts") ? "index.ts"
          : files.includes(name.replace(/^(theme-|lang-)/, "") + ".ts") ? name.replace(/^(theme-|lang-)/, "") + ".ts" : null
      if (!main) throw new Error("Couldn't find a main script for " + name)
      this.main = join(this.dir, "src", main)
    }
  }
}
exports.Pkg = Pkg

exports.loadPackages = function loadPackages() {
  let packages = exports.all.map(n => new Pkg(n))
  let packageNames = Object.create(null)
  for (let p of packages) packageNames[p.name] = p
  return {packages, packageNames, buildPackages: packages.filter(p => p.main)}
}
