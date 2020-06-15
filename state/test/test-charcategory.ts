import {EditorState, Extension, CharCategory} from "@codemirror/next/state"
import ist from "ist"

function mk(...extensions: Extension[]) {
  return EditorState.create({extensions})
}

describe("EditorState char categorizer", () => {
  it("categorises into alphanumeric", () => {
    let st = mk()
    ist(st.charCategorizer(0)("1"), CharCategory.Word)
    ist(st.charCategorizer(0)("a"), CharCategory.Word)
  })

  it("categorises into whitespace", () => {
    let st = mk()
    ist(st.charCategorizer(0)(" "), CharCategory.Space)
  })

  it("categorises into other", () => {
    let st = mk()
    ist(st.charCategorizer(0)("/"), CharCategory.Other)
    ist(st.charCategorizer(0)("<"), CharCategory.Other)
  })
})
