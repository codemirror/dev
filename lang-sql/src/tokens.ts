import {ExternalTokenizer, Input} from "lezer"
import {whitespace, LineComment, BlockComment, String, Number, Bool, Null,
        ParenL, ParenR, BraceL, BraceR, BracketL, BracketR, Semi, Dot,
        Operator, Punctuation, SpecialVar, Identifier, QuotedIdentifier,
        Keyword, Type, Builtin} from "./sql.grammar.terms"

const enum Ch {
  Newline = 10,
  Space = 32,
  DoubleQuote = 34,
  Hash = 35,
  SingleQuote = 39,
  ParenL = 40, ParenR = 41,
  Star = 42,
  Plus = 43,
  Comma = 44,
  Dash = 45,
  Dot = 46,
  Slash = 47,
  Colon = 58,
  Semi = 59,
  Question = 63,
  At = 64,
  BracketL = 91, BracketR = 93,
  Backslash = 92,
  Underscore = 95,
  Backtick = 96,
  BraceL = 123, BraceR = 125,

  A = 65, a = 97,
  B = 66, b = 98,
  E = 69, e = 101,
  F = 70, f = 102,
  N = 78, n = 110,
  X = 88, x = 120,
  Z = 90, z = 122,

  _0 = 48, _1 = 49, _9 = 57,
}

function isAlpha(ch: number) {
  return ch >= Ch.A && ch <= Ch.Z || ch >= Ch.a && ch <= Ch.z || ch >= Ch._0 && ch <= Ch._9
}

function isHexDigit(ch: number) {
  return ch >= Ch._0 && ch <= Ch._9 || ch >= Ch.a && ch <= Ch.f || ch >= Ch.A && ch <= Ch.F
}

function readLiteral(input: Input, pos: number, endQuote: number, backslashEscapes: boolean) {
  for (let escaped = false;;) {
    let next = input.get(pos++)
    if (next < 0) return pos - 1
    if (next == endQuote && !escaped) return pos
    escaped = backslashEscapes && !escaped && next == Ch.Backslash
  }
}

function readWord(input: Input, pos: number) {
  for (;; pos++) {
    let next = input.get(pos)
    if (next != Ch.Underscore && !isAlpha(next)) break
  }
  return pos
}

function readWordOrQuoted(input: Input, pos: number) {
  let next = input.get(pos)
  if (next == Ch.SingleQuote || next == Ch.DoubleQuote || next == Ch.Backtick)
    return readLiteral(input, pos + 1, next, false)
  return readWord(input, pos)
}

function readNumber(input: Input, pos: number, sawDot: boolean) {
  let next
  for (;; pos++) {
    next = input.get(pos)
    if (next == Ch.Dot) {
      if (sawDot) break
      sawDot = true
    } else if (next < Ch._0 || next > Ch._9) {
      break
    }
  }
  if (next == Ch.E || next == Ch.e) {
    next = input.get(++pos)
    if (next == Ch.Plus || next == Ch.Dash) pos++
    for (;; pos++) {
      next = input.get(pos)
      if (next < Ch._0 || next > Ch._9) break
    }
  }
  return pos
}

function eol(input: Input, pos: number) {
  for (;; pos++) {
    let next = input.get(pos)
    if (next < 0 || next == Ch.Newline) return pos
  }
}

function inString(ch: number, str: string) {
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) == ch) return true
  return false
}

const Space = " \t\r\n"

function keywords(keywords: string, types: string, builtin?: string) {
  let result: {[name: string]: number} = Object.create(null)
  result["true"] = result["false"] = Bool
  result["null"] = result["unknown"] = Null
  for (let kw of keywords.split(" ")) if (kw) result[kw] = Keyword
  for (let tp of types.split(" ")) if (tp) result[tp] = Type
  for (let kw of (builtin || "").split(" ")) if (kw) result[kw] = Builtin
  return result
}

export type Dialect = {
  backslashEscapes: boolean,
  hashComments: boolean,
  spaceAfterDashes: boolean,
  slashComments: boolean,
  doubleQuotedStrings: boolean,
  charSetCasts: boolean,
  operatorChars: string,
  specialVar: string,
  identifierQuotes: string,
  words: {[name: string]: number}
}

export const SQLTypes = "array binary bit boolean char character clob date decimal double float int integer interval large national nchar nclob numeric object precision real smallint time timestamp varchar varying "
export const SQLKeywords = "absolute action add after all allocate alter and any are as asc assertion at authorization before begin between blob both breadth by call cascade cascaded case cast catalog check close collate collation column commit condition connect connection constraint constraints constructor continue corresponding count create cross cube current current_date current_default_transform_group current_transform_group_for_type current_path current_role current_time current_timestamp current_user cursor cycle data day deallocate dec declare default deferrable deferred delete depth deref desc describe descriptor deterministic diagnostics disconnect distinct do domain drop dynamic each else elseif end end-exec equals escape except exception exec execute exists exit external fetch first for foreign found from free full function general get global go goto grant group grouping handle having hold hour identity if immediate in indicator initially inner inout input insert intersect into is isolation join key language last lateral leading leave left level like limit local localtime localtimestamp locator loop map match method minute modifies module month names natural nesting new next no none not of old on only open option or order ordinality out outer output overlaps pad parameter partial path prepare preserve primary prior privileges procedure public read reads recursive redo ref references referencing relative release repeat resignal restrict result return returns revoke right role rollback rollup routine row rows savepoint schema scroll search second section select session session_user set sets signal similar size some space specific specifictype sql sqlexception sqlstate sqlwarning start state static system_user table temporary then timezone_hour timezone_minute to trailing transaction translation treat trigger under undo union unique unnest until update usage user using value values view when whenever where while with without work write year zone "

