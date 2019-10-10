#!/usr/bin/env node

const child = require("child_process"), fs = require("fs"), fsp = fs.promises, path = require("path")

let root = path.join(__dirname, "..")

class Pkg {
  constructor(name, options = {}) {
    this.name = name
    this.entry = options.entry || "index"
    this.dom = !!options.dom
    this.dir = path.join(root, name)
    this._dependencies = null
  }

  get sources() {
    let src = path.join(this.dir, "src")
    return fs.readdirSync(src).filter(file => /\.ts$/.test(file)).map(file => path.join(src, file))
  }

  get declarations() {
    let dist = path.join(this.dir, "dist")
    return !fs.existsSync(dist) ? [] :
      fs.readdirSync(dist).filter(file => /\.d\.ts$/.test(file)).map(file => path.join(dist, file))
  }

  get entrySource() {
    return path.join(this.dir, "src", this.entry + ".ts")
  }

  get esmFile() {
    return path.join(this.dir, "dist", "index.esm")
  }

  get cjsFile() {
    return path.join(this.dir, "dist", "index.js")
  }

  get dependencies() {
    if (!this._dependencies) {
      this._dependencies = []
      for (let file of this.sources) {
        let text = fs.readFileSync(file, "utf8")
        let imp = /(?:^|\n)\s*import.* from "\.\.\/\.\.\/([\w-]+)"/g, m
        while (m = imp.exec(text))
          if (!this._dependencies.includes(m[1]) && packageNames[m[1]])
            this._dependencies.push(packageNames[m[1]])
      }
    }
    return this._dependencies
  }
}

const packages = [
  new Pkg("text"),
  new Pkg("extension", {entry: "extension"}),
  new Pkg("state"),
  new Pkg("rangeset", {entry: "rangeset"}),
  new Pkg("history", {entry: "history"}),
  new Pkg("view", {dom: true}),
  new Pkg("gutter", {dom: true}),
  new Pkg("commands", {entry: "commands", dom: true}),
  new Pkg("syntax", {dom: true}),
  new Pkg("matchbrackets", {entry: "matchbrackets", dom: true}),
  new Pkg("keymap", {entry: "keymap", dom: true}),
  new Pkg("multiple-selections", {entry: "multiple-selections", dom: true}),
  new Pkg("highlight", {entry: "highlight", dom: true}),
  new Pkg("stream-syntax", {entry: "stream-syntax", dom: true}),
  new Pkg("lang-javascript", {entry: "javascript"}),
  new Pkg("lang-css", {entry: "css"}),
  new Pkg("lang-html", {entry: "html"})
]
const packageNames = Object.create(null)
for (let pkg of packages) packageNames[pkg.name] = pkg

function start() {
  let command = process.argv[2]
  let args = process.argv.slice(3)
  let cmdFn = {
    packages: listPackages,
    build: build,
    "--help": () => help(0)
  }[command]
  if (!cmdFn || cmdFn.length > args.length) help(1)
  new Promise(r => r(cmdFn.apply(null, args))).catch(e => error(e))
}

function help(status) {
  console.log(`Usage:
  cm packages             Emit a list of all pkg names
  cm build [-w]           Build the bundle files
  cm --help`)
  process.exit(status)
}

function error(err) {
  console.error(err)
  process.exit(1)
}

function run(cmd, args, wd) {
  return child.execFileSync(cmd, args, {cwd: wd, encoding: "utf8", stdio: ["ignore", "pipe", process.stderr]})
}

function listPackages() {
  console.log(packages.map(p => p.name).join("\n"))
}

