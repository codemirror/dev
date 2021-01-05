#!/usr/bin/env node

// NOTE: Don't require anything from node_modules here, since the
// install script has to be able to run _before_ that exists.
const child = require("child_process"), fs = require("fs"), fsp = fs.promises, path = require("path"), {join} = path

let root = join(__dirname, "..")

const {loadPackages, nonCore} = require("./packages")

let {packages, packageNames, buildPackages} = loadPackages()

function start() {
  let command = process.argv[2]
  if (command && !["install", "--help"].includes(command)) assertInstalled()
  let args = process.argv.slice(3)
  let cmdFn = {
    packages: listPackages,
    build,
    devserver,
    release,
    install,
    clean,
    commit,
    push,
    grep,
    "build-readme": buildReadme,
    run: runCmd,
    "--help": () => help(0)
  }[command]
  if (!cmdFn || cmdFn.length > args.length) help(1)
  new Promise(r => r(cmdFn.apply(null, args))).catch(e => error(e))
}

function help(status) {
  console.log(`Usage:
  cm install [--ssh]      Clone and symlink the packages, install deps, build
  cm packages             Emit a list of all pkg names
  cm build                Build the bundle files
  cm clean                Delete files created by the build
  cm devserver            Start a dev server on port 8090
  cm release <package> [--edit] [--version <version>]
                          Create commits to tag a release
  cm build-readme <pkg>   Regenerate the readme file for a non-core package
  cm commit <args>        Run git commit in all packages that have changes
  cm push                 Run git push in packages that have new commits
  cm run <command>        Run the given command in each of the package dirs
  cm grep <pattern>       Grep through the source code for all packages
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

function assertInstalled() {
  for (let p of packages) {
    if (!fs.existsSync(p.dir)) {
      console.error(`module ${p.name} is missing. Did you forget to run 'cm install'?`)
      process.exit(1)
    }
  }
}

function install(arg = null) {
  let base = arg == "--ssh" ? "git@github.com:codemirror/" : "https://github.com/codemirror/"
  if (arg && arg != "--ssh") help(1)

  for (let pkg of packages) {
    if (fs.existsSync(pkg.dir)) {
      console.warn(`Skipping cloning of ${pkg.name} (directory exists)`)
    } else {
      let origin = base + pkg.name + ".git"
      run("git", ["clone", origin, pkg.dir])
    }
  }

  console.log("Running yarn install")
  run("yarn", ["install"])
  console.log("Building modules")
  ;({packages, packageNames, buildPackages} = loadPackages())
  build()
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
      await fsp.writeFile(join(dir, file.fileName), file.code || file.source)
      if (file.map)
        await fsp.writeFile(join(dir, file.fileName + ".map"), file.map.toString())
    }
  }
}

function external(id) { return id != "tslib" && !/^(\.?\/|\w:)/.test(id) }

function rollupConfig(pkg) {
  return {
    input: pkg.main.replace(/\.ts$/, ".js"),
    external,
    output: {
      format: "esm",
      file: join(pkg.dir, "dist", "index.js"),
      sourcemap: true,
      externalLiveBindings: false
    },
    plugins: [require("lezer-generator/rollup").lezer()]
  }
}

function rollupDeclConfig(pkg) {
  return {
    input: pkg.main.replace(/\.ts$/, ".d.ts"),
    external,
    output: {
      format: "esm",
      file: join(pkg.dir, "dist", "index.d.ts")
    },
    plugins: [
      require("rollup-plugin-dts").default(),
      {
        name: "fixup-relative-paths",
        generateBundle(options, bundle) {
          for (let file in bundle) {
            let asset = bundle[file]
            if (asset.code) asset.code = asset.code.replace(/['"]\.\.\/\.\.\/(\w+)\/src['"]/, (m, mod) => {
              return packageNames[mod] ? `"@codemirror/${mod}"` : m
            })
          }
        }
      }
    ],
    onwarn(warning, warn) {
      if (warning.code != "CIRCULAR_DEPENDENCY" && warning.code != "UNUSED_EXTERNAL_IMPORT") warn(warning)
    }
  }
}

async function build() {
  console.info("Running TypeScript compiler...")
  let t0 = Date.now()
  tsBuild()
  console.info(`Done in ${((Date.now() - t0) / 1000).toFixed(2)}s`)
  console.info("Building bundles...")
  t0 = Date.now()
  await runRollup(buildPackages.map(rollupConfig).concat(buildPackages.map(rollupDeclConfig)))
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(2)}s`)
}

