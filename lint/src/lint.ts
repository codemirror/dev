import {EditorView, ViewPlugin, Decoration, DecorationSet,
        WidgetType, ViewUpdate, Command, themeClass, logException, KeyBinding} from "@codemirror/next/view"
import {StateEffect, StateField, Extension, TransactionSpec, EditorState} from "@codemirror/next/state"
import {hoverTooltip} from "@codemirror/next/tooltip"
import {panels, Panel, showPanel, getPanel} from "@codemirror/next/panel"
import elt from "crelt"

/// Describes a problem or hint for a piece of code.
export interface Diagnostic {
  /// The start position of the relevant text.
  from: number
  /// The end position. May be equal to `from`, though actually
  /// covering text is preferable.
  to: number
  /// The severity of the problem. This will influence how it is
  /// displayed.
  severity: "info" | "warning" | "error"
  /// An optional source string indicating where the diagnostic is
  /// coming from. You can put the name of your linter here, if
  /// applicable.
  source?: string
  /// The message associated with this diagnostic.
  message: string
  /// An optional array of actions that can be taken on this
  /// diagnostic.
  actions?: readonly Action[]
}

/// An action associated with a diagnostic.
export interface Action {
  /// The label to show to the user. Should be relatively short.
  name: string
  /// The function to call when the user activates this action. Is
  /// given the diagnostic's _current_ position, which may have
  /// changed since the creation of the diagnostic due to editing.
  apply: (view: EditorView, from: number, to: number) => void
}

class SelectedDiagnostic {
  constructor(readonly from: number, readonly to: number, readonly diagnostic: Diagnostic) {}
}

class LintState {
  constructor(readonly diagnostics: DecorationSet,
              readonly panel: ((view: EditorView) => Panel) | null,
              readonly selected: SelectedDiagnostic | null) {}
}

function findDiagnostic(diagnostics: DecorationSet, diagnostic: Diagnostic | null = null, after = 0): SelectedDiagnostic | null {
  let found: SelectedDiagnostic | null = null
  diagnostics.between(after, diagnostics.length, (from, to, {spec}) => {
    if (diagnostic && spec.diagnostic != diagnostic) return
    found = new SelectedDiagnostic(from, to, spec.diagnostic)
    return false
  })
  return found
}

function maybeEnableLint(state: EditorState) {
  return state.field(lintState, false) ? undefined : {append: [
    lintState,
    EditorView.decorations.compute([lintState], state => {
      let {selected, panel} = state.field(lintState)
      return !selected || !panel || selected.from == selected.to ? Decoration.none : Decoration.set([
        activeMark.range(selected.from, selected.to)
      ])
    }),
    panels(),
    hoverTooltip(lintTooltip),
    baseTheme
  ]}
}

/// State effect that is used to update the current set of
/// diagnostics.
export function setDiagnostics(state: EditorState, diagnostics: readonly Diagnostic[]): TransactionSpec {
  return {
    effects: setDiagnosticsEffect.of(diagnostics),
    reconfigure: maybeEnableLint(state)
  }
}

const setDiagnosticsEffect = StateEffect.define<readonly Diagnostic[]>()

const togglePanel = StateEffect.define<boolean>()

const movePanelSelection = StateEffect.define<SelectedDiagnostic>()

const lintState = StateField.define<LintState>({
  create() {
    return new LintState(Decoration.none, null, null)
  },
  update(value, tr) {
    if (tr.docChanged) {
      let mapped = value.diagnostics.map(tr.changes), selected = null
      if (value.selected) {
        let selPos = tr.changes.mapPos(value.selected.from, 1)
        selected = findDiagnostic(mapped, value.selected.diagnostic, selPos) || findDiagnostic(mapped, null, selPos)
      }
      value = new LintState(mapped, value.panel, selected)
    }

    for (let effect of tr.effects) {
      if (effect.is(setDiagnosticsEffect)) {
        let ranges = Decoration.set(effect.value.map((d: Diagnostic) => {
          return d.from < d.to
            ? Decoration.mark({
              attributes: {class: themeClass("lintRange." + d.severity)},
              diagnostic: d
            }).range(d.from, d.to)
          : Decoration.widget({
            widget: new DiagnosticWidget(d),
            diagnostic: d
          }).range(d.from)
        }))
        value = new LintState(ranges, value.panel, findDiagnostic(ranges))
      } else if (effect.is(togglePanel)) {
        value = new LintState(value.diagnostics, effect.value ? LintPanel.open : null, value.selected)
      } else if (effect.is(movePanelSelection)) {
        value = new LintState(value.diagnostics, value.panel, effect.value)
      }
    }

    return value
  },
  provide: [showPanel.nFrom(s => s.panel ? [s.panel] : []),
            EditorView.decorations.from(s => s.diagnostics)]
})

