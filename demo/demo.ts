import {EditorView, basicSetup} from "codemirror"

let doc = ""
for (let i = 0; i <= 1245526; i++) doc += String.fromCharCode("a".charCodeAt(0) + Math.floor(Math.random() * 26))

let view = (window as any).view = new EditorView({
  doc,
  extensions: basicSetup,
  parent: document.body
})

console.log("---")
view.dispatch({selection: {anchor: view.state.doc.length}, scrollIntoView: true})