function startServer() {
  let serve = join(root, "demo")
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

function tsFormatHost(ts) {
  return {
    getCanonicalFileName: path => path,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => "\n"
  }
}

function tsWatch() {
  const ts = require("typescript")
  ts.createWatchProgram(ts.createWatchCompilerHost(
    join(root, "tsconfig.json"),
    {},
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    diag => console.error(ts.formatDiagnostic(diag, tsFormatHost(ts))),
    diag => console.info(ts.flattenDiagnosticMessageText(diag.messageText, "\n"))
  ))
}

function tsBuild() {
  const ts = require("typescript")
  let conf = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, ts.sys)
  let program = ts.createProgram(conf.fileNames, conf.options, ts.createCompilerHost(conf.options))
  let emitResult = program.emit()

  for (let diag of ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics))
    console.error(ts.formatDiagnostic(diag, tsFormatHost(ts)))

  if (emitResult.emitSkipped) error("TS build failed")
}

function devserver() {
  tsWatch()
  console.log("Watching...")
  for (let pkg of buildPackages) {
    let watcher = require("rollup").watch(rollupConfig(pkg))
    watcher.on("event", event => {
      if (event.code == "START") console.info("Start bundling " + pkg.name + "...")
      else if (event.code == "END") console.info("Finished bundling " + pkg.name)
      else if (event.code == "ERROR") console.error(`Bundling error (${pkg.name}): ${event.error}`)
      else if (event.code == "BUNDLE_END") event.result.close()
    })
    let declWatcher = require("rollup").watch(rollupDeclConfig(pkg))
    declWatcher.on("event", event => {
      if (event.code == "ERROR") console.error(`Decl bundling error (${pkg.name}): ${event.error}`)
      else if (event.code == "BUNDLE_END") event.result.close()
    })
  }
  startServer()
}

function changelog(pkg, since) {
  let commits = run("git", ["log", "--format=%B", "--reverse", since + "..main"], pkg.dir)
  let result = {fix: [], feature: [], breaking: []}
  let re = /\n\r?\n(BREAKING|FIX|FEATURE):\s*([^]*?)(?=\r?\n\r?\n|\r?\n?$)/g, match
  while (match = re.exec(commits)) result[match[1].toLowerCase()].push(match[2].replace(/\r?\n/g, " "))
  return result
}

function bumpVersion(version, changes) {
  let [major, minor, patch] = version.split(".")
  if (major == "0") return changes.breaking.length ? `0.${Number(minor) + 1}.0` : `0.${minor}.${Number(patch) + 1}`
  if (changes.breaking.length) return `${Number(major) + 1}.0.0`
  if (changes.feature.length) return `${major}.${Number(minor) + 1}.0`
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

function setModuleVersion(pkg, version) {
  let file = join(pkg.dir, "package.json")
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/"version":\s*".*?"/, `"version": "${version}"`))
}

function updateDependencyVersion(pkg, version) {
  let changed = []
  for (let other of packages) if (other != pkg) {
    let pkgFile = join(other.dir, "package.json"), text = fs.readFileSync(pkgFile, "utf8")
    let updated = text.replace(new RegExp(`("@codemirror/${pkg.name}": ")(.*?)"`, "g"), (_, m, v) => m + "^" + version + '"')
    if (updated != text) {
      changed.push(other)
      fs.writeFileSync(pkgFile, changed)
      run("git", ["add", "package.json"], other.dir)
      let lastMsg = run("git", ["log", "-1", "--pretty=%B"], other.dir)
      if (/^Bump dependency /.test(lastMsg))
        run("git", ["commit", "--amend", "-m", lastMsg + ", @codemirror/" + pkg.name], other.dir)
      else
        run("git", ["commit", "-m", "Bump dependency for @codemirror/" + pkg.name], other.dir)
    }
  }
  return changed
}