const activeMark = Decoration.mark({class: themeClass("lintRange.active")})

function lintTooltip(view: EditorView, pos: number, side: -1 | 1) {
  let {diagnostics} = view.state.field(lintState)
  let found: Diagnostic[] = [], stackStart = 2e8, stackEnd = 0
  diagnostics.between(pos - (side < 0 ? 1 : 0), pos + (side > 0 ? 1 : 0), (from, to, {spec}) => {
    if (pos >= from && pos <= to &&
        (from == to || ((pos > from || side > 0) && (pos < to || side < 0)))) {
      found.push(spec.diagnostic)
      stackStart = Math.min(from, stackStart)
      stackEnd = Math.max(to, stackEnd)
    }
  })
  if (!found.length) return null

  return {
    pos: stackStart,
    end: stackEnd,
    above: view.state.doc.lineAt(stackStart).to < stackEnd,
    style: "lint",
    create() {
      return {dom: elt("ul", found.map(d => renderDiagnostic(view, d, false)))}
    }
  }
}

/// Command to open and focus the lint panel.
export const openLintPanel: Command = (view: EditorView) => {
  let field = view.state.field(lintState, false)
  if (!field || !field.panel)
    view.dispatch({effects: togglePanel.of(true),
                   reconfigure: maybeEnableLint(view.state)})
  let panel = getPanel(view, LintPanel.open)
  if (panel) (panel.dom.querySelector(".cm-panel-lint ul") as HTMLElement).focus()
  return true
}

/// Command to close the lint panel, when open.
export const closeLintPanel: Command = (view: EditorView) => {
  let field = view.state.field(lintState, false)
  if (!field || !field.panel) return false
  view.dispatch({effects: togglePanel.of(false)})
  return true
}

/// Move the selection to the next diagnostic.
export const nextDiagnostic: Command = (view: EditorView) => {
  let field = view.state.field(lintState, false)
  if (!field) return false
  let sel = view.state.selection.primary, next = field.diagnostics.iter(sel.to + 1)
  if (!next.value) {
    next = field.diagnostics.iter(0)
    if (!next.value || next.from == sel.from && next.to == sel.to) return false
  }
  view.dispatch({selection: {anchor: next.from, head: next.to}, scrollIntoView: true})
  return true
}

/// A set of default key bindings for the lint functionality.
///
/// - Ctrl-Shift-m (Cmd-Shift-m on macOS): [`openLintPanel`](#lint.openLintPanel)
/// - F8: [\`nextDiagnostic\`](#lint.nextDiagnostic)
export const lintKeymap: readonly KeyBinding[] = [
  {key: "Mod-Shift-m", run: openLintPanel},
  {key: "F8", run: nextDiagnostic}
]

const LintDelay = 500

/// Given a diagnostic source, this function returns an extension that
/// enables linting with that source. It will be called whenever the
/// editor is idle (after its content changed).
export function linter(source: (view: EditorView) => readonly Diagnostic[] | Promise<readonly Diagnostic[]>): Extension {
  return ViewPlugin.fromClass(class {
    lintTime = Date.now() + LintDelay
    set = true

    constructor(readonly view: EditorView) {
      this.run = this.run.bind(this)
      setTimeout(this.run, LintDelay)
    }

    run() {
      let now = Date.now()
      if (now < this.lintTime - 10) {
        setTimeout(this.run, this.lintTime - now)
      } else {
        this.set = false
        let {state} = this.view
        Promise.resolve(source(this.view)).then(
          annotations => {
            if (this.view.state.doc == state.doc &&
                (annotations.length || this.view.state.field(lintState, false)?.diagnostics?.size))
              this.view.dispatch(setDiagnostics(this.view.state, annotations))
          },
          error => { logException(this.view.state, error) }
        )
      }
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.lintTime = Date.now() + LintDelay
        if (!this.set) {
          this.set = true
          setTimeout(this.run, LintDelay)
        }
      }
    }
  })
}

function assignKeys(actions: readonly Action[] | undefined) {
  let assigned: string[] = []
  if (actions) actions: for (let {name} of actions) {
    for (let i = 0; i < name.length; i++) {
      let ch = name[i]
      if (/[a-zA-Z]/.test(ch) && !assigned.some(c => c.toLowerCase() == ch.toLowerCase())) {
        assigned.push(ch)
        continue actions
      }
    }
    assigned.push("")
  }
  return assigned
}

