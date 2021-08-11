#!/usr/bin/env node

// NOTE: Don't require anything from node_modules here, since the
// install script has to be able to run _before_ that exists.
const child = require("child_process"), fs = require("fs"), path = require("path"), {join} = path

let root = join(__dirname, "..")

const {loadPackages, nonCore} = require("./packages")

let {packages, packageNames, buildPackages} = loadPackages()

function start() {
  let command = process.argv[2]
  if (command && !["install", "--help"].includes(command)) assertInstalled()
  let args = process.argv.slice(3)
  let cmdFn = {
    packages: listPackages,
    status,
    build,
    devserver,
    release,
    "release-major": releaseMajor,
    install,
    clean,
    commit,
    push,
    grep,
    "build-readme": buildReadme,
    test,
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
  cm status               Output git status, when interesting, for packages
  cm build                Build the bundle files
  cm clean                Delete files created by the build
  cm devserver            Start a dev server on port 8090
  cm release <package> [--edit] [--version <version>]
                          Create commits to tag a release
  cm build-readme <pkg>   Regenerate the readme file for a non-core package
  cm commit <args>        Run git commit in all packages that have changes
  cm push                 Run git push in packages that have new commits
  cm run <command>        Run the given command in each of the package dirs
  cm test [--no-browser]  Run the test suite of all the packages
  cm grep <pattern>       Grep through the source code for all packages
  cm --help`)
  process.exit(status)
}

function error(err) {
  console.error(err)
  process.exit(1)
}

function run(cmd, args, wd = root, { shell = false } = {}) {
  return child.execFileSync(cmd, args, {shell, cwd: wd, encoding: "utf8", stdio: ["ignore", "pipe", process.stderr]})
}

function replace(file, f) {
  fs.writeFileSync(file, f(fs.readFileSync(file, "utf8")))
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

  console.log("Running npm install")
  run("npm", ["install"], root, {shell: process.platform == "win32"})
  console.log("Building modules")
  ;({packages, packageNames, buildPackages} = loadPackages())
  build()
}


function listPackages() {
  console.log(packages.map(p => p.name).join("\n"))
}

function status() {
  for (let pkg of packages) {
    let output = run("git", ["status", "-sb"], pkg.dir)
    if (output != "## main...origin/main\n")
      console.log(`${pkg.name}:\n${output}`)
  }
}

async function build() {
  console.info("Building...")
  let t0 = Date.now()
  await require("@codemirror/buildhelper").build(buildPackages.map(p => p.main))
  console.info(`Done in ${((Date.now() - t0) / 1000).toFixed(2)}s`)
}

function startServer() {
  let serve = join(root, "demo")
  let moduleserver = new (require("esmoduleserve/moduleserver"))({root: serve, maxDepth: 2})
  let serveStatic = require("serve-static")(serve)
  require("http").createServer((req, resp) => {
    if (/^\/test\/?($|\?)/.test(req.url)) {
      let runTests = require("@codemirror/buildhelper/src/runtests")
      let {browserTests} = runTests.gatherTests(buildPackages.map(p => p.dir))
      resp.writeHead(200, {"content-type": "text/html"})
      resp.end(runTests.testHTML(browserTests.map(f => path.relative(serve, f)), false))
    } else {
      moduleserver.handleRequest(req, resp) || serveStatic(req, resp, _err => {
        resp.statusCode = 404
        resp.end('Not found')
      })
    }
  }).listen(8090, process.env.OPEN ? undefined : "127.0.0.1")
  console.log("Dev server listening on 8090")
}

function devserver() {
  require("@codemirror/buildhelper").watch(buildPackages.map(p => p.main).filter(f => f), [join(root, "demo/demo.ts")])
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
    let updated = text.replace(new RegExp(`("@codemirror/${pkg.name}": ")(.*?)"`, "g"), (_, m) => m + "^" + version + '"')
    if (updated != text) {
      changed.push(other)
      fs.writeFileSync(pkgFile, updated)
      run("git", ["add", "package.json"], other.dir)
      let lastMsg = run("git", ["log", "-1", "--pretty=%B"], other.dir)
      if (/^Bump dependency /.test(lastMsg))
        run("git", ["commit", "--amend", "-m", lastMsg.trimEnd() + ", @codemirror/" + pkg.name], other.dir)
      else
        run("git", ["commit", "-m", "Bump dependency for @codemirror/" + pkg.name], other.dir)
    }
  }
  return changed
}

function updateAllDependencyVersions(version) {
  for (let pkg of packages) {
    let pkgFile = join(pkg.dir, "package.json"), text = fs.readFileSync(pkgFile, "utf8")
    let updated = text.replace(/("@codemirror\/[^"]+": ")([^"]+)"/g, (_, m, old) => {
      return m + (/buildhelper/.test(m) ? old : "^" + version) + '"'
    })
    fs.writeFileSync(pkgFile, updated)
  }
}

function version(pkg) {
  return require(join(pkg.dir, "package.json")).version
}

const mainVersion = /^0.\d+|\d+/

function release(...args) {
  let setVersion, edit = false, pkgName, pkg
  for (let i = 0; i < args.length; i++) {
    let arg = args[i]
    if (arg == "--edit") edit = true
    else if (arg == "--version" && i < args.length) setVersion = args[++i]
    else if (!pkgName && arg[0] != "-") pkgName = arg
    else help(1)
  }
  if (!pkgName || !(pkg = packageNames[pkgName])) help(1)

  let {changes, newVersion} = doRelease(pkg, setVersion, {edit})

  if (mainVersion.exec(newVersion)[0] != mainVersion.exec(version(pkg))[0]) {
    let updated = updateDependencyVersion(pkg, newVersion)
    if (updated.length) console.log(`Updated dependencies in ${updated.map(p => p.name).join(", ")}`)
  }
}

function doRelease(pkg, newVersion, {edit = false, defaultChanges = null}) {
  let log = join(pkg.dir, "CHANGELOG.md")
  let newPackage = !fs.existsSync(log)

  let currentVersion = version(pkg)
  let changes = newPackage ? {fix: [], feature: [], breaking: ["First numbered release."]} : changelog(pkg, currentVersion)
  if (defaultChanges && !changes.fix.length && !changes.feature.length && !changes.breaking.length) changes = defaultChanges
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

  return {changes, newVersion}
}

function releaseMajor() {
  let versions = packages.map(version), prev = Math.max(...versions.map(v => +v.split(".")[1]))
  let newVersion = `0.${prev + 1}.0`
  updateAllDependencyVersions(newVersion)
  for (let pkg of packages) doRelease(pkg, newVersion, {
    defaultChanges: {fix: [], feature: [], breaking: ["Update dependencies to " + newVersion]}
  })
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
    run("rm", ["-rf", "dist"], pkg.dir)
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
    catch (_) { return }
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

function test(...args) {
  let runTests = require("@codemirror/buildhelper/src/runtests")
  let {tests, browserTests} = runTests.gatherTests(buildPackages.map(p => p.dir))
  let browsers = [], grep, noBrowser = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] == "--firefox") browsers.push("firefox")
    if (args[i] == "--chrome") browser.push("chrome")
    if (args[i] == "--no-browser") noBrowser = true
    if (args[i] == "--grep") grep = args[++i]
  }
  if (!browsers.length && !noBrowser) browsers.push("chrome")
  runTests.runTests({tests, browserTests, browsers, grep}).then(failed => process.exit(failed ? 1 : 0))
}

start()
