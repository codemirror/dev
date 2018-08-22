import {StringStream} from "./stringstream"

declare interface Mode<S> {
  token(stream: StringStream, state: S): string
  startState: () => S
  copyState?: (state: S) => S
  name: string
  indent(state: S, textAfter: string): number
}

declare function readToken<S>(mode: Mode<S>, stream: StringStream, state: S, inner?: any): string
declare function copyState<S>(mode: Mode<S>, state: S): S
