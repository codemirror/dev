#!/usr/bin/env node

const {Builder, By, until} = require("selenium-webdriver")
const chrome = require("selenium-webdriver/chrome")
const firefox = require("selenium-webdriver/firefox")

async function runFor(builder) {
  let driver = await builder.build()
  try {
    await driver.get(`http://localhost:${port}/test/?selenium`)
    let resultNode = await driver.wait(until.elementLocated(By.css("pre.test-result")), 20000)
    let result = JSON.parse(await resultNode.getAttribute("textContent"))
    console.log(result.passed.length + " passed")
    if (result.pending.length) console.log(result.pending.length + " skipped")
    console.log(result.failures.length + " failed")
    for (let {title, err} of result.failures)
      console.log("  " + title + "\n    " + err)
    return result.failures.length > 0
  } finally {
    driver.quit()
  }
}

let browsers = [], startServer = false, port = 8090
for (let arg of process.argv.slice(2)) {
  if (arg == "--chrome") browsers.push("chrome")
  else if (arg == "--firefox") browsers.push("firefox")
  else if (arg == "--start-server") startServer = true
  else {
    console.log("Usage: selenium.js [--chrome] [--firefox] [--start-server]")
    process.exit(1)
  }
}

if (startServer) {
  let path = require("path")
  let root = path.join(__dirname, "..", "demo")
  let moduleserver = new (require("esmoduleserve/moduleserver"))({root, maxDepth: 2})
  let serveStatic = require("serve-static")(root)
  let server = require("http").createServer((req, resp) => {
    moduleserver.handleRequest(req, resp) || serveStatic(req, resp, err => {
      resp.statusCode = 404
      resp.end('Not found')
    })
  }).listen()
  port = server.address().port
}

;(async () => {
  let failed = false
  if (browsers.length == 0 || browsers.indexOf("chrome") > -1) {
    console.log("Chrome:")
    if (await runFor(new Builder().forBrowser("chrome").setChromeOptions(new chrome.Options().headless()))) failed = true
  }
  if (browsers.indexOf("firefox") > -1) {
    console.log("Firefox:")
    if (await runFor(new Builder().forBrowser("firefox").setFirefoxOptions(new firefox.Options().headless()))) failed = true
  }
  process.exit(failed ? 1 : 0)
})()
