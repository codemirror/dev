import {Text} from "../../doc/src/text"
import {EditorSelection} from "./selection"
import {Plugin, StateField} from "./plugin"
import {Transaction} from "./transaction"

class Configuration {
  readonly fields: ReadonlyArray<StateField<any>>

  constructor(readonly plugins: ReadonlyArray<Plugin>) {
    let fields = []
    for (let plugin of plugins) {
      let field = plugin.stateField
      if (!field) continue
      if (fields.indexOf(field) > -1)
        throw new Error(`A state field (${field.key}) can only be added to a state once`)
      fields.push(field)
    }
    this.fields = fields
  }
}

export interface EditorStateConfig {
  doc?: string | Text
  selection?: EditorSelection
  plugins?: ReadonlyArray<Plugin>
}

export class EditorState {
  /** @internal */
  constructor(private readonly config: Configuration,
              readonly doc: Text,
              readonly selection: EditorSelection = EditorSelection.default) {}

  getField<T>(field: StateField<T>): T | undefined {
    return (this as any)[field.key]
  }

  get plugins(): ReadonlyArray<Plugin> { return this.config.plugins }

  getPluginWithField(field: StateField<any>): Plugin {
    for (const plugin of this.config.plugins) {
      if (plugin.stateField == field) return plugin
    }
    throw new Error("Plugin for field not configured")
  }

  /** @internal */
  applyTransaction(tr: Transaction): EditorState {
    let $conf = this.config
    let newState = new EditorState($conf, tr.doc, tr.selection)
    for (let field of $conf.fields)
      (newState as any)[field.key] = field.apply(tr, (this as any)[field.key], newState)
    return newState
  }

  get transaction(): Transaction {
    return Transaction.start(this)
  }

  static create(config: EditorStateConfig = {}): EditorState {
    let doc = config.doc instanceof Text ? config.doc : Text.create(config.doc || "")
    let $config = new Configuration(config.plugins || [])
    let state = new EditorState($config, doc, config.selection || EditorSelection.default)
    for (let field of $config.fields) (state as any)[field.key] = field.init(state)
    return state
  }
}
