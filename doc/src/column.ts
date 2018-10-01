import {isExtendingChar} from "./char"

export function countColumn(string: string, n: number, tabSize: number): number {
  for (let i = 0; i < string.length; i++) {
    let code = string.charCodeAt(i)
    if (code == 9) n += tabSize - (n % tabSize)
    else if (code < 768 || !isExtendingChar(string.charAt(i))) n++
  }
  return n
}

export function findColumn(string: string, n: number, col: number, tabSize: number): {offset: number, leftOver: number} {
  for (let i = 0; i < string.length; i++) {
    let code = string.charCodeAt(i)
    if (code >= 768 && isExtendingChar(string.charAt(i))) continue
    if (n >= col) return {offset: i, leftOver: 0}
    n += code == 9 ? tabSize - (n % tabSize) : 1
  }
  return {offset: string.length, leftOver: col - n}
}
