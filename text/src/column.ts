import {nextClusterBreak} from "./char"

/// Count the column position at the given offset into the string,
/// taking extending characters and tab size into account.
export function countColumn(string: string, n: number, tabSize: number): number {
  for (let i = 0; i < string.length;) {
    if (string.charCodeAt(i) == 9) {
      n += tabSize - (n % tabSize)
      i++
    } else {
      n++
      i = nextClusterBreak(string, i)
    }
  }
  return n
}

/// Find the offset that corresponds to the given column position in a
/// string, taking extending characters and tab size into account.
export function findColumn(string: string, n: number, col: number, tabSize: number): {offset: number, leftOver: number} {
  for (let i = 0; i < string.length;) {
    if (n >= col) return {offset: i, leftOver: 0}
    n += string.charCodeAt(i) == 9 ? tabSize - (n % tabSize) : 1
    i = nextClusterBreak(string, i)
  }
  return {offset: string.length, leftOver: col - n}
}