const defaults: Dialect = {
  backslashEscapes: false,
  hashComments: false,
  spaceAfterDashes: false,
  slashComments: false,
  doubleQuotedStrings: false,
  charSetCasts: false,
  operatorChars: "*+\-%<>!=&|~^/",
  specialVar: "?",
  identifierQuotes: '"',
  words: keywords(SQLKeywords, SQLTypes)
}

export function dialect(spec: Partial<Dialect>, kws?: string, types?: string, builtin?: string): Dialect {
  let dialect = {} as Dialect
  for (let prop in defaults)
    (dialect as any)[prop] = ((spec.hasOwnProperty(prop) ? spec : defaults) as any)[prop]
  if (kws) dialect.words = keywords(kws, types || "", builtin)
  return dialect
}

export function tokensFor(d: Dialect) {
  return new ExternalTokenizer((input, token) => {
    let pos = token.start, next = input.get(pos++), next2 = input.get(pos)
    if (inString(next, Space)) {
      while (inString(input.get(pos), Space)) pos++
      token.accept(whitespace, pos)
    } else if (next == Ch.SingleQuote || next == Ch.DoubleQuote && d.doubleQuotedStrings) {
      token.accept(String, readLiteral(input, pos, next, d.backslashEscapes))
    } else if (next == Ch.Hash && d.hashComments ||
               next == Ch.Slash && next2 == Ch.Slash && d.slashComments) {
      token.accept(LineComment, eol(input, pos))
    } else if (next == Ch.Dash && next2 == Ch.Dash &&
               (!d.spaceAfterDashes || input.get(pos + 1) == Ch.Space)) {
      token.accept(LineComment, eol(input, pos + 1))
    } else if (next == Ch.Slash && next2 == Ch.Star) { // FIXME nesting
      pos++
      for (let star = false;;) {
        let next = input.get(pos++)
        if (next < 0) { pos--; break }
        if (star && next == Ch.Slash) break
        star = next == Ch.Star
      }
      token.accept(BlockComment, pos)
    } else if ((next == Ch.e || next == Ch.E) && next2 == Ch.SingleQuote) {
      token.accept(String, readLiteral(input, pos + 1, Ch.SingleQuote, true))
    } else if ((next == Ch.n || next == Ch.N) && next2 == Ch.SingleQuote &&
               d.charSetCasts) {
      token.accept(String, readLiteral(input, pos + 1, Ch.SingleQuote, d.backslashEscapes))
    } else if (next == Ch.Underscore && d.charSetCasts) {
      for (;;) {
        let next = input.get(pos++)
        if (next == Ch.SingleQuote && pos > token.start + 2) {
          token.accept(String, readLiteral(input, pos, Ch.SingleQuote, d.backslashEscapes))
          break
        }
        if (!isAlpha(next)) break
      }
    } else if (next == Ch.ParenL) {
      token.accept(ParenL, pos)
    } else if (next == Ch.ParenR) {
      token.accept(ParenR, pos)
    } else if (next == Ch.BraceL) {
      token.accept(BraceL, pos)
    } else if (next == Ch.BraceR) {
      token.accept(BraceR, pos)
    } else if (next == Ch.BracketL) {
      token.accept(BracketL, pos)
    } else if (next == Ch.BracketR) {
      token.accept(BracketR, pos)
    } else if (next == Ch.Semi) {
      token.accept(Semi, pos)
    } else if (next == Ch._0 && (next2 == Ch.b || next2 == Ch.B) ||
               (next == Ch.b || next == Ch.B) && next2 == Ch.SingleQuote) {
      let quoted = next2 == Ch.SingleQuote
      pos++
      while ((next = input.get(pos)) == Ch._0 || next == Ch._1) pos++
      if (quoted && next == Ch.SingleQuote) pos++
      token.accept(Number, pos)
    } else if (next == Ch._0 && (next2 == Ch.x || next2 == Ch.X) ||
               (next == Ch.x || next == Ch.X) && next2 == Ch.SingleQuote) {
      let quoted = next2 == Ch.SingleQuote
      pos++
      while (isHexDigit(next = input.get(pos))) pos++
      if (quoted && next == Ch.SingleQuote) pos++
      token.accept(Number, pos)
    } else if (next == Ch.Dot && next2 >= Ch._0 && next2 <= Ch._9) {
      token.accept(Number, readNumber(input, pos + 1, true))
    } else if (next == Ch.Dot) {
      token.accept(Dot, pos)
    } else if (next >= Ch._0 && next <= Ch._9) {
      token.accept(Number, readNumber(input, pos, false))
    } else if (inString(next, d.operatorChars)) {
      while (inString(input.get(pos), d.operatorChars)) pos++
      token.accept(Operator, pos)
    } else if (inString(next, d.specialVar)) {
      token.accept(SpecialVar, readWordOrQuoted(input, next2 == next ? pos + 1 : pos))
    } else if (inString(next, d.identifierQuotes)) {
      token.accept(QuotedIdentifier, readLiteral(input, pos + 1, next, false))
    } else if (next == Ch.Colon || next == Ch.Comma) {
      token.accept(Punctuation, pos)
    } else if (isAlpha(next)) {
      pos = readWord(input, pos)
      token.accept(d.words[input.read(token.start, pos).toLowerCase()] ?? Identifier, pos)
    }
  })
}

export const tokens = tokensFor(defaults)
