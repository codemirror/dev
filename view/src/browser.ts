let [nav, doc]: [any, any] = typeof navigator != "undefined"
  ? [navigator, document]
  : [{userAgent: "", vendor: "", platform: ""}, {documentElement: {style: {}}}]

const ie_edge = /Edge\/(\d+)/.exec(nav.userAgent)
const ie_upto10 = /MSIE \d/.test(nav.userAgent)
const ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(nav.userAgent)
const ie = !!(ie_upto10 || ie_11up || ie_edge)
const gecko = !ie && /gecko\/(\d+)/i.test(nav.userAgent)
const chrome = !ie && /Chrome\/(\d+)/.exec(nav.userAgent)
const webkit = "webkitFontSmoothing" in doc.documentElement.style
const safari = !ie && /Apple Computer/.test(nav.vendor)

export default {
  mac: /Mac/.test(nav.platform),
  ie,
  ie_version: ie_upto10 ? doc.documentMode || 6 : ie_11up ? +ie_11up[1] : ie_edge ? +ie_edge[1] : 0,
  gecko,
  gecko_version: gecko ? +(/Firefox\/(\d+)/.exec(nav.userAgent) || [0, 0])[1] : 0,
  chrome: !!chrome,
  chrome_version: chrome ? +chrome[1] : 0,
  ios: safari && (/Mobile\/\w+/.test(nav.userAgent) || nav.maxTouchPoints > 2),
  android: /Android\b/.test(nav.userAgent),
  webkit,
  safari,
  webkit_version: webkit ? +(/\bAppleWebKit\/(\d+)/.exec(navigator.userAgent) || [0, 0])[1] : 0,
  tabSize: doc.documentElement.style.tabSize != null ? "tab-size" : "-moz-tab-size"
}
