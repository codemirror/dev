import {EditorState} from "../state/src"
import {legacyMode} from "./src/old"
import {legacyMode as legacyMode2} from "./src/"
import toml from "./src/toml"
import javascript from "./src/javascript"

const BenchTable = require("benchtable")
const fs = require("fs")

let suite = new BenchTable('legacyMode', { isTransposed: true })

const tomlDocument = `# This is a TOML document. Boom.

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
]`.repeat(1000)

const tsDocument = fs.readFileSync(__dirname + "/../doc/src/text.ts", "utf8")

suite.addFunction("base", f => f(legacyMode))
suite.addFunction("adv", f => f(legacyMode2))

const create = (mode, inp) => EditorState.create({doc: inp, plugins: [mode]})
suite.addInput("create toml", [impl => create(impl(toml()), tomlDocument)])
suite.addInput("create ts", [impl => create(impl(javascript({}, {typescript: true})), tsDocument)])

const renderOnce = (mode, inp) => {
  const editorView = {state: create(mode, inp), viewport: {from: 0, to: inp.length}}
  const view = mode.view(editorView)
  if (view.updateState) view.updateState(editorView)
  view.decorations
  return {view, editorView}
}
suite.addInput("render once toml", [impl => renderOnce(impl(toml()), tomlDocument)])
suite.addInput("render once ts", [impl => renderOnce(impl(javascript({}, {typescript: true})), tsDocument)])

const renderTwice = (mode, inp) => {
  const {view} = renderOnce(mode, inp)
  view.decorations
}
suite.addInput("render twice toml", [impl => renderTwice(impl(toml()), tomlDocument)])
suite.addInput("render twice ts", [impl => renderTwice(impl(javascript({}, {typescript: true})), tsDocument)])

const someEdits = (mode, inp) => {
  let {view, editorView} = renderOnce(mode, inp)
  editorView.state = editorView.state.transaction.replace(0, 5, "something\n").apply()
  editorView.viewport.to = editorView.state.doc.length
  if (view.updateState) view.updateState(editorView)
  view.decorations
  editorView.state = editorView.state.transaction.replace(editorView.state.doc.length - 10, editorView.state.doc.length - 5, "somethingelse\n").apply()
  editorView.viewport.to = editorView.state.doc.length
  if (view.updateState) view.updateState(editorView)
  view.decorations
}
suite.addInput("some edits toml", [impl => someEdits(impl(toml()), tomlDocument)])
suite.addInput("some edits ts", [impl => someEdits(impl(javascript({}, {typescript: true})), tsDocument)])

const lotsOfEdits = (mode, inp) => {
  let {view, editorView} = renderOnce(mode, inp)
  for (let i = 0; i < 13; ++i) {
    const at = Math.min((i*99971) % editorView.state.doc.length, editorView.state.doc.length - 5)
    editorView.state = editorView.state.transaction.replace(at, at + 5, "something").apply()
    editorView.viewport.to = editorView.state.doc.length
    if (view.updateState) view.updateState(editorView)
    view.decorations
  }
}
suite.addInput("lotsOfEdits toml", [impl => lotsOfEdits(impl(toml()), tomlDocument)])
suite.addInput("lotsOfEdits ts", [impl => lotsOfEdits(impl(javascript({}, {typescript: true})), tsDocument)])

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
