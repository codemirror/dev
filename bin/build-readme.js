// Function to build github-proof readmes that contain the package's API
// docs as HTML.

const {core, nonCore} = require("./packages")
const {gather, gatherMany} = require("getdocs-ts")
const {build, browserImports} = require("builddocs")
const {join} = require("path"), fs = require("fs")

exports.buildReadme = function(pkg) {
  let imports = [type => {
    let sibling = type.typeSource && core.find(name => type.typeSource.startsWith("../" + name + "/"))
    if (sibling) return "https://codemirror.net/6/docs/ref#" + sibling + "." + type.type
  }, type => {
    if (/\blezer[\/-]tree\b/.test(type.typeSource)) return `https://lezer.codemirror.net/docs/ref/#tree.${type.type}`
    if (/\blezer\b/.test(type.typeSource)) return `https://lezer.codemirror.net/docs/ref/#lezer.${type.type}`
    if (/\bstyle-mod\b/.test(type.typeSource)) return "https://github.com/marijnh/style-mod#documentation"
  }, browserImports]

  let template = fs.readFileSync(join(pkg.dir, pkg.name == "legacy-modes" ? "mode" : "src", "README.md"), "utf8")
  let html = ""

  if (pkg.name == "legacy-modes") {
    let mods = fs.readdirSync(join(pkg.dir, "mode")).filter(f => /\.d.ts$/.test(f)).map(file => {
      let name = /^(.*)\.d\.ts$/.exec(file)[1]
      return {name, filename: join(pkg.dir, "mode", file), basedir: pkg.dir}
    }), items = gatherMany(mods)
    for (let i = 0; i < mods.length; i++) {
      let {name} = mods[i]
      html += `\n<h3 id="${name}">mode/<a href="#${name}">${name}</a></h3>\n` + build({
        name: pkg.name,
        anchorPrefix: name + ".",
        allowUnresolvedTypes: false,
        imports
      }, items[i])
    }
    template += "\n$$$"
  } else {
    let placeholders = /\n@[^]*@\w+|\n@\w+/.exec(template)
    html = build({
      mainText: placeholders[0],
      name: pkg.name,
      anchorPrefix: "",
      allowUnresolvedTypes: false,
      imports
    }, gather({filename: pkg.main, basedir: pkg.dir}))
    template = template.slice(0, placeholders.index) + "\n$$$" + template.slice(placeholders.index + placeholders[0].length)
  }

  html = html.replace(/<\/?span.*?>/g, "")
    .replace(/id="(.*?)"/g, (_, id) => `id="user-content-${id.toLowerCase()}"`)
    .replace(/href="#(.*?)"/g, (_, id) => {
      let first = /^[^^.]*/.exec(id)[0]
      if (core.includes(first)) return `href="https://codemirror.net/6/docs/ref/#${id}"`
      if (first == pkg.name && id.length > first.length) id = id.slice(first.length + 1)
      return `href="#user-content-${id.toLowerCase()}"`
    })

  return template.replace("$$$", html)
}
