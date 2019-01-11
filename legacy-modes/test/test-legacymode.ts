import {EditorState, Transaction} from "../../state/src"
import {RangeDecoration} from "../../view/src/decoration"
import {Range} from "../../rangeset/src/rangeset"

import {Mode} from "../src/util"
import {legacyMode} from "../src/"

const ist = require("ist")

type Viewport = {from: number, to: number}

function getModeTest(doc: string, onDecorationUpdate = () => {}) {
  const calls: number[] = []
  const mode: Mode<{pos: number}> = {
    name: "testmode",
    startState() {
      return {pos: 0}
    },
    token(stream, state) {
      stream.next()
      calls.push(state.pos)
      return String(++state.pos)
    }
  }
  const plugin = legacyMode(mode, {sleepTime: 0})
  const view: {state: EditorState, viewport?: Viewport, updateState: () => void} = {
    state: EditorState.create({doc, plugins: [plugin]}),
    updateState: onDecorationUpdate
  }
  const viewPlugin = plugin.view(view)

  return {
    calls,
    getDecorations(vp: Viewport) {
      view.viewport = vp
      viewPlugin.update(view, {transactions: []})
      const decorations: Range<RangeDecoration>[] = []
      viewPlugin.decorations.collect(decorations)
      return decorations
    },
    get transaction() {
      return view.state.transaction
    },
    apply(transaction: Transaction, {from, to}: Viewport) {
      view.state = transaction.apply()
      view.viewport = {from, to}
      viewPlugin.update(view, {transactions: [transaction]})
    }
  }
}

describe("legacyMode", () => {
  it("decorates only once", () => {
    const modeTest = getModeTest("ab")
    const decorations = modeTest.getDecorations({from: 0, to: 2})

    ist(decorations.length, 2)
    ist(decorations[0].from, 0)
    ist(decorations[0].to, 1)
    ist(decorations[0].value.spec.class, "cm-1")
    ist(decorations[1].from, 1)
    ist(decorations[1].to, 2)
    ist(decorations[1].value.spec.class, "cm-2")

    modeTest.getDecorations({from: 1, to: 2})
    modeTest.getDecorations({from: 0, to: 1})
    ist(modeTest.calls.length, 2)
    ist(modeTest.calls[0], 0)
    ist(modeTest.calls[1], 1)
  })
  it("keeps decorations in lines before a change", () => {
    const modeTest = getModeTest("a\nb")
    const decorations = modeTest.getDecorations({from: 0, to: 3})

    ist(decorations.length, 2)
    ist(modeTest.calls.length, 2)
    modeTest.apply(modeTest.transaction.replace(2, 2, "--"), {from: 0, to: 1})
    ist(modeTest.calls.length, 2)
  })
  it("re-uses previously-rendered decorations", () => {
    const modeTest = getModeTest((new Array(26)).fill("").map((_: string, i: number) => String.fromCharCode(97 + i) + "\n").join(""))
    const decorations = modeTest.getDecorations({from: 0, to: 10*2})

    ist(decorations.length, 10)
    ist(modeTest.calls.length, 10)
    modeTest.getDecorations({from: 8*2, to: 20*2})
    ist(modeTest.calls.length, 20)
    modeTest.getDecorations({from: 0, to: 10*2})
    ist(modeTest.calls.length, 28)
  })
  it("updates frontier in the background", async function() {
    let afterFrontierUpdating: () => void
    const modeTest = getModeTest("abcdefghi\n".repeat(2500), () => afterFrontierUpdating())
    ist(modeTest.getDecorations({from: 0, to: 10}).length, 9)
    ist(modeTest.calls.length, 9)
    ist(modeTest.getDecorations({from: 24000, to: 24010}).length, 9)
    ist(modeTest.calls.length, 9 + 9)
    return new Promise(resolve => {
      afterFrontierUpdating = () => {
        ist(modeTest.calls.length, (10 // Render (0, 10)
                                  + 10 // Optimistic render (24000, 24010)
                                  + (10010 - 0) + (20010 - 10010) + (24000 - 20000) // Background frontier updating
                                  + (24000 - 23990) + 10 // getState + second render (24000, 24010)
                                   ) * 0.9)
        resolve()
      }
    })
  })
})
