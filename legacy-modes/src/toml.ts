import {StreamLanguage, StringStream} from "@codemirror/next/stream-parser"

class ParseState {
  constructor(public inString = false,
              public stringType = "",
              public lhs = false,
              public inArray = 0) {}

  copy() { return new ParseState(this.inString, this.stringType, this.lhs, this.inArray) }
}

export default StreamLanguage.define({
  token(stream: StringStream, state: ParseState) {
    //check for state changes
    if (!state.inString && ((stream.peek() == '"') || (stream.peek() == "'"))) {
      state.stringType = stream.peek()!
      stream.next() // Skip quote
      state.inString = true // Update state
    }
    if (stream.sol() && state.inArray === 0) {
      state.lhs = true
    }
    if (state.inString) {
      while (state.inString && !stream.eol()) {
        if (stream.peek() === state.stringType) {
          stream.next() // Skip quote
          state.inString = false // Clear flag
        } else if (stream.peek() === '\\') {
          stream.next()
          stream.next()
        } else {
          stream.match(/^.[^\\\"\']*/)
        }
      }
      return state.lhs ? "propertyName" : "string" // Token style
    } else if (state.inArray && stream.peek() === ']') {
      stream.next()
      state.inArray--
      return "squareBracket"
    } else if (state.lhs && stream.peek() === '[' && stream.skipTo(']')) {
      stream.next() //skip closing ]
      // array of objects has an extra open & close []
      if (stream.peek() === ']') stream.next()
      return "atom"
    } else if (stream.peek() === "#") {
      stream.skipToEnd()
      return "lineComment"
    } else if (stream.eatSpace()) {
      return null
    } else if (state.lhs && stream.eatWhile(/[^= ]/)) {
      return "propertyName"
    } else if (state.lhs && stream.peek() === "=") {
      stream.next()
      state.lhs = false
      return "operator"
    } else if (!state.lhs && stream.match(/^\d\d\d\d[\d\-\:\.T]*Z/)) {
      return "atom"
    } else if (!state.lhs && (stream.match('true') || stream.match('false'))) {
      return "atom"
    } else if (!state.lhs && stream.peek() === '[') {
      state.inArray++
      stream.next()
      return "squareBracket"
    } else if (!state.lhs && stream.match(/^\-?\d+(?:\.\d+)?/)) {
      return "number"
    } else {
      stream.next()
      return null
    }
  },

  startState() { return new ParseState },

  copyState(state: ParseState) { return state.copy() },

  indent(state: ParseState) {
    return state.inArray * 2 // FIXME
  }
})
