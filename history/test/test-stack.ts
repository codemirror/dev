const ist = require("ist")

import {TruncatingStack} from "../src/stack"

const checkInvariants = stack => {
  ist(stack.entries.length <= stack.segmentCount)
  stack.entries.forEach((segment, index) => {
    if (index < stack.entries.length - 1) ist(segment.length == stack.segmentSize)
    else ist(segment.length <= stack.segmentSize)
  })
}

describe("TruncatingStack", () => {
  describe("push", () => {
    it("regular operation", () => {
      let stack = TruncatingStack.empty(4)
      for (let i = 1; i < 20; ++i) {
        stack = stack.push(i)
        checkInvariants(stack)
        ist(stack.lastItem, i)
        if (i >= 5) ist(stack.get(stack.length - 1 - 4), i - 4)
        ist(stack.length >= Math.min(4, i))
      }
      ist(stack.length < 10)
    })
  })
  describe("replaceBefore", () => {
    it("normal operation", () => {
      let stack = TruncatingStack.empty(4).push(0)
      for (let i = 1; i < 20; ++i) {
        stack = stack.push(i).replaceBefore(1, [i * 2])
        checkInvariants(stack)
        ist(stack.lastItem, i)
        ist(stack.get(0), i * 2)
        ist(stack.length >= Math.min(4, i + 1))
      }
      ist(stack.length < 10)
    })
    it("allows replacing with more items than are replaced", () => {
      let stack = TruncatingStack.empty(4).push(0).push(0)
      for (let i = 1; i < 20; ++i) {
        const oldStack = stack
        const before = stack.length - ((i - 1) % 7 + 1)
        stack = stack.replaceBefore(before, [i, i * 2, i * 3, i * 4])
        checkInvariants(stack)
        ist(stack.lastItem, 0)
        ist(stack.get(stack.length - ((i - 1) % 7 + 1)), oldStack.get(before))
        ist(stack.length, Math.min(8, oldStack.length - before + 4))
      }
    })
  })
  describe("replaceFrom", () => {
    it("normal operation", () => {
      let stack = TruncatingStack.empty(4).push(0)
      for (let i = 1; i < 20; ++i) {
        stack = stack.replaceFrom(stack.length - 1, [i, i * 2, i * 3, i * 4, i * 5, i * 6])
        checkInvariants(stack)
        ist(stack.lastItem, i * 6)
        ist(stack.get(stack.length - 2), i * 5)
        ist(stack.get(stack.length - 3), i * 4)
        if (stack.length > 6) ist(stack.get(stack.length - 7), (i - 1) * 5)
        ist(stack.length >= 4)
      }
      ist(stack.length < 10)
    })
  })
})
