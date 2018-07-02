import {Builder, By, Key, until} from "selenium-webdriver"
import {EditorSelection} from "../../state/src/state"
const ist = require("ist")

const driver = new Builder().forBrowser("chrome").build()
const browser = process.env.SELENIUM_BROWSER || "chrome"
const notChrome = browser != "chrome"
const notFirefox = browser != "firefox"
let charSize
const tests = {
  async setCursor(n: number) {
    return driver.executeScript(`tests.setCursor(${n})`)

/*
    // How it could be if geckodriver would support actions
    if (!charSize) {
      charSize = await driver.executeScript(`const s = document.querySelector("span")
      const r = document.createRange()
      r.setStart(s, 0)
      r.setEnd(s, 1)
window.document.onclick = e => console.log(e.pageX, e.pageY)
      return r.getBoundingClientRect()`)
    }
    const cm = driver.findElement(By.className("CM-content"))
    const pos = {
      y: charSize.y + charSize.height * (n < 3 ? 0 : (n < 15 ? 1 : 2)),
      x: charSize.x + charSize.width * (n < 3 ? n : (n < 15 ? 15 - n : n - 15))
    }
for (let i = -100; i < 100; i+=10) {
await driver.actions({bridge: true}).move({x: -i, y: i, origin: cm}).click().perform()
}
console.log(pos)
    return driver.actions({bridge: true}).move({x: pos.x, y: pos.x, origin: cm}).click().perform()
*/

    // How it is in Firefox
    const cm = driver.findElement(By.className("CM-content"))
    await driver.executeScript(`tests.setCursor(0)`)
    let amount = (n < 4 ? n : (n < 14 ? 13 - (n > 12 ? n - 4 : (n > 9 ? n - 3: (n > 7 ? n - 2 : (n > 5 ? n -1 : n)))) : n - 4))
    while(amount--) await cm.sendKeys(Key.RIGHT)
  },
  getSelection() { return driver.executeScript("return tests.getSelection()") },
  setText(text: string) { return driver.executeScript(`return tests.setText(${JSON.stringify(text)})`) }
}

let cm = null
const getCm = async function() {
  if (cm) return cm
  await driver.get(process.env.TARGET)
  cm = driver.findElement(By.className("CM-content"))
  await cm.click()
  return cm
}

let pending = 0
const forAllPositions = (onlyValid, f) => async function () {
  ++pending
  const cm = await getCm()
  for (let i = 0; i < 20; ++i) {
    const nonspacing = (i == 5 || i == 7 || i == 9 || i == 12)
    if (nonspacing && onlyValid) continue
    await tests.setCursor(i)
    await f(cm, i, nonspacing)
  }
  --pending
}
const forAllValidPositions = f => forAllPositions(true, f)

