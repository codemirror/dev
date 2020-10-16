import {Diagnostic} from "../../lint/src/lint";
import {EditorView} from "../../view/src";

export const jsonParseLinter = () => (view: EditorView): Diagnostic[] => {
  try {
    const str = Array.from(view.state.doc ?? []).join('');
    JSON.parse(str);
  } catch (e) {
    if (e instanceof SyntaxError) {
      const fromMatch = e.message.match(/at position (\d+)/);
      let from = 0;
      if (fromMatch) {
        from = parseInt(fromMatch[1]);
        from = Number.isNaN(from) ? 0 : from;
      }
      return [{
        from,
        message: e.message,
        severity: 'error',
        to: from,
      }]
    }
  }
  return [];
}