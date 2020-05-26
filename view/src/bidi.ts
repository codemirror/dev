// Codes used for character types:
const enum T {
  L = 1, // Left-to-Right
  R = 2, // Right-to-Left
  AL = 4, // Right-to-Left Arabic
  EN = 8, // European Number
  AN = 16, // Arabic Number
  ET = 64, // European Number Terminator
  CS = 128, // Common Number Separator
  NI = 256, // Neutral or Isolate (BN, N, WS),
  NSM = 512, // Non-spacing Mark
  Strong = T.L | T.R | T.AL,
  Num = T.EN | T.AN
}

// Decode a string with each type encoded as log2(type)
function dec(str: string): readonly T[] {
  let result = []
  for (let i = 0; i < str.length; i++) result.push(1 << +str[i])
  return result
}

// Character types for codepoints 0 to 0xf8
const LowTypes = dec("88888888888888888888888888888888888666888888787833333333337888888000000000000000000000000008888880000000000000000000000000088888888888888888888888888888888888887866668888088888663380888308888800000000000000000000000800000000000000000000000000000008")

// Character types for codepoints 0x600 to 0x6f9
const ArabicTypes = dec("4444448826627288999999999992222222222222222222222222222222222222222222222229999999999999999999994444444444644222822222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222999999949999999229989999223333333333")

function charType(ch: number) {
  return ch <= 0xf7 ? LowTypes[ch] :
    0x590 <= ch && ch <= 0x5f4 ? T.R :
    0x600 <= ch && ch <= 0x6f9 ? ArabicTypes[ch - 0x600] :
    0x6ee <= ch && ch <= 0x8ac ? T.AL :
    0x2000 <= ch && ch <= 0x200b ? T.NI :
    ch == 0x200c ? T.NI : T.L
}

const BidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/

export class BidiSpan {
  constructor(readonly from: number, readonly to: number, readonly level: number) {}
  get inverted() { return this.level % 2 > 0 }
}

// Reused array of character types
const types: T[] = []

export function computeOrder(line: string, direction: "ltr" | "rtl") {
  let len = line.length, outerType = direction == "ltr" ? T.L : T.R 

  if (!line || outerType == T.L && !BidiRE.test(line)) return trivialOrder(len)

  // W1. Examine each non-spacing mark (NSM) in the level run, and
  // change the type of the NSM to the type of the previous
  // character. If the NSM is at the start of the level run, it will
  // get the type of sor.
  // W2. Search backwards from each instance of a European number
  // until the first strong type (R, L, AL, or sor) is found. If an
  // AL is found, change the type of the European number to Arabic
  // number.
  // W3. Change all ALs to R.
  // (Left after this: L, R, EN, AN, ET, CS, NI)
  for (let i = 0, prev = outerType, prevStrong = outerType; i < len; i++) {
    let type = charType(line.charCodeAt(i))
    if (type == T.NSM) type = prev
    else if (type == T.EN && prevStrong == T.AL) type = T.AN
    types[i] = type == T.AL ? T.R : type
    if (type & T.Strong) prevStrong = type
    prev = type
  }

  // W5. A sequence of European terminators adjacent to European
  // numbers changes to all European numbers.
  // W6. Otherwise, separators and terminators change to Other
  // Neutral.
  // W7. Search backwards from each instance of a European number
  // until the first strong type (R, L, or sor) is found. If an L is
  // found, then change the type of the European number to L.
  // (Left after this: L, R, EN+AN, NI)
  for (let i = 1, prev = types[0], prevStrong = outerType; i < len - 1; i++) {
    let type = types[i]
    if (type == T.CS && prev == types[i + 1] && (prev & T.Num)) {
      type = types[i] = prev
    } else if (type == T.CS) {
      types[i] = T.NI
    } else if (type == T.ET) {
      let end = i + 1
      while (end < len && types[end] == T.ET) end++
      let replace = (i && prev == T.EN) || (end < len && types[end] == T.EN) ? (prevStrong == T.L ? T.L : T.EN) : T.NI
      for (let j = i; j < end; j++) types[j] = replace
      i = end - 1
    } else if (type == T.EN && prevStrong == T.L) {
      types[i] = T.L
    }
    prev = type
    if (type & T.Strong) prevStrong = type
  }

  // N1. A sequence of neutrals takes the direction of the
  // surrounding strong text if the text on both sides has the same
  // direction. European and Arabic numbers act as if they were R in
  // terms of their influence on neutrals. Start-of-level-run (sor)
  // and end-of-level-run (eor) are used at level run boundaries.
  // N2. Any remaining neutrals take the embedding direction.
  // (Left after this: L, R, EN+AN)
  for (let i = 0; i < len; i++) {
    if (types[i] == T.NI) {
      let end = i + 1
      while (end < len && types[end] == T.NI) end++
      let beforeL = (i ? types[i - 1] : outerType) == T.L
      let afterL = (end < len ? types[end] : outerType) == T.L
      let replace = beforeL == afterL ? (beforeL ? T.L : T.R) : outerType
      for (let j = i; j < end; j++) types[j] = replace
      i = end - 1
    }
  }

  // Here we depart from the documented algorithm, in order to avoid
  // building up an actual levels array. Since there are only three
  // levels (0, 1, 2) in an implementation that doesn't take
  // explicit embedding into account, we can build up the order on
  // the fly, without following the level-based algorithm.
  let order = []
  if (outerType == T.L) {
    for (let i = 0; i < len;) {
      let start = i, rtl = types[i++] != T.L
      while (i < len && rtl == (types[i] != T.L)) i++
      if (rtl) {
        for (let j = i; j > start;) {
          let end = j, l = types[--j] != T.R
          while (j > start && l == (types[j - 1] != T.R)) j--
          order.push(new BidiSpan(j, end, l ? 2 : 1))
        }
      } else {
        order.push(new BidiSpan(start, i, 0))
      }
    }
  } else {
    for (let i = 0; i < len;) {
      let start = i, rtl = types[i++] == T.R
      while (i < len && rtl == (types[i] == T.R)) i++
      order.push(new BidiSpan(start, i, rtl ? 1 : 2))
    }
  }
  return order
}

export function trivialOrder(length: number) {
  return [new BidiSpan(0, length, 0)]
}
