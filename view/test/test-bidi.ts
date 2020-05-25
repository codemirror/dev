import ist from "ist"
import {__test} from "@codemirror/next/view"

function queryBrowserOrder(strings: readonly string[]) {
  let scratch = document.body.appendChild(document.createElement("div"))
  for (let str of strings) {
    let wrap = scratch.appendChild(document.createElement("div"))
    wrap.style.whiteSpace = "pre"
    for (let ch of str) {
      let span = document.createElement("span")
      span.textContent = ch
      wrap.appendChild(span)
    }
  }
  let ltr: (readonly number[])[] = [], rtl: (readonly number[])[] = []
  for (let i = 0; i < 2; i++) {
    let dest = i ? rtl : ltr
    scratch.style.direction = i ? "rtl" : "ltr"
    for (let cur = scratch.firstChild; cur; cur = cur.nextSibling) {
      let positions = []
      for (let sp = cur.firstChild, i = 0; sp; sp = sp.nextSibling) positions.push([i++, (sp as HTMLElement).offsetLeft])
      dest.push(positions.sort((a, b) => a[1] - b[1]).map(x => x[0]))
    }
  }
  scratch.remove()
  return {ltr, rtl}
}

const cases = [
  "codemirror",
  "كودالمرآة",
  "codeمرآة",
  "الشفرةmirror",
  "codeمرآةabc",
  "الشفرةmirror",
  "كود1234المرآة",
  "كودabcالمرآة",
  "code123مرآة157abc",
  "  foo  ",
  "  مرآة  ",
  "ab12-34%م",
  "م1234%bc",
  "ر12:34ر",
  "xyאהxyאהxyאהxyאהxyאהxyאהxyאה",
  "ab مرآة10 cde 20مرآة!"
]

let queried: {ltr: (readonly number[])[], rtl: (readonly number[])[]} | null = null
function getOrder(i: number, dir: "ltr" | "rtl") {
  if (!queried) queried = queryBrowserOrder(cases)
  return queried[dir][i]
}

function ourOrder(i: number, dir: "ltr" | "rtl") {
  let order = __test.computeOrder(cases[i], dir)
  let result = []
  for (let span of order) {
    if (span.level % 2) for (let i = span.to - 1; i >= span.from; i--) result.push(i)
    else for (let i = span.from; i < span.to; i++) result.push(i)
  }
  return result
}

function tests(dir: "ltr" | "rtl") {
  describe(dir + " context", () => {
    for (let i = 0; i < cases.length; i++) it(cases[i], () => {
      ist(ourOrder(i, dir).join("-"), getOrder(i, dir).join("-"))
    })
  })
}

describe("bidi", () => {
  tests("ltr")
  tests("rtl")
})
