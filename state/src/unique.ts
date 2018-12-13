export function unique(prefix: string, names: {[key: string]: string}): string {
  for (let i = 0;; i++) {
    let name = prefix + (i ? "_" + i : "")
    if (!(name in names)) return names[name] = name
  }
}
