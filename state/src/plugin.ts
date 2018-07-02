import {EditorState} from "./state"
import {Transaction} from "./transaction"

const fieldNames = Object.create(null)

export class StateField<T> {
  /** @internal */
  readonly key: string;
  readonly init: (state: EditorState) => T;
  readonly apply: (tr: Transaction, value: T, newState: EditorState) => T;

  constructor({init, apply, debugName = "field"}: {
    init: (state: EditorState) => T,
    apply: (tr: Transaction, value: T, newState: EditorState) => T,
    debugName?: string
  }) {
    this.init = init
    this.apply = apply
    this.key = unique("$" + debugName, fieldNames)
  }
}

export interface PluginSpec {
  state?: StateField<any>;
  config?: any;
  props?: any;
}

export class Plugin {
  readonly config: any;
  readonly stateField: StateField<any> | null;
  readonly props: any;

  constructor(spec: PluginSpec) {
    this.config = spec.config
    this.stateField = spec.state || null
    this.props = spec.props || {}
  }
}

export function unique(prefix: string, names: {[key: string]: string}): string {
  for (let i = 0;; i++) {
    let name = prefix + (i ? "_" + i : "")
    if (!(name in names)) return names[name] = name
  }
}
