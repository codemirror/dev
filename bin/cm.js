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
    return path.join(this.dir, "dist", "index.es.js")
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

  get inputFiles() {
    return this.sources.concat(this.dependencies.reduce((arr, dep) => arr.concat(dep.declarations), []))
  }

  rollupConfig(options) {
    return this._rollup || (this._rollup = {
      input: this.entrySource,
      external(id) { return id != "tslib" && !/^\.?\//.test(id) },
      output: [...options.esm ? [{
        format: "esm",
        file: this.esmFile,
        sourcemap: true,
        externalLiveBindings: false
      }] : [], {
        format: "cjs",
        file: this.cjsFile,
        sourcemap: true,
        externalLiveBindings: false
      }],
      plugins: [tsPlugin({lib: this.dom ? ["es6", "dom"] : ["es6"]})]
    })
  }
}

const baseCompilerOptions = {
  noImplicitReturns: false,
  noUnusedLocals: false,
  sourceMap: true
}

function tsPlugin(options) {
  return require("rollup-plugin-typescript2")({
    clean: true,
    tsconfig: path.join(root, "tsconfig.base.json"),
    tsconfigOverride: {
      references: [],
      compilerOptions: {...baseCompilerOptions, ...options},
      include: []
    }
  })
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
  new Pkg("fold", {entry: "fold", dom: true}),
  new Pkg("matchbrackets", {entry: "matchbrackets", dom: true}),
  new Pkg("closebrackets", {entry: "closebrackets", dom: true}),
  new Pkg("keymap", {entry: "keymap", dom: true}),
  new Pkg("multiple-selections", {entry: "multiple-selections", dom: true}),
  new Pkg("special-chars", {entry: "special-chars", dom: true}),
  new Pkg("panel", {entry: "panel", dom: true}),
  new Pkg("tooltip", {entry: "tooltip", dom: true}),
  new Pkg("search", {entry: "search", dom: true}),
  new Pkg("lint", {entry: "lint", dom: true}),
  new Pkg("highlight", {entry: "highlight", dom: true}),
  new Pkg("stream-syntax", {entry: "stream-syntax", dom: true}),
  new Pkg("lang-javascript"),
  new Pkg("lang-css", {entry: "css"}),
  new Pkg("lang-html", {entry: "html"}),
  new Pkg("autocomplete", {dom: true}),
]
const packageNames = Object.create(null)
for (let pkg of packages) packageNames[pkg.name] = pkg

