export class StringStream {
  pos: number
  string: string
  start: number
  lineStart: number
  tabSize: number
  lastColumnPos: number
  lineOracle: any
  lastColumnValue: number
  constructor(string: string, tabSize?: number, lineOracle?: any)

  eol(): boolean
}
