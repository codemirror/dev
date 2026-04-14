import {EditorView, basicSetup} from "codemirror";
import {html} from "@codemirror/lang-html";
import {HighlightStyle, syntaxHighlighting} from "@codemirror/language";
import {tags} from "@lezer/highlight";

function makeScriptBlock()
{
	return `
<script>
	function preventDefault(e)
	{
		if (e.type == "dragover") e.dataTransfer.dropEffect = "copy";
		e.preventDefault();
		e.stopPropagation();
	}

	function enable_drop_in_support()
	{
		document.addEventListener("dragenter", preventDefault);
		document.addEventListener("dragover", preventDefault);
		document.addEventListener("dragleave", preventDefault);

		document.addEventListener("drop", function(e)
		{
			preventDefault(e);

			var file = e.dataTransfer.files[0];
			if (!file)
				return;
			
			var urlinfo = krpano.utils.spliturl(file.name);

			// only .splat and .ply files are supported
			var fileext = urlinfo.ext.toLowerCase();
			if (fileext != "splat" && fileext != "ply")
				return;
			
			// create a URL object
			var fileURL = URL.createObjectURL(file);

			// krpano will take the text after the '#' as filename for blob-urls
			var bloburl_with_filename = fileURL + "#" + file.name;

			// load the dropped splat model
			krpano.image.reset('copy');
			krpano.image.splats.url = bloburl_with_filename;
			krpano.actions.loadpanoimage('KEEPALL');
			
			// reset the view
			krpano.view.reset();

			// remove the URL object when leaving the pano
			krpano.events.addListener("onremovepano|once", function()
			{
				URL.revokeObjectURL(fileURL);
			});
		});
	}

	enable_drop_in_support();
</script>`;
}

let content = "<html>\n";

content += "\nBUGTEST: scroll down to bottom!\n"

// NOTE - increase the count if notthing happens
for (let i = 0; i < 20; i++)
{
  content += makeScriptBlock() + "\n";
}

content += "\n\nBUGTEST type here:\n\n"

content += "\n</html>";

const contrastHighlight = HighlightStyle.define([
  {tag: tags.content, color: "#888888"},
  {tag: tags.tagName, color: "#888888"},
  {tag: tags.angleBracket, color: "#666666"},
  {tag: tags.attributeName, color: "#999999"},
  {tag: tags.attributeValue, color: "#aaaaaa"},
  {tag: tags.keyword, color: "#ff7b72"},
  {tag: [tags.string, tags.special(tags.string)], color: "#a5d6ff"},
  {tag: tags.number, color: "#79c0ff"},
  {tag: [tags.variableName, tags.propertyName], color: "#ffa657"},
  {tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: "#d2a8ff"},
  {tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6e7681"},
  {tag: [tags.operator, tags.punctuation], color: "#ff7b72"},
  {tag: [tags.paren, tags.squareBracket, tags.brace], color: "#e6edf3"}
]);

;(window as any).view = new EditorView({
  doc: content,
  extensions: [
    basicSetup,
    html(),
    syntaxHighlighting(contrastHighlight),
    EditorView.theme({
      "&": {
	height: "100vh",
	backgroundColor: "#111111",
	color: "#888888"
      },
      ".cm-content": {
	caretColor: "#ffffff"
      },
      ".cm-scroller": {
	fontFamily: "monospace"
      },
      ".cm-gutters": {
	backgroundColor: "#111111",
	color: "#555555",
	border: "none"
      },
      ".cm-activeLine": {
	backgroundColor: "#1a1a1a"
      },
      ".cm-activeLineGutter": {
	backgroundColor: "#1a1a1a"
      },
      ".cm-selectionBackground, ::selection": {
	backgroundColor: "#264f78 !important"
      },
      "& .cm-cursor":
      {
	borderLeftColor: "#FFFFFF"
      },
    })
  ],
  parent: document.body
});
