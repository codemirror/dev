const fs = require("fs")
const {gather} = require('../gettypes')
const {build} = require('../builddocs')

const src = process.argv[2] || "doc/src/index.ts"
const items = gather({filename: src})
fs.writeFileSync("tpl", Object.keys(items).map(v => `@${v}`).join("\n"))
process.stdout.write(
  "<meta charset='utf-8'><dl>"+
  build(
    {
      name: "",
      main: "tpl",
      allowUnresolvedTypes: false,
      imports: [type => {
        let sibling = type.typeSource && type.typeSource.match(/([^/]+)\//)[1]
        if (sibling) return "#" + sibling + "." + type.type
      }]
    },
    items
  ) + "</dl>"
)
