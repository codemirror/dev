import {EditorState, Transaction} from "../../state/src/state"
import {DocViewDesc} from "./viewdesc"
import {DOMObserver} from "./domobserver"
import {attachEventHandlers} from "./input"

export class EditorView {
  private _state: EditorState;
  get state(): EditorState { return this._state }

  private _props: EditorProps;
  get props(): EditorProps { return this._props }

  public dispatch: (tr: Transaction) => void;

  public dom: Element;
  private contentElement: Element;

  // (Many of these things should be module-private)

  public docView: DocViewDesc;
  public domObserver: DOMObserver;

  constructor(state: EditorState, props: EditorProps = {}, dispatch: ((tr: Transaction) => void) | undefined = undefined) {
    this._state = state
    this._props = props
    this.dispatch = dispatch || (tr => this.setState(tr.apply()))

    this.contentElement = document.createElement("pre")
    this.contentElement.className = "CM-content"
    this.contentElement.setAttribute("contenteditable", "true")

    this.dom = document.createElement("div")
    this.dom.className = "CM"
    this.dom.appendChild(this.contentElement)

    this.domObserver = new DOMObserver(this)
    attachEventHandlers(this)
    
    this.docView = new DocViewDesc(state.doc, this.contentElement)
    this.domObserver.start()
  }

  setState(state: EditorState) {
    let prev = this.state
    this._state = state
    if (state.doc != prev.doc || this.docView.dirtyRanges.length) {
      this.domObserver.stop()
      this.docView.update(state.doc)
      this.domObserver.start()
    }
  }
}

interface EditorProps {
  readonly handleDOMEvents?: {[key: string]: (view: EditorView, event: Event) => boolean};
}
