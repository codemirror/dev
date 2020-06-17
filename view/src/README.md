The “view” is the part of the editor that the user sees—a DOM
component that displays the editor state and allows text input.

@EditorView

@themeClass

@BlockType

@BlockInfo

@Direction

@BidiSpan

### Extending the View

@Command

@ViewPlugin

@PluginValue

@PluginField

@ViewUpdate

@logException

@MouseSelectionStyle

@multipleSelections

@highlightSpecialChars

### Key bindings

@KeyBinding

@keymap

@runScopeHandlers

### Decorations

Your code should never, _never_ directly change the DOM structure
CodeMirror creates for its content. Instead, the way to influence how
things are drawn is by providing decorations, which can add styling or
replace content with an alternative representation.

@Decoration

@DecorationSet

@WidgetType

@Range