function rollupConfig(pkg) {
  return {
    input: pkg.entrySource,
    external(id) { return id != "tslib" && !/^\.?\//.test(id) },
    output: [{
      format: "esm",
      file: pkg.esmFile,
      sourcemap: true,
      externalLiveBindings: false
    }, {
      format: "cjs",
      file: pkg.cjsFile,
      sourcemap: true,
      externalLiveBindings: false
    }],
    plugins: [require("rollup-plugin-typescript2")({
      clean: true,
      tsconfig: "./tsconfig.base.json",
      tsconfigOverride: {
        references: [],
        compilerOptions: {lib: pkg.dom ? ["es6", "dom"] : ["es6"]},
        include: []
      }
    })]
  }
}

async function maybeWriteFile(path, content) {
  let buffer = Buffer.from(content)
  let size = -1
  try {
    size = (await fsp.stat(path)).size
  } catch (e) {
    if (e.code != "ENOENT") throw e
  }
  if (size != buffer.length || !buffer.equals(await fsp.readFile(path)))
    await fsp.writeFile(path, buffer)
}

async function buildPkg(pkg) {
  let config = rollupConfig(pkg)
  let bundle = await require("rollup").rollup(config)
  for (let output of config.output) {
    let result = await bundle.generate(output)
    let dir = path.dirname(output.file)
    await fsp.mkdir(dir, {recursive: true}).catch(() => null)
    for (let file of result.output) {
      if (!/\.d\.ts$/.test(file.fileName))
        await fsp.writeFile(path.join(dir, file.fileName), file.code || file.source)
      else if (output.format == "cjs") // Don't double-emit declaration files
        await maybeWriteFile(path.join(dir, file.fileName), file.code || file.source)
      if (file.map)
        await fsp.writeFile(path.join(dir, file.fileName + ".map"), file.map.toString())
    }
  }
}

function fileTime(path) {
  try {
    let stat = fs.statSync(path)
    return stat.mtimeMs
  } catch(e) {
    if (e.code == "ENOENT") return -1
    throw e
  }
}

function mustRebuild(pkg) {
  let buildTime = fileTime(pkg.esmFile)
  if (buildTime < 0) return true
  for (let source of pkg.sources)
    if (fileTime(source) >= buildTime) return true
  for (let dep of pkg.dependencies)
    for (let decl of dep.declarations)
      if (fileTime(decl) >= buildTime) return true
  return false
}

async function rebuild(pkg) {
  if (!mustRebuild(pkg)) return
  console.log(`Building ${pkg.name}...`)
  let t0 = Date.now()
  await buildPkg(pkg)
  console.log(`Done in ${Date.now() - t0}ms`)
}

class Watcher {
  constructor() {
    this.work = []
    this.working = false
  }

  watch(pkg) {
    for (let source of pkg.sources)
      fs.watch(source, () => this.trigger(pkg))
    for (let dep of pkg.dependencies)
      for (let decl of dep.declarations)
        fs.watch(decl, () => this.trigger(pkg))
  }

  trigger(pkg) {
    if (!this.work.includes(pkg)) {
      this.work.push(pkg)
      setTimeout(() => this.startWork(), 20)
    }
  }

  startWork() {
    if (this.working) return
    this.working = true
    this.run().then(() => this.working = false, e => console.log(e.stack || String(e)))
  }

  async run() {
    while (this.work.length) {
      for (let pkg of packages) {
        let index = this.work.indexOf(pkg)
        if (index < 0) continue
        this.work.splice(index, 1)
        await rebuild(pkg)
      }
    }
  }
}

async function build(...args) {
  let watch = args.includes("-w") // FIXME
  for (let pkg of packages) await rebuild(pkg)
  if (watch) {
    let watcher = new Watcher()
    for (let pkg of packages) watcher.watch(pkg)
    console.log("Watching...")
  }
}

function devServer() {
  let moduleserver = new (require("moduleserve/moduleserver"))({root})
  let ecstatic = require("ecstatic")({root})
  require("http").createServer((req, resp) => {
    moduleserver.handleRequest(req, resp) || ecstatic(req, resp)
  }).listen(8090, process.env.OPEN ? undefined : "127.0.0.1")
  console.log("Dev server listening on 8090")
}

start()
