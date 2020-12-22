/// The categories produced by a [character
/// categorizer](#state.EditorState.charCategorizer). These are used
/// do things like selecting by word.
export enum CharCategory {
  /// Word characters.
  Word,
  /// Whitespace.
  Space,
  /// Anything else.
  Other
}

const nonASCIISingleCaseWordChar = /[\u00df\u0587\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/

let wordChar: RegExp | null
try { wordChar = new RegExp("[\\p{Alphabetic}\\p{Number}_]", "u") } catch (_) {}

function hasWordChar(str: string): boolean {
  if (wordChar) return wordChar.test(str)
  for (let i = 0; i < str.length; i++) {
    let ch = str[i]
    if (/\w/.test(ch) || ch > "\x80" && (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch)))
      return true
  }
  return false
}

export function makeCategorizer(wordChars: string) {
  return (char: string) => {
    if (!/\S/.test(char)) return CharCategory.Space
    if (hasWordChar(char)) return CharCategory.Word
    for (let i = 0; i < wordChars.length; i++) if (char.indexOf(wordChars[i]) > -1) return CharCategory.Word
    return CharCategory.Other
  }
}