describe("builtin commands", () => {
  after(async function () {
    if (pending == 0) await driver.quit();
  })

  it("setCursor self-test", forAllPositions(false, async function (cm, i, nonspacing) {
    const pos = (await tests.getSelection()).primary.anchor
    ist(pos == i || (nonspacing && pos == i + 1))
  }))

  it("left", forAllValidPositions(async function (cm, i) {
    const next = {
      0: 0,
     13: 3, 11: 12, 10: 11, 8: 9, 6: 8, 4: 5,
     14: 4
    }
    await cm.sendKeys(Key.LEFT)
    const pos = (await tests.getSelection()).primary.anchor
    if (i == 4) ist(pos == 5 || pos == 3)
    else if (i == 13) ist(pos == 3 || pos == 5)
    else if (i == 14) ist(pos == 4 || pos == 13)
    else ist(EditorSelection.single(next.hasOwnProperty(i) ? next[i] : i - 1).eq(await tests.getSelection()))
  }))

  it("right", forAllValidPositions(async function (cm, i) {
    const next = {
     3: 13,
     13: 11, 11: 10, 10: 8, 8: 6, 6: 4, 4: 14,
     19: 19
    }
    await cm.sendKeys(Key.RIGHT)
    const pos = (await tests.getSelection()).primary.anchor
    if (i == 3) ist(pos == 13 || pos == 4)
    else if (i == 4) ist(pos == 12 || pos == 14)
    else if (i == 6) ist(pos == 5 || pos == 4)
    else if (i == 10) ist(pos == 9 || pos == 8)
    else if (i == 13) ist(pos == 11 || pos == 14)
    else ist(EditorSelection.single(next.hasOwnProperty(i) ? next[i] : i + 1).eq(await tests.getSelection()))
  }))

  it("up", notFirefox && forAllValidPositions(async function (cm, i) {
    const next = {
      0: 0, 1: 0, 2: 0, 3: 0,
      13: 0, 11: 1, 10: 2, 8: 3, 6: 3, 4: 3,
      14: 12, 15: 11, 16: 9, 17: 8, 18: 5, 19: 4
    }
    await cm.sendKeys(Key.UP)
    const pos = (await tests.getSelection()).primary.anchor
    if (i == 4) ist(pos == 3 || pos == 0)
    else if (i == 13) ist(pos == 3 || pos == 0)
    else if (i == 14) ist(pos == 4 || pos == 12)
    else if (i == 18) ist(pos == 5 || pos == 6)
    else if (i == 19) ist(pos == 4 || pos == 13)
    else ist(EditorSelection.single(next[i]).eq(await tests.getSelection()))
  }))

  it("down", notFirefox && forAllValidPositions(async function (cm, i) {
    const next = {
      0: 12, 1: 11, 2: 9, 3: 8,
      13: 14, 11: 15, 10: 16, 8: 17, 6: 18, 4: 19,
      14: 19, 15: 19, 16: 19, 17: 19, 18: 19, 19: 19
    }
    const other_next = {
      0: 4, 2: 10,
      4: 14, 11: 14, 10: 15, 8: 16, 6: 16,
      13: 19, 14: 18, 15: 18
    }
    await cm.sendKeys(Key.DOWN)
    const pos = (await tests.getSelection()).primary.anchor
    ist(next[i] == pos || other_next[i] === pos)
  }))

  // Doesn't work in Firefox, probably due to
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1418995
  // The synthesized keydown event has code = ""
  // FIXME goLineStartSmart
  // FIXME longer lines
  it("home", notFirefox && forAllValidPositions(async function (cm, i) {
    await cm.sendKeys(Key.HOME)
    const pos = (await tests.getSelection()).primary.anchor
    const line = (i < 4 ? 0 : (i < 14 ? 1 : 2))
    ist({0: 0, 1: 4, 2: 14}[line], pos)
  }))

  // FIXME longer lines
  it("end", notFirefox && forAllValidPositions(async function (cm, i) {
    await cm.sendKeys(Key.END)
    const pos = (await tests.getSelection()).primary.anchor
    const line = (i < 4 ? 0 : (i < 14 ? 1 : 2))
    ist({0: 3, 1: 13, 2: 19}[line], pos)
  }))

  // FIXME longer doc
  it("page up", notFirefox && forAllValidPositions(async function (cm) {
    await cm.sendKeys(Key.PAGE_UP)
    const pos = (await tests.getSelection()).primary.anchor
    ist(0, pos)
  }))

  // FIXME longer doc
  it("page down", notFirefox && forAllValidPositions(async function (cm) {
    await cm.sendKeys(Key.PAGE_DOWN)
    const pos = (await tests.getSelection()).primary.anchor
    ist(19, pos)
  }))

  it("del", notChrome && forAllValidPositions(async function (cm, i) {
    const text = await cm.getText()
    await cm.sendKeys(Key.DELETE)
    const pos = (await tests.getSelection()).primary.anchor
    ist(i, pos)
    const expected = text.substr(0, i) + text.substr(i + (i >= 4 && i != 10 && i < 13 ? 2 : 1))
    const actual = await cm.getText()
    ist(expected, actual)
    await tests.setText(text)
  }))

  it("backspace", notChrome && forAllValidPositions(async function (cm, i) {
    const text = await cm.getText()
    await cm.sendKeys(Key.BACK_SPACE)
    const pos = (await tests.getSelection()).primary.anchor
    ist(Math.max(0, i - 1), pos)
    ist(text.substr(0, i - 1) + text.substr(i), await cm.getText())
    await tests.setText(text)
  }))
})
