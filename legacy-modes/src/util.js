export function readToken(mode, stream, state, inner = null) {
  for (let i = 0; i < 10; i++) {
    //if (inner) inner[0] = innerMode(mode, state).mode
    let style = mode.token(stream, state)
    if (stream.pos > stream.start) return style
  }
  throw new Error("Mode " + mode.name + " failed to advance stream.")
}

export function copyState(mode, state) {
  if (state === true) return state
  if (mode.copyState) return mode.copyState(state)
  let nstate = {}
  for (let n in state) {
    let val = state[n]
    if (val instanceof Array) val = val.concat([])
    nstate[n] = val
  }
  return nstate
}
