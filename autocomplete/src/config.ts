import {CompletionSource} from "./completion"
import {Facet, combineConfig} from "@codemirror/next/state"

export interface CompletionConfig {
  /// When enabled (defaults to true), autocompletion will start
  /// whenever the user types something that can be completed.
  activateOnTyping?: boolean
  /// Override the completion sources used.
  override?: readonly CompletionSource[] | null,
  /// The maximum number of options to render to the DOM.
  maxRenderedOptions?: number,
  /// Set this to false to disable the [default completion
  /// keymap](#autocomplete.completionKeymap). (This requires you to
  /// add bindings to control completion yourself. The bindings should
  /// probably have a higher precedence than other bindings for the
  /// same keys.)
  defaultKeymap?: boolean
}

export const completionConfig = Facet.define<CompletionConfig, Required<CompletionConfig>>({
  combine(configs) {
    return combineConfig(configs, {
      activateOnTyping: true,
      override: null,
      maxRenderedOptions: 100,
      defaultKeymap: true
    }, {
      defaultKeymap: (a, b) => a && b
    })
  }
})
