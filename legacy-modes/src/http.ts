import {LegacyMode, StringStream} from "../../stream-syntax/src/stream-syntax"

type ParseState = {cur: (stream: StringStream, state: ParseState) => string | null}

let httpMode: LegacyMode<ParseState> = {
  name: "http",

  token(stream: StringStream, state: ParseState) {
    if (state.cur != header && state.cur != body && stream.eatSpace()) return null
    return state.cur(stream, state)
  },

  blankLine(state: ParseState) {
    state.cur = body
  },

  startState() {
    return {cur: start}
  }
}

export default httpMode

function failFirstLine(stream: StringStream, state: ParseState) {
  stream.skipToEnd()
  state.cur = header
  return "error"
}

function start(stream: StringStream, state: ParseState) {
  if (stream.match(/^HTTP\/\d\.\d/)) {
    state.cur = responseStatusCode
    return "keyword"
  } else if (stream.match(/^[A-Z]+/) && /[ \t]/.test(stream.peek()!)) {
    state.cur = requestPath
    return "keyword"
  } else {
    return failFirstLine(stream, state)
  }
}

function responseStatusCode(stream: StringStream, state: ParseState) {
  var code = stream.match(/^\d+/) as RegExpMatchArray
  if (!code) return failFirstLine(stream, state)

  state.cur = responseStatusText
  var status = Number(code[0])
  if (status >= 100 && status < 200)
    return "number.positive.informational"
  else if (status >= 200 && status < 300)
    return "number.positive.success"
  else if (status >= 300 && status < 400)
    return "number.positive.redirect"
  else if (status >= 400 && status < 500)
    return "number.negative.client-error"
  else if (status >= 500 && status < 600)
    return "number.negative.server-error"
  else
    return "error"
}

function responseStatusText(stream: StringStream, state: ParseState) {
  stream.skipToEnd()
  state.cur = header
  return null
}

function requestPath(stream: StringStream, state: ParseState) {
  stream.eatWhile(/\S/)
  state.cur = requestProtocol
  return "string.path"
}

function requestProtocol(stream: StringStream, state: ParseState) {
  if (stream.match(/^HTTP\/\d\.\d$/)) {
    state.cur = header
    return "keyword"
  } else {
    return failFirstLine(stream, state)
  }
}

function header(stream: StringStream) {
  if (stream.sol() && !stream.eat(/[ \t]/)) {
    if (stream.match(/^.*?:/)) {
      return "atom"
    } else {
      stream.skipToEnd()
      return "error"
    }
  } else {
    stream.skipToEnd()
    return "string"
  }
}

function body(stream: StringStream) {
  stream.skipToEnd()
  return null
}