function renderDiagnostic(view: EditorView, diagnostic: Diagnostic, inPanel: boolean) {
  let keys = inPanel ? assignKeys(diagnostic.actions) : []
  return elt(
    "li", {class: themeClass("diagnostic." + diagnostic.severity)},
    elt("span", {class: themeClass("diagnosticText")}, diagnostic.message),
    diagnostic.actions?.map((action, i) => {
      let click = (e: Event) => {
        e.preventDefault()
        let found = findDiagnostic(view.state.field(lintState).diagnostics, diagnostic)
        if (found) action.apply(view, found.from, found.to)
      }
      let {name} = action, keyIndex = keys[i] ? name.indexOf(keys[i]) : -1
      let nameElt = keyIndex < 0 ? name : [name.slice(0, keyIndex),
                                           elt("u", name.slice(keyIndex, keyIndex + 1)),
                                           name.slice(keyIndex + 1)]
      return elt("button", {
        class: themeClass("diagnosticAction"),
        onclick: click,
        onmousedown: click
      }, nameElt)
    }),
    diagnostic.source && elt("div", {class: themeClass("diagnosticSource")}, diagnostic.source))
}

class DiagnosticWidget extends WidgetType {
  constructor(readonly diagnostic: Diagnostic) {super()}

  eq(other: DiagnosticWidget) { return other.diagnostic == this.diagnostic }

  toDOM() {
    return elt("span", {class: themeClass("lintPoint." + this.diagnostic.severity)})
  }
}

class PanelItem {
  id = "item_" + Math.floor(Math.random() * 0xffffffff).toString(16)
  dom: HTMLElement

  constructor(view: EditorView, readonly diagnostic: Diagnostic) {
    this.dom = renderDiagnostic(view, diagnostic, true)
    this.dom.setAttribute("role", "option")
  }
}

class LintPanel implements Panel {
  items: PanelItem[] = []
  dom: HTMLElement
  list: HTMLElement

  constructor(readonly view: EditorView) {
    let onkeydown = (event: KeyboardEvent) => {
      if (event.keyCode == 27) { // Escape
        closeLintPanel(this.view)
        this.view.focus()
      } else if (event.keyCode == 38 || event.keyCode == 33) { // ArrowUp, PageUp
        this.moveSelection((this.selectedIndex - 1 + this.items.length) % this.items.length)
      } else if (event.keyCode == 40 || event.keyCode == 34) { // ArrowDown, PageDown
        this.moveSelection((this.selectedIndex + 1) % this.items.length)
      } else if (event.keyCode == 36) { // Home
        this.moveSelection(0)
      } else if (event.keyCode == 35) { // End
        this.moveSelection(this.items.length - 1)
      } else if (event.keyCode == 13) { // Enter
        this.view.focus()
      } else if (event.keyCode >= 65 && event.keyCode <= 90 && this.items.length) { // A-Z
        let {diagnostic} = this.items[this.selectedIndex], keys = assignKeys(diagnostic.actions)
        for (let i = 0; i < keys.length; i++) if (keys[i].toUpperCase().charCodeAt(0) == event.keyCode) {
          let found = findDiagnostic(this.view.state.field(lintState).diagnostics, diagnostic)
          if (found) diagnostic.actions![i].apply(view, found.from, found.to)
        }
      } else {
        return
      }
      event.preventDefault()
    }
    let onclick = (event: MouseEvent) => {
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].dom.contains(event.target as HTMLElement))
          this.moveSelection(i)
      }
    }

    this.list = elt("ul", {
      tabIndex: 0,
      role: "listbox",
      "aria-label": this.view.state.phrase("Diagnostics"),
      onkeydown,
      onclick
    })
    this.dom = elt("div", this.list, elt("button", {
      name: "close",
      "aria-label": this.view.state.phrase("close"),
      onclick: () => closeLintPanel(this.view)
    }, "×"))
    this.update()
  }

  get selectedIndex() {
    let selected = this.view.state.field(lintState).selected
    if (!selected) return -1
    for (let i = 0; i < this.items.length; i++) if (this.items[i].diagnostic == selected.diagnostic) return i
    return -1
  }

  update() {
    let {diagnostics, selected} = this.view.state.field(lintState)
    let i = 0, needsSync = false, newSelectedItem: PanelItem | null = null
    diagnostics.between(0, this.view.state.doc.length, (_start, _end, {spec}) => {
      let found = -1, item
      for (let j = i; j < this.items.length; j++)
        if (this.items[j].diagnostic == spec.diagnostic) { found = j; break }
      if (found < 0) {
        item = new PanelItem(this.view, spec.diagnostic)
        this.items.splice(i, 0, item)
        needsSync = true
      } else {
        item = this.items[found]
        if (found > i) { this.items.splice(i, found - i); needsSync = true }
      }
      if (selected && item.diagnostic == selected.diagnostic) {
        if (!item.dom.hasAttribute("aria-selected")) {
          item.dom.setAttribute("aria-selected", "true")
          newSelectedItem = item
        }
      } else if (item.dom.hasAttribute("aria-selected")) {
        item.dom.removeAttribute("aria-selected")
      }
      i++
    })
    while (i < this.items.length && !(this.items.length == 1 && this.items[0].diagnostic.from < 0)) {
      needsSync = true
      this.items.pop()
    }
    if (this.items.length == 0) {
      this.items.push(new PanelItem(this.view, {
        from: -1, to: -1,
        severity: "info",
        message: this.view.state.phrase("No diagnostics")
      }))
      needsSync = true
    }
    if (newSelectedItem) {
      this.list.setAttribute("aria-activedescendant", newSelectedItem!.id)
      this.view.requestMeasure({
        key: this,
        read: () => ({sel: newSelectedItem!.dom.getBoundingClientRect(), panel: this.list.getBoundingClientRect()}),
        write: ({sel, panel}) => {
          if (sel.top < panel.top) this.list.scrollTop -= panel.top - sel.top
          else if (sel.bottom > panel.bottom) this.list.scrollTop += sel.bottom - panel.bottom
        }
      })
    } else if (!this.items.length) {
      this.list.removeAttribute("aria-activedescendant")
    }
    if (needsSync) this.sync()
  }

  sync() {
    let domPos: ChildNode | null = this.list.firstChild
    function rm() {
      let prev = domPos!
      domPos = prev.nextSibling
      prev.remove()
    }

    for (let item of this.items) {
      if (item.dom.parentNode == this.list) {
        while (domPos != item.dom) rm()
        domPos = item.dom.nextSibling
      } else {
        this.list.insertBefore(item.dom, domPos)
      }
    }
    while (domPos) rm()
    if (!this.list.firstChild) this.list.appendChild(renderDiagnostic(this.view, {
      severity: "info",
      message: this.view.state.phrase("No diagnostics")
    } as Diagnostic, true))
  }

  moveSelection(selectedIndex: number) {
    if (this.items.length == 0) return
    let field = this.view.state.field(lintState)
    let selection = findDiagnostic(field.diagnostics, this.items[selectedIndex].diagnostic)
    if (!selection) return
    this.view.dispatch({
      selection: {anchor: selection.from, head: selection.to},
      scrollIntoView: true,
      effects: movePanelSelection.of(selection)
    })
  }

  get style() { return "lint" }

  static open(view: EditorView) { return new LintPanel(view) }
}

