import {EditorState, Change, Transaction, StateField, Extension} from "@codemirror/next/state"
import {history, undo, redo, isolateHistory} from "@codemirror/next/history"
import ist from "ist"
import {collab, receiveChanges, sendableChanges, getClientID, getSyncedVersion} from "@codemirror/next/collab"

class DummyServer {
  states: EditorState[] = []
  changes: Change[] = []
  clientIDs: string[] = []
  delayed: number[] = []

  constructor(doc: string = "", n = 2, extensions: Extension[] = []) {
    for (let i = 0; i < n; i++)
      this.states.push(EditorState.create({doc, extensions: [history(), collab(), ...extensions]}))
  }

  sync(n: number) {
    let state = this.states[n], version = getSyncedVersion(state)
    if (version != this.changes.length)
      this.states[n] = receiveChanges(state, this.changes.slice(version), this.clientIDs.slice(version)).apply()
  }

  send(n: number) {
    let state = this.states[n], sendable = sendableChanges(state)
    if (sendable.length) {
      this.changes = this.changes.concat(sendable.map(s => s.change))
      for (let i = 0; i < sendable.length; i++) this.clientIDs.push(getClientID(state))
    }
  }

  broadcast(n: number) {
    if (this.delayed.indexOf(n) > -1) return
    this.sync(n)
    this.send(n)
    for (let i = 0; i < this.states.length; i++) if (i != n) this.sync(i)
  }

  update(n: number, f: (state: EditorState) => Transaction) {
    this.states[n] = f(this.states[n]).apply()
    this.broadcast(n)
  }

  type(n: number, text: string, pos: number = this.states[n].selection.primary.head) {
    this.update(n, s => s.t().setSelection(pos).replaceSelection(text))
  }

  undo(n: number) {
    undo({state: this.states[n], dispatch: tr => this.update(n, () => tr)})
  }

  redo(n: number) {
    redo({state: this.states[n], dispatch: tr => this.update(n, () => tr)})
  }

  conv(doc: string) {
    this.states.forEach(state => ist(state.doc.toString(), doc))
  }

  delay(n: number, f: () => void) {
    this.delayed.push(n)
    f()
    this.delayed.pop()
    this.broadcast(n)
  }
}

describe("collab", () => {
  it("converges for simple changes", () => {
    let s = new DummyServer
    s.type(0, "hi")
    s.type(1, "ok", 2)
    s.type(0, "!", 4)
    s.type(1, "...", 0)
    s.conv("...hiok!")
  })

  it("converges for multiple local changes", () => {
    let s = new DummyServer
    s.type(0, "hi")
    s.delay(0, () => {
      s.type(0, "A")
      s.type(1, "X", 2)
      s.type(0, "B")
      s.type(1, "Y")
    })
    s.conv("hiXYAB")
  })

  it("converges with three peers", () => {
    let s = new DummyServer(undefined, 3)
    s.type(0, "A")
    s.type(1, "U")
    s.type(2, "X")
    s.type(0, "B")
    s.type(1, "V")
    s.type(2, "Y")
    s.conv("XYUVAB")
  })

  it("converges with three peers with multiple steps", () => {
    let s = new DummyServer(undefined, 3)
    s.type(0, "A")
    s.delay(1, () => {
      s.type(1, "U")
      s.type(2, "X")
      s.type(0, "B")
      s.type(1, "V")
      s.type(2, "Y")
    })
    s.conv("XYUVAB")
  })

  it("supports undo", () => {
    let s = new DummyServer
    s.type(0, "A")
    s.type(1, "a")
    s.type(0, "B")
    s.undo(1)
    s.conv("AB")
    s.type(1, "b")
    s.type(0, "C")
    s.conv("bABC")
  })

  it("supports redo", () => {
    let s = new DummyServer
    s.type(0, "A")
    s.type(1, "a")
    s.type(0, "B")
    s.undo(1)
    s.redo(1)
    s.type(1, "b")
    s.type(0, "C")
    s.conv("abABC")
  })

  it("supports deep undo", () => {
    let s = new DummyServer("hello bye")
    s.update(0, s => s.t().setSelection(5))
    s.update(1, s => s.t().setSelection(9))
    s.type(0, "!")
    s.type(1, "!")
    s.update(0, s => s.t().annotate(isolateHistory, "full"))
    s.delay(0, () => {
      s.type(0, " ...")
      s.type(1, " ,,,")
    })
    s.update(0, s => s.t().annotate(isolateHistory, "full"))
    s.type(0, "*")
    s.type(1, "*")
    s.undo(0)
    s.conv("hello! ... bye! ,,,*")
    s.undo(0)
    s.undo(0)
    s.conv("hello bye! ,,,*")
    s.redo(0)
    s.redo(0)
    s.redo(0)
    s.conv("hello! ...* bye! ,,,*")
    s.undo(0)
    s.undo(0)
    s.conv("hello! bye! ,,,*")
    s.undo(1)
    s.conv("hello! bye")
  })

  it("support undo with clashing events", () => {
    let s = new DummyServer("okay!")
    s.type(0, "A", 5)
    s.delay(0, () => {
      s.type(0, "B", 3)
      s.type(0, "C", 4)
      s.type(0, "D", 0)
      s.update(1, s => s.t().replace(1, 4, ""))
    })
    s.conv("Do!A")
    s.undo(0)
    s.undo(0)
    s.conv("o!")
    ist(s.states[0].selection.primary.head, 0)
  })

  it("handles conflicting steps", () => {
    let s = new DummyServer("abcde")
    s.delay(0, () => {
      s.update(0, s => s.t().replace(2, 3, ""))
      s.type(0, "x")
      s.update(1, s => s.t().replace(1, 4, ""))
    })
    s.undo(0)
    s.undo(0)
    s.conv("ae")
  })

  it("can undo simultaneous typing", () => {
    let s = new DummyServer("A B")
    s.delay(0, () => {
      s.type(0, "1", 1)
      s.type(0, "2")
      s.type(1, "x", 3)
      s.type(1, "y")
    })
    s.conv("A12 Bxy")
    s.undo(0)
    s.conv("A Bxy")
    s.undo(1)
    s.conv("A B")
  })

  it("includes rebased changes when necessary", () => {
    let counter = StateField.define<number>({
      create() { return 0 },
      update(val, tr) { return val + tr.changes.length }
    })
    let s = new DummyServer("___ ___", 2, [counter])
    s.delay(0, () => {
      s.type(0, "a", 1)
      s.type(1, "b", 5)
    })
    ist(s.states[0].field(counter), 2)
    ist(s.states[1].field(counter), 2)
    s.delay(0, () => {
      s.type(0, "x", 3)
      s.type(1, "y", 3)
    })
    ist(s.states[0].field(counter), 6)
    ist(s.states[1].field(counter), 4)
    s.conv("_a_yx_ _b__")
  })

  it("allows you to set your client id", () => {
    ist(getClientID(EditorState.create({extensions: [collab({clientID: "my id"})]})), "my id")
  })

  it("client ids survive reconfiguration", () => {
    let ext = collab()
    let state = EditorState.create({extensions: [ext]})
    let state2 = state.t().reconfigure([ext]).apply()
    ist(getClientID(state), getClientID(state2))
  })

  it("associates transaction info with local changes", () => {
    let state = EditorState.create({extensions: [collab()]})
    let tr = state.t().replace(0, 0, "hi")
    ist(sendableChanges(tr.apply())[0].origin, tr)
  })
})