function release(...args) {
  let newVersion, edit = false, pkgName, pkg
  for (let i = 0; i < args.length; i++) {
    let arg = args[i]
    if (arg == "--edit") edit = true
    else if (arg == "--version" && i < args.length) newVersion = args[++i]
    else if (!pkgName && arg[0] != "-") pkgName = arg
    else help(1)
  }
  if (!pkgName || !(pkg = packageNames[pkgName])) help(1)

  let log = join(pkg.dir, "CHANGELOG.md")
  let newPackage = !fs.existsSync(log)

  let currentVersion = require(join(pkg.dir, "package.json")).version
  let changes = newPackage ? {fix: [], feature: [], breaking: ["First numbered release."]} : changelog(pkg, currentVersion)
  if (!newVersion) newVersion = newPackage ? currentVersion : bumpVersion(currentVersion, changes)
  console.log(`Creating @codemirror/${pkg.name} ${newVersion}`)

  let notes = releaseNotes(changes, newVersion)
  if (edit) notes = editReleaseNotes(notes)

  setModuleVersion(pkg, newVersion)
  fs.writeFileSync(log, notes.head + notes.body + (newPackage ? "" : fs.readFileSync(log, "utf8")))
  run("git", ["add", "package.json"], pkg.dir)
  run("git", ["add", "CHANGELOG.md"], pkg.dir)
  run("git", ["commit", "-m", `Mark version ${newVersion}`], pkg.dir)
  run("git", ["tag", newVersion, "-m", `Version ${newVersion}\n\n${notes.body}`, "--cleanup=verbatim"], pkg.dir)

  if (changes.breaking.length) {
    let updated = updateDependencyVersion(pkg, newVersion)
    if (updated.length) console.log(`Updated dependencies in ${updated.map(p => p.name).join(", ")}`)
  }
}

function editReleaseNotes(notes) {
  let noteFile = join(root, "notes.txt")
  fs.writeFileSync(noteFile, notes.head + notes.body)
  run(process.env.EDITOR || "emacs", [noteFile])
  let edited = fs.readFileSync(noteFile)
  fs.unlinkSync(noteFile)
  if (!/\S/.test(edited)) process.exit(0)
  let split = /^(.*)\n+([^]*)/.exec(edited)
  return {head: split[1] + "\n\n", body: split[2]}
}

function clean() {
  for (let pkg of buildPackages)
    run("rm", ["-rf", "dist", "src/*.d.ts", "src/*.js", "src/*.map"], pkg.dir)
}

function commit(...args) {
  for (let pkg of packages) {
    if (run("git", ["diff"], pkg.dir) || run("git", ["diff", "--cached"], pkg.dir))
      console.log(pkg.name + ":\n" + run("git", ["commit"].concat(args), pkg.dir))
  }
}

function push() {
  for (let pkg of packages) {
    if (/\bahead\b/.test(run("git", ["status", "-sb"], pkg.dir)))
      run("git", ["push"], pkg.dir)
  }
}

function grep(pattern) {
  let files = [join(root, "demo", "demo.ts")]
  function add(dir, ext) {
    let list
    try { list = fs.readdirSync(dir) }
    catch { return }
    for (let f of list) if (ext.includes(/^[^.]*(.*)/.exec(f)[1])) {
      files.push(path.relative(process.cwd(), join(dir, f)))
    }
  }
  for (let pkg of packages) {
    if (pkg.name == "legacy-modes") {
      add(join(pkg.dir, "mode"), [".js", ".d.ts"])
    } else {
      add(join(pkg.dir, "src"), [".ts"])
      add(join(pkg.dir, "test"), [".ts"])
    }
  }
  try {
    console.log(run("grep", ["--color", "-nH", "-e", pattern].concat(files), process.cwd()))
  } catch(e) {
    process.exit(1)
  }
}

function runCmd(cmd, ...args) {
  for (let pkg of packages) {
    console.log(pkg.name + ":")
    try {
      console.log(run(cmd, args, pkg.dir))
    } catch (e) {
      console.log(e.toString())
      process.exit(1)
    }
  }
}

function buildReadme(name) {
  if (!nonCore.includes(name)) help(1)
  let pkg = packageNames[name]
  fs.writeFileSync(join(pkg.dir, "README.md"), require("./build-readme").buildReadme(pkg))
}

start()
