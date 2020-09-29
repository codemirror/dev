import {CompletionSource} from "./completion"
import {Facet, combineConfig} from "@codemirror/next/state"

export interface CompletionConfig {
  /// When enabled (defaults to true), autocompletion will start
  /// whenever the user types something that can be completed.
  activateOnTyping?: boolean
  /// Override the completion sources used.
  override?: readonly CompletionSource[] | null,
  maxRenderedOptions?: number
}

export const completionConfig = Facet.define<CompletionConfig, Required<CompletionConfig>>({
  combine(configs) {
    return combineConfig(configs, {
      activateOnTyping: true,
      override: null,
      maxRenderedOptions: 100
    })
  }
})
