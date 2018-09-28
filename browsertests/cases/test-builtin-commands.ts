import {Builder, By, Key, WebElement} from "selenium-webdriver"
const ist = require("ist")

const target = process.env.TARGET!
const driver = new Builder().forBrowser("chrome").build()
const browser = process.env.SELENIUM_BROWSER || "chrome"
const firefox = browser == "firefox"
const tests = {
  async setCursor(n: number) { return driver.executeScript(`view.dispatch(view.state.transaction.setSelection(view.state.selection.constructor.single(${n})).scrollIntoView())`) },
  async getCursor(): Promise<number> { return driver.executeScript("return view.state.selection.primary.anchor") as Promise<number> },
  async setText(text: string) { return driver.executeScript(`view.dispatch(view.state.transaction.replace(0, view.state.doc.length, ${JSON.stringify(text)}))`) },
  async getText(): Promise<string> { return driver.executeScript(`return view.state.doc.toString()`) as Promise<string> }
}

let cm: null | WebElement = null
const getCm = async function() {
  if (cm) return cm
  await driver.get(target)
  cm = driver.findElement(By.className("CodeMirror-content"))
  await cm.click()
  return cm
}

let pending = 0
const forAllPositions = (onlyValid: boolean, f: (cm: WebElement, i: number, nonspacing: boolean) => Promise<void>) => async function () {
  ++pending
  const cm = await getCm()
  await tests.setText("one\nاِثْنَانِ\nthree\n".repeat(100))
  const run = async function(i: number) {
    const nonspacing = [5, 7, 9, 12].indexOf(i % 20) != -1
    if (nonspacing && onlyValid) return
    await tests.setCursor(i)
    await f(cm, i, nonspacing)
  }
  for (let i = 0; i <= 20 * 100; i += 63) await run(i)
  await run(4)
  await run(1997)
  await run(2000)
  --pending
}
const forAllValidPositions = (f: (cm: WebElement, i: number, nonspacing: boolean) => Promise<void>) => forAllPositions(true, f)

const lines = [
  [        0,        1,  2,  3],
  [  [4, 13], [11, 12], 10,  8,  6, [4, 13]],
  [       14,       15, 16, 17, 18,      19]
]
const getAllCoords = (pos: number) => {
  const ret = []
  for (let y = 0; y < lines.length; ++y)
    for (let x = 0; x < lines[y].length; ++x) {
      const field = lines[y][x]
      if (field === pos || (Array.isArray(field) && field.indexOf(pos) !== -1)) ret.push([y, x])
    }
  return ret
}

