import {Text} from "../../doc/src/text"
import {EditorSelection} from "./selection"
import {Plugin, StateField} from "./plugin"
import {Transaction, MetaSlot} from "./transaction"

class Configuration {
  constructor(
    readonly plugins: ReadonlyArray<Plugin>,
    readonly fields: ReadonlyArray<StateField<any>>,
    readonly tabSize: number,
    readonly lineSeparator: string | null) {}

  static create(config: EditorStateConfig): Configuration {
    let plugins = config.plugins || [], fields = []
    for (let plugin of plugins) {
      let field = plugin.stateField
      if (!field) continue
      if (fields.indexOf(field) > -1)
        throw new Error(`A state field (${field.key}) can only be added to a state once`)
      fields.push(field)
    }
    return new Configuration(plugins, fields, config.tabSize || 4, config.lineSeparator || null)
  }

  updateTabSize(tabSize: number) {
    return new Configuration(this.plugins, this.fields, tabSize, this.lineSeparator)
  }

  updateLineSeparator(lineSep: string | null) {
    return new Configuration(this.plugins, this.fields, this.tabSize, lineSep)
  }
}

export interface EditorStateConfig {
  doc?: string | Text
  selection?: EditorSelection
  plugins?: ReadonlyArray<Plugin>
  tabSize?: number
  lineSeparator?: string | null
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
    let tabSize = tr.getMeta(MetaSlot.changeTabSize), lineSep = tr.getMeta(MetaSlot.changeLineSeparator)
    if (tabSize !== undefined) $conf = $conf.updateTabSize(tabSize)
    if (lineSep !== undefined) $conf = $conf.updateLineSeparator(lineSep)
    let newState = new EditorState($conf, tr.doc, tr.selection)
    for (let field of $conf.fields)
      (newState as any)[field.key] = field.apply(tr, (this as any)[field.key], newState)
    return newState
  }

  get transaction(): Transaction {
    return Transaction.start(this)
  }

  get tabSize(): number { return this.config.tabSize }

  get lineSeparator(): string { return this.config.lineSeparator || "\n" }

  // FIXME move somewhere else?
  splitLines(text: string): string[] { return splitLines(this.config, text) }

  static create(config: EditorStateConfig = {}): EditorState {
    let $config = Configuration.create(config)
    let doc = config.doc instanceof Text ? config.doc : Text.of(splitLines($config, config.doc || ""))
    let state = new EditorState($config, doc, config.selection || EditorSelection.default)
    for (let field of $config.fields) (state as any)[field.key] = field.init(state)
    return state
  }
}

function splitLines(config: Configuration, text: string): string[] {
  return text.split(config.lineSeparator || DEFAULT_SPLIT)
}

const DEFAULT_SPLIT = /\r\n?|\n/
