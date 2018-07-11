import {EditorState} from "../state/src"
import { PerformanceObserver, performance } from "perf_hooks"
import {legacyMode} from "./src/"
import toml from "./src/toml"
import javascript from "./src/javascript"

const BenchTable = require("benchtable")
const ist = require("ist")
const fs = require("fs")

let suite = new BenchTable('legacyMode', { isTransposed: false })

suite.addFunction("legacyMode", (mode, inp) => EditorState.create({doc: inp, plugins: [legacyMode(mode)]}))

suite.addInput("toml", [toml(), `# This is a TOML document. Boom.

title = "TOML Example"

[owner]
name = "Tom Preston-Werner"
organization = "GitHub"
bio = "GitHub Cofounder & CEO\\nLikes tater tots and beer."
dob = 1979-05-27T07:32:00Z # First class dates? Why not?

[database]
server = "192.168.1.1"
ports = [ 8001, 8001, 8002 ]
connection_max = 5000
enabled = true

[servers]

  # You can indent as you please. Tabs or spaces. TOML don't care.
  [servers.alpha]
  ip = "10.0.0.1"
  dc = "eqdc10"
  
  [servers.beta]
  ip = "10.0.0.2"
  dc = "eqdc10"
  
[clients]
data = [ ["gamma", "delta"], [1, 2] ]

# Line breaks are OK when inside arrays
hosts = [
  "alpha",
  "omega"
]
`.repeat(1000)])

suite.addInput("ts", [javascript({}, {typescript: true}), fs.readFileSync(__dirname + "/../doc/src/text.ts", "utf8")])

suite
.on('cycle', function (event) {
  console.log(event.target.toString());
})
.on('error', function (event) {
  throw event.target.error;
})
.on('complete', function () {
  console.log(suite.table.toString());
})
.run()