const demo = {
  name: "demo",

  cjsFile: path.join(root, "demo/demo.js"),

  inputFiles: [path.join(root, "demo/demo.ts")],

  rollupConfig() {
    return this._rollup || (this._rollup = {
      input: path.join(root, "demo/demo.ts"),
      external(id) { return id != "tslib" && !/^\.?\//.test(id) },
      output: [{
        format: "cjs",
        file: this.cjsFile
      }],
      plugins: [tsPlugin({lib: ["es6", "dom"], declaration: false, declarationMap: false})]
    })
  }
}

const viewTests = {
  name: "view-tests",

  main: path.join(root, "view/test/test.ts"),

  cjsFile: path.join(root, "demo/test/test.js"),

  // FIXME derive automatically? move to separate dir?
  inputFiles: ["test", "test-draw", "test-domchange", "test-selection", "test-draw-decoration",
               "test-extension", "test-movepos", "test-composition"].map(f => path.join(root, "view/test", f + ".ts")),

  rollupConfig() {
    return this._rollup || (this._rollup = {
      input: this.main,
      external(id) { return id != "tslib" && !/^\.?\//.test(id) },
      output: [{
        format: "cjs",
        file: this.cjsFile,
        paths: id => id == ".." ? "../../view" : null
      }],
      plugins: [tsPlugin({lib: ["es6", "dom"], types: ["mocha", "node"], declaration: false, declarationMap: false})]
    })
  }
}

function start() {
  let command = process.argv[2]
  let args = process.argv.slice(3)
  let cmdFn = {
    packages: listPackages,
    build: build,
    devserver: devServer,
    release: release,
    "--help": () => help(0)
  }[command]
  if (!cmdFn || cmdFn.length > args.length) help(1)
  new Promise(r => r(cmdFn.apply(null, args))).catch(e => error(e))
}

function help(status) {
  console.log(`Usage:
  cm packages             Emit a list of all pkg names
  cm build [-w]           Build the bundle files
  cm devserver            Start a dev server on port 8090
  cm release              Create commits to tag a release
  cm --help`)
  process.exit(status)
}

function error(err) {
  console.error(err)
  process.exit(1)
}

function run(cmd, args, wd = root) {
  return child.execFileSync(cmd, args, {cwd: wd, encoding: "utf8", stdio: ["ignore", "pipe", process.stderr]})
}

function listPackages() {
  console.log(packages.map(p => p.name).join("\n"))
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

async function runRollup(config) {
  let bundle = await require("rollup").rollup(config)
  for (let output of config.output) {
    let result = await bundle.generate(output)
    let dir = path.dirname(output.file)
    await fsp.mkdir(dir, {recursive: true}).catch(() => null)
    for (let file of result.output) {
      let code = file.code || file.source
      if (!/\.d\.ts/.test(file.fileName))
        await fsp.writeFile(path.join(dir, file.fileName), code)
      else if (output.format == "cjs") // Don't double-emit declaration files
        await maybeWriteFile(path.join(dir, file.fileName),
                             /\.d\.ts\.map/.test(file.fileName) ? code.replace(/"sourceRoot":""/, '"sourceRoot":"../.."') : code)
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

async function rebuild(pkg, options) {
  if (!options.always) {
    let time = Math.min(fileTime(pkg.cjsFile), options.esm ? fileTime(pkg.esmFile) : Infinity)
    if (time >= 0 && !pkg.inputFiles.some(file => fileTime(file) >= time)) return
  }
  console.log(`Building ${pkg.name}...`)
  let t0 = Date.now()
  await runRollup(pkg.rollupConfig(options))
  console.log(`Done in ${Date.now() - t0}ms`)
}

class Watcher {
  constructor(pkgs, options) {
    this.pkgs = pkgs
    this.options = options
    this.work = []
    this.working = false
    let self = this
    for (let pkg of pkgs) {
      for (let file of pkg.inputFiles) fs.watch(file, function trigger(type) {
        self.trigger(pkg)
        if (type == "rename") setTimeout(() => {
          try { fs.watch(file, trigger) } catch {}
        }, 50)
      })
    }
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
    this.run().catch(e => console.log(e.stack || String(e))).then(() => this.working = false)
  }

  async run() {
    while (this.work.length) {
      for (let pkg of this.pkgs) {
        let index = this.work.indexOf(pkg)
        if (index < 0) continue
        this.work.splice(index, 1)
        await rebuild(pkg, this.options)
        break
      }
    }
  }
}

async function build(...args) {
  let filter = args.filter(a => a[0] != "-"), always = args.includes("--force")
  if (filter.length) {
    let targets = packages.concat([demo, viewTests])
    for (let name of filter) {
      let found = targets.find(t => t.name == name)
      if (!found) throw new Error(`Unknown package ${name}`)
      await rebuild(found, {esm: !["demo", "view-tests"].includes(name), always})
    }
  } else {
    for (let pkg of packages) await rebuild(pkg, {esm: true, always})
  }
}

function startServer() {
  let serve = path.join(root, "demo")
  let moduleserver = new (require("moduleserve/moduleserver"))({root: serve})
  let ecstatic = require("ecstatic")({root: serve})
  require("http").createServer((req, resp) => {
    moduleserver.handleRequest(req, resp) || ecstatic(req, resp)
  }).listen(8090, process.env.OPEN ? undefined : "127.0.0.1")
  console.log("Dev server listening on 8090")
}

async function devServer() {
  startServer()
  let target = packages.concat([demo, viewTests])
  for (let pkg of target) {
    try { await rebuild(pkg, {esm: false}) }
    catch(e) { console.log(e) }
  }
  new Watcher(target, {esm: false})
  console.log("Watching...")
}

function changelog(since) {
  let commits = run("git", ["log", "--format=%B", "--reverse", since + "..master"])
  let result = {fix: [], feature: [], breaking: []}
  let re = /\n\r?\n(BREAKING|FIX|FEATURE):\s*([^]*?)(?=\r?\n\r?\n|\r?\n?$)/g, match
  while (match = re.exec(commits)) result[match[1].toLowerCase()].push(match[2].replace(/\r?\n/g, " "))
  return result
}

function bumpVersion(version, changes) {
  let [major, minor, patch] = version.split(".")
  if (changes.breaking.length && major != "0") return `${Number(major) + 1}.0.0`
  if (changes.feature.length || changes.breaking.length) return `${major}.${Number(minor) + 1}.0`
  if (changes.fix.length) return `${major}.${minor}.${Number(patch) + 1}`
  throw new Error("No new release notes!")
}

function releaseNotes(changes, version) {
  let pad = n => n < 10 ? "0" + n : n
  let d = new Date, date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())

  let types = {breaking: "Breaking changes", fix: "Bug fixes", feature: "New features"}

  let refTarget = "https://codemirror.net/6/docs/ref/"
  let head = `## ${version} (${date})\n\n`, body = ""
  for (let type in types) {
    let messages = changes[type]
    if (messages.length) body += `### ${types[type]}\n\n`
    messages.forEach(message => body += message.replace(/\]\(##/g, "](" + refTarget + "#") + "\n\n")
  }
  return {head, body}
}

function setModuleVersion(version) {
  let file = path.join(root, "package.json")
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/"version":\s*".*?"/, `"version": "${version}"`))
}

function release() {
  let currentVersion = require(path.join(root, "package.json")).version
  let changes = changelog(currentVersion)
  let newVersion = bumpVersion(currentVersion, changes)
  console.log(`Creating @codemirror/next ${newVersion}`)

  let notes = releaseNotes(changes, newVersion)

  setModuleVersion(newVersion)
  let log = path.join(root, "CHANGELOG.md")
  fs.writeFileSync(log, notes.head + notes.body + fs.readFileSync(log, "utf8"))
  run("git", ["add", "package.json"])
  run("git", ["add", "CHANGELOG.md"])
  run("git", ["commit", "-m", `Mark version ${newVersion}`])
  run("git", ["tag", newVersion, "-m", `Version ${newVersion}\n\n${notes.body}`, "--cleanup=verbatim"])
}

start()
