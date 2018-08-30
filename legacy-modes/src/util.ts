import {StringStream} from "./stringstream"

export function readToken(mode: any, stream: StringStream, state: any) {
  for (let i = 0; i < 10; i++) {
    //if (inner) inner[0] = innerMode(mode, state).mode
    let style = mode.token(stream, state)
    if (stream.pos > stream.start) return style
  }
  throw new Error("Mode " + mode.name + " failed to advance stream.")
}

export function copyState(mode: any, state: any) {
  if (state === true) return state
  if (mode.copyState) return mode.copyState(state)
  let nstate: any = {}
  for (let n in state) {
    let val = state[n]
    if (val instanceof Array) val = val.concat([])
    nstate[n] = val
  }
  return nstate
}

export interface Mode<S> {
  token(stream: StringStream, state: S): string
  startState: () => S
  copyState?: (state: S) => S
  name: string
  indent(state: S, textAfter: string): number
}
