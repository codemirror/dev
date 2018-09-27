import {isExtendingChar} from "./char"

export function countColumn(string: string, tabSize: number): number {
  let n = 0
  for (let i = 0; i < string.length; i++) {
    let code = string.charCodeAt(i)
    if (code == 9) n += tabSize - (n % tabSize)
    else if (code < 768 || !isExtendingChar(string.charAt(i))) n++
  }
  return n
}

export function findColumn(string: string, col: number, tabSize: number): number {
  let n = 0
  for (let i = 0; i < string.length; i++) {
    let code = string.charCodeAt(i)
    if (code >= 768 && isExtendingChar(string.charAt(i))) continue
    if (n >= col) return i
    n += code == 9 ? tabSize - (n % tabSize) : 1
  }
  return string.length
}
