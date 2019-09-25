import {isExtendingChar} from "./char"

/// Count the column position at the given offset into the string,
/// taking extending characters and tab size into account.
export function countColumn(string: string, n: number, tabSize: number): number {
  for (let i = 0; i < string.length; i++) {
    let code = string.charCodeAt(i)
    if (code == 9) n += tabSize - (n % tabSize)
    else if (code < 768 || !isExtendingChar(code)) n++
  }
  return n
}

/// Find the offset that corresponds to the given column position in a
/// string, taking extending characters and tab size into account.
export function findColumn(string: string, n: number, col: number, tabSize: number): {offset: number, leftOver: number} {
  for (let i = 0; i < string.length; i++) {
    let code = string.charCodeAt(i)
    if (isExtendingChar(code)) continue
    if (n >= col) return {offset: i, leftOver: 0}
    n += code == 9 ? tabSize - (n % tabSize) : 1
  }
  return {offset: string.length, leftOver: col - n}
}
