#!/usr/bin/env node

const child = require("child_process"), fs = require("fs"), fsp = fs.promises, path = require("path")

let root = path.join(__dirname, "..")

class Pkg {
  constructor(name) {
    this.name = name
    this.dir = path.join(root, name)
    this.json = require(path.join(this.dir, "package.json"))
  }
}

const packageFile = path.join(root, "package.json"), packageJSON = JSON.parse(fs.readFileSync(packageFile, "utf8"))
const packages = [], packageNames = Object.create(null)
for (let exp of Object.keys(packageJSON.exports)) {
  let pkg = new Pkg(/\.\/(.*)/.exec(exp)[1])
  packages.push(pkg)
  packageNames[pkg.name] = pkg
}
  
function external(id) { return id != "tslib" && !/^(\.?\/|\w:)/.test(id) }

function start() {
  let command = process.argv[2]
  let args = process.argv.slice(3)
  let cmdFn = {
    packages: listPackages,
    build,
    devserver,
    release,
    "--help": () => help(0)
  }[command]
  if (!cmdFn || cmdFn.length > args.length) help(1)
  new Promise(r => r(cmdFn.apply(null, args))).catch(e => error(e))
}

function help(status) {
  console.log(`Usage:
  cm packages             Emit a list of all pkg names
  cm build                Build the bundle files
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

async function runRollup(configs) {
  for (let config of Array.isArray(configs) ? configs : [configs]) {
    let bundle = await require("rollup").rollup(config)
    let result = await bundle.generate(config.output)
    let dir = path.dirname(config.output.file)
    await fsp.mkdir(dir, {recursive: true}).catch(() => null)
    for (let file of result.output) {
      await fsp.writeFile(path.join(dir, file.fileName), file.code || file.source)
      if (file.map)
        await fsp.writeFile(path.join(dir, file.fileName + ".map"), file.map.toString())
    }
  }
}

function rollupConfig(pkg) {
  return {
    input: path.join(pkg.dir, pkg.json.types + ".js"),
    external,
    output: {
      format: "esm",
      file: path.join(pkg.dir, "dist", "index.js"),
      sourcemap: true,
      externalLiveBindings: false
    }
  }
}

async function build() {
  console.info("Running TypeScript compiler...")
  let t0 = Date.now()
  tsBuild()
  console.info(`Done in ${Date.now() - t0}ms`)
  console.info("Building bundles...")
  t0 = Date.now()
  await runRollup(packages.map(rollupConfig))
  console.log(`Done in ${Date.now() - t0}ms`)
}

function startServer() {
  let serve = path.join(root, "demo")
  let moduleserver = new (require("esmoduleserve/moduleserver"))({root: serve, maxDepth: 2})
  let serveStatic = require("serve-static")(serve)
  require("http").createServer((req, resp) => {
    moduleserver.handleRequest(req, resp) || serveStatic(req, resp, err => {
      resp.statusCode = 404
      resp.end('Not found')
    })
  }).listen(8090, process.env.OPEN ? undefined : "127.0.0.1")
  console.log("Dev server listening on 8090")
}

const watchConfig = {clearScreen: false}

function tsWatch() {
  const ts = require("typescript")
  const formatHost = {
    getCanonicalFileName: path => path,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => "\n"
  }
  ts.createWatchProgram(ts.createWatchCompilerHost(
    path.join(root, "tsconfig.json"),
    {},
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    diag => console.error(ts.formatDiagnostic(diag, formatHost)),
    diag => console.info(ts.flattenDiagnosticMessageText(diag.messageText, "\n"))
  ))
}

function tsBuild() {
  const ts = require("typescript")
  const formatHost = {
    getCanonicalFileName: path => path,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => "\n"
  }
  let conf = ts.getParsedCommandLineOfConfigFile(path.join(root, "tsconfig.json"), {}, ts.sys)
  let program = ts.createProgram(conf.fileNames, conf.options)
  let emitResult = program.emit()

  for (let diag of ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics))
    console.error(ts.formatDiagnostic(diag, formatHost))

  if (emitResult.emitSkipped) error("TS build failed")
}

function devserver() {
  tsWatch()
  console.log("Watching...")
  for (let pkg of packages) {
    let watcher = require("rollup").watch(Object.assign(rollupConfig(pkg), watchConfig))
    watcher.on("event", event => {
      if (event.code == "START") console.info("Start bundling " + pkg.name + "...")
      else if (event.code == "END") console.info("Finished bundling " + pkg.name)
      else if (event.code == "ERROR") console.error("Bundling error: " + event.error)
    })
  }
  startServer()
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
  fs.writeFileSync(packageFile, fs.readFileSync(packageFile, "utf8").replace(/"version":\s*".*?"/, `"version": "${version}"`))
}

function release() {
  let currentVersion = packageJSON.version
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
