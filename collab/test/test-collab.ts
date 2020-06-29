import {EditorState, Transaction, StateField, StateEffect, Extension, ChangeDesc} from "@codemirror/next/state"
import {history, undo, redo, isolateHistory} from "@codemirror/next/history"
import ist from "ist"
import {collab, receiveUpdates, sendableUpdates, Update, getClientID, getSyncedVersion} from "@codemirror/next/collab"

class DummyServer {
  states: EditorState[] = []
  updates: Update[] = []
  clientIDs: string[] = []
  delayed: number[] = []

  constructor(doc: string = "", config: {n?: number, extensions?: Extension[], collabConf?: any} = {}) {
    let {n = 2, extensions = [], collabConf = {}} = config
    for (let i = 0; i < n; i++)
      this.states.push(EditorState.create({doc, extensions: [history(), collab(collabConf), ...extensions]}))
  }

  sync(n: number) {
    let state = this.states[n], version = getSyncedVersion(state)
    if (version != this.updates.length) {
      let count = 0
      for (let i = version; i < this.clientIDs.length; i++) {
        if (this.clientIDs[i] == getClientID(this.states[n])) count++
        else break
      }
      this.states[n] = receiveUpdates(state, this.updates.slice(version), count).state
    }
  }

  send(n: number) {
    let state = this.states[n], sendable = sendableUpdates(state)
    if (sendable.length) {
      this.updates = this.updates.concat(sendable)
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
    this.states[n] = f(this.states[n]).state
    this.broadcast(n)
  }

  type(n: number, text: string, pos: number = this.states[n].selection.primary.head) {
    this.update(n, s => s.update({changes: {from: pos, insert: text}, selection: {anchor: pos + text.length}}))
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
    let s = new DummyServer(undefined, {n: 3})
    s.type(0, "A")
    s.type(1, "U")
    s.type(2, "X")
    s.type(0, "B")
    s.type(1, "V")
    s.type(2, "Y")
    s.conv("XYUVAB")
  })

  it("converges with three peers with multiple steps", () => {
    let s = new DummyServer(undefined, {n: 3})
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
    s.update(0, s => s.update({selection: {anchor: 5}}))
    s.update(1, s => s.update({selection: {anchor: 9}}))
    s.type(0, "!")
    s.type(1, "!")
    s.update(0, s => s.update({annotations: isolateHistory.of("full")}))
    s.delay(0, () => {
      s.type(0, " ...")
      s.type(1, " ,,,")
    })
    s.update(0, s => s.update({annotations: isolateHistory.of("full")}))
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
      s.update(1, s => s.update({changes: {from: 1, to: 4}}))
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
      s.update(0, s => s.update({changes: {from: 2, to: 3}}))
      s.type(0, "x")
      s.update(1, s => s.update({changes: {from: 1, to: 4}}))
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

  it("allows you to set your client id", () => {
    ist(getClientID(EditorState.create({extensions: [collab({clientID: "my id"})]})), "my id")
  })

  it("client ids survive reconfiguration", () => {
    let ext = collab()
    let state = EditorState.create({extensions: [ext]})
    let state2 = state.update({reconfigure: {full: ext}}).state
    ist(getClientID(state), getClientID(state2))
  })

  it("associates transaction info with local changes", () => {
    let state = EditorState.create({extensions: [collab()]})
    let tr = state.update({changes: {from: 0, insert: "hi"}})
    ist(sendableUpdates(tr.state)[0].origin, tr)
  })

  it("supports shared effects", () => {
    class Mark {
      constructor(readonly from: number,
                  readonly to: number,
                  readonly id: string) {}

      map(mapping: ChangeDesc) {
        let from = mapping.mapPos(this.from, 1), to = mapping.mapPos(this.to, -1)
        return from >= to ? undefined : new Mark(from, to, this.id)
      }

      toString() { return `${this.from}-${this.to}=${this.id}` }
    }
    let addMark = StateEffect.define<Mark>({map: (v, m) => v.map(m)})
    let marks = StateField.define<Mark[]>({
      create: () => [],
      update(value, tr) {
        value = value.map(m => m.map(tr.changes)).filter(x => x) as any
        for (let effect of tr.effects) if (effect.is(addMark)) value = value.concat(effect.value)
        return value.sort((a, b) => a.id < b.id ? -1 : 1)
      }
    })

    let s = new DummyServer("hello", {
      extensions: [marks],
      collabConf: {sharedEffects(tr: Transaction) { return tr.effects.filter(e => e.is(addMark)) }}
    })
    s.delay(0, () => {
      s.delay(1, () => {
        s.update(0, s => s.update({effects: addMark.of(new Mark(1, 3, "a"))}))
        s.update(1, s => s.update({effects: addMark.of(new Mark(3, 5, "b"))}))
        s.type(0, "A", 4)
        s.type(1, "B", 0)
        ist(s.states[0].field(marks).join(), "1-3=a")
        ist(s.states[1].field(marks).join(), "4-6=b")
      })
    })
    s.conv("BhellAo")
    ist(s.states[0].field(marks).join(), "2-4=a,4-7=b")
    ist(s.states[1].field(marks).join(), "2-4=a,4-7=b")
  })
})