function underline(color: string) {
  if (typeof btoa != "function") return "none"
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3">
    <path d="m0 3 l2 -2 l1 0 l2 2 l1 0" stroke="${color}" fill="none" stroke-width=".7"/>
  </svg>`
  return `url('data:image/svg+xml;base64,${btoa(svg)}')`
}

const baseTheme = EditorView.baseTheme({
  $diagnostic: {
    padding: "3px 6px 3px 8px",
    marginLeft: "-1px",
    display: "block"
  },
  "$diagnostic.error": { borderLeft: "5px solid #d11" },
  "$diagnostic.warning": { borderLeft: "5px solid orange" },
  "$diagnostic.info": { borderLeft: "5px solid #999" },

  $diagnosticAction: {
    font: "inherit",
    border: "none",
    padding: "2px 4px",
    backgroundColor: "#444",
    color: "white",
    borderRadius: "3px",
    marginLeft: "8px"
  },

  $diagnosticSource: {
    fontSize: "70%",
    opacity: .7
  },

  $lintRange: {
    backgroundPosition: "left bottom",
    backgroundRepeat: "repeat-x"
  },

  "$lintRange.error": { backgroundImage: underline("#d11") },
  "$lintRange.warning": { backgroundImage: underline("orange") },
  "$lintRange.info": { backgroundImage: underline("#999") },
  "$lintRange.active": { backgroundColor: "#ffdd9980" },

  $lintPoint: {
    position: "relative",

    "&:after": {
      content: '""',
      position: "absolute",
      bottom: 0,
      left: "-2px",
      borderLeft: "3px solid transparent",
      borderRight: "3px solid transparent",
      borderBottom: "4px solid #d11"
    }
  },

  "$lintPoint.warning": {
    "&:after": { borderBottomColor: "orange" }
  },
  "$lintPoint.info": {
    "&:after": { borderBottomColor: "#999" }
  },

  "$panel.lint": {
    position: "relative",
    "& ul": {
      maxHeight: "100px",
      overflowY: "auto",
      "& [aria-selected]": {
        backgroundColor: "#ddd",
        "& u": { textDecoration: "underline" }
      },
      "&:focus [aria-selected]": {
        background_fallback: "#bdf",
        backgroundColor: "Highlight",
        color_fallback: "white",
        color: "HighlightText"
      },
      "& u": { textDecoration: "none" },
      padding: 0,
      margin: 0
    },
    "& [name=close]": {
      position: "absolute",
      top: "0",
      right: "2px",
      background: "inherit",
      border: "none",
      font: "inherit",
      padding: 0,
      margin: 0
    }
  },

  "$tooltip.lint": {
    padding: 0,
    margin: 0
  }
})