describe("builtin commands", () => {
  after(async function () {
    if (pending == 0) await driver.quit();
  })

  it("setCursor self-test", forAllPositions(false, async function (cm, i, nonspacing) {
    const pos = await tests.getCursor()
    ist(pos == i || (nonspacing && pos == i + 1))
  }))

  it("left", forAllValidPositions(async function (cm, start) {
    await cm.sendKeys(Key.LEFT)
    const result = await tests.getCursor()

    if (start == 0) {
      ist(result, start)
      return
    }
    const acceptable = getAllCoords(start % 20).reduce((acceptable, [y, x]) => {
      const cur = x > 0 ? lines[y][x - 1] : (y > 0 ? lines[y - 1][lines[y - 1].length - 1] : 19)
      return acceptable.concat(cur)
    }, [])
    ist(acceptable.indexOf(result % 20) !== -1)
    ist(result < start + 10) // These are logical positions
    ist(result > start - 20)
  }))

  it("right", forAllValidPositions(async function (cm, start) {
    await cm.sendKeys(Key.RIGHT)
    const result = await tests.getCursor()

    if (start == 2000) return ist(result, start)
    const acceptable = getAllCoords(start % 20).reduce((acceptable, [y, x]) => {
      const cur = x < lines[y].length - 1 ? lines[y][x + 1] : (y < lines.length - 1 ? lines[y + 1][0] : 0)
      return acceptable.concat(cur)
    }, [])
    ist(acceptable.indexOf(result % 20) !== -1)
    ist(result > start - 10) // These are logical positions
    ist(result < start + 20)
  }))

  it("up", forAllValidPositions(async function (cm, start) {
    await cm.sendKeys(Key.UP)
    const result = await tests.getCursor()
    if (start < 4) {
      ist(result, 0)
      return
    }
    const acceptable = getAllCoords(start % 20).reduce((acceptable, [y, x]) => {
      const line = lines[y == 0 ? lines.length - 1 : y - 1]
      return acceptable.concat(line[Math.min(x, line.length - 1)])
    }, [])
    ist(acceptable.indexOf(result % 20) !== -1)
    ist(result < start)
    ist(result > start - 20)
  }))

  it("down", forAllValidPositions(async function (cm, start) {
    await cm.sendKeys(Key.DOWN)
    const result = await tests.getCursor()
    if (start >= 20*99 + 14) {
      ist(result, 20*100)
      return
    }
    const acceptable = getAllCoords(start % 20).reduce((acceptable, [y, x]) => {
      const line = lines[(y + 1) % lines.length]
      return acceptable.concat(line[Math.min(x, line.length - 1)])
    }, [])
    ist(acceptable.indexOf(result % 20) !== -1)
    ist(result > start)
    ist(result < start + 20)
  }))

  // Doesn't work in Firefox, probably due to
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1418995
  // The synthesized keydown event has code = ""
  // FIXME goLineStartSmart
  // FIXME longer lines
  it("home", firefox ? undefined : forAllValidPositions(async function (cm, start) {
    await cm.sendKeys(Key.HOME)
    const pos = await tests.getCursor()
    const i = start % 20
    const line = (i < 4 ? 0 : (i < 14 ? 1 : 2))
    ist({0: 0, 1: 4, 2: 14}[line], pos % 20)
  }))

  // FIXME longer lines
  it("end", firefox ? undefined : forAllValidPositions(async function (cm, start) {
    await cm.sendKeys(Key.END)
    const pos = await tests.getCursor()
    if (start == 2000) {
      ist(pos, start)
      return
    }
    const i = start % 20
    const line = (i < 4 ? 0 : (i < 14 ? 1 : 2))
    ist({0: 3, 1: 13, 2: 19}[line], pos % 20)
  }))

  it("page up", firefox ? undefined : forAllValidPositions(async function (cm, start) {
    await cm.sendKeys(Key.PAGE_UP)
    const pos = await tests.getCursor()
    if (pos > 0) {
      const startColumns = getAllCoords(start % 20).map(([y, x]) => x)
      const resultCoords = getAllCoords(pos % 20)
      let found = false
      for (const column of startColumns)
        for (const [y, x] of resultCoords)
          if ((x == column) || (x < column && x == lines[y].length - 1)) found = true
      ist(found)
    }
    ist(pos <= Math.max(0, start - 200))
  }))

  it("page down", firefox ? undefined : forAllValidPositions(async function (cm, start) {
    await cm.sendKeys(Key.PAGE_DOWN)
    const pos = await tests.getCursor()
    if (pos < 20*100) {
      const startColumns = getAllCoords(start % 20).map(([y, x]) => x)
      const resultCoords = getAllCoords(pos % 20)
      let found = false
      for (const column of startColumns)
        for (const [y, x] of resultCoords)
          if ((x == column) || (x < column && x == lines[y].length - 1)) found = true
      ist(found)
    }
    ist(pos >= Math.min(20*100, start + 200))
  }))

  it("del", forAllValidPositions(async function (cm, start) {
    const text = await tests.getText()
    await cm.sendKeys(Key.DELETE)
    const pos = await tests.getCursor()
    ist(start, pos)
    const i = start % 20
    const expected = text.substr(0, start) + text.substr(start + (i >= 4 && i != 10 && i < 13 ? 2 : 1))
    const actual = await tests.getText()
    ist(expected === actual)
    await tests.setText(text)
  }))

  it("backspace", forAllValidPositions(async function (cm, start) {
    const text = await tests.getText()
    await cm.sendKeys(Key.BACK_SPACE)
    const pos = await tests.getCursor()
    const i = start % 20
    const expected = start - (i > 4 && i != 11 && i <= 13 ? 2 : 1)
    ist(Math.max(0, expected), pos)
    ist(text.substr(0, expected) + text.substr(start), await tests.getText())
    await tests.setText(text)
  }))
})
