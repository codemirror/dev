import {StyleModule} from "style-mod"
import {ViewExtension, styleModule, themeClass} from "../../view/src"

type ThemeRule = {[name: string]: ThemeRule | string}

export function theme(rules: {[name: string]: ThemeRule}) {
  let {tree, styles} = ruleTree(rules)
  return ViewExtension.all(
    themeClass(type => {
      let parts = type.split(".")
      for (let i = 0; i < parts.length; i++) {
        let match = tree.next[parts[i]]
        if (match) {
          for (let j = i + 1; j < parts.length; j++) {
            let next = match.next[parts[j]]
            if (!next) break
            match = next
          }
          if (match.classes) return match.classes
        }
      }
      return ""
    }),
    styleModule(styles)
  )
}

const none: {[prop: string]: any} = Object.create(null)

class MatchTree {
  classes = ""
  next: {[part: string]: MatchTree} = none
  ensure(part: string) {
    let found = this.next[part]
    if (found) return found
    if (this.next == none) this.next = Object.create(null)
    return this.next[part] = new MatchTree
  }
}

function ruleTree(rules: {[name: string]: ThemeRule}) {
  let styles: {[name: string]: {[prop: string]: string}} = {}, classID = 0

  function explore(target: MatchTree, rules: ThemeRule, parentStyle: {[property: string]: string} | null) {
    let style: {[prop: string]: string} | null = null
    // First fill in the direct styles, if any
    if (target != top) for (let prop in rules) {
      let value = rules[prop]
      if (typeof value != "string" && !/&/.test(prop)) continue
      if (!style) {
        style = {}
        if (parentStyle) for (let p in parentStyle) style[p] = parentStyle[p]
      }
      style[prop] = value as string
    }
    if (style) {
      let name = "c" + (classID++)
      styles[name] = style
      target.classes += (target.classes ? " " : "") + name
    }
    // Then handle child rules
    for (let prop in rules) {
      let value = rules[prop]
      if (typeof value == "string" || /&/.test(prop)) continue
      let curTarget = target
      for (let part of prop.split(".")) curTarget = curTarget.ensure(part)
      explore(curTarget, value, style)
    }
  }
  let top = new MatchTree
  explore(top, rules, null)
  let mod = new StyleModule(styles)

  function mapClasses(tree: MatchTree) {
    tree.classes = tree.classes && tree.classes.split(" ").map(c => (mod as any)[c]).join(" ")
    for (let sub in tree.next) mapClasses(tree.next[sub])
  }
  mapClasses(top)
  return {tree: top, styles: mod}
}

export const defaultTheme = theme({
  token: {
    keyword: {color: "#708"},
    atom: {color: "#219"},
    number: {color: "#164"},
    "variable.definition": {color: "#00f"},
    "variable.type": {color: "#085"},
    comment: {color: "#940"},
    string: {color: "#a11"},
    "string.regexp": {color: "#e40"},
    meta: {color: "#555"},
    tag: {color: "#170"},
    attribute: {color: "#00c"},
  }
})
