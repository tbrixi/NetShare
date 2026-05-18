// Builds an element node from a small SVG snippet (the snippet's outer element
// is returned). Necessary because document.createElement does not produce real
// SVG nodes — they need the SVG namespace, which a parsed <template> applies.
export function svgFromString(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

// Minimal DOM helper. Returns an HTMLElement built from a tag, prop bag, and children.
//  - `class` / `text` / `title` map to className / textContent / title.
//  - `on<Event>` keys (e.g. onClick) bind listeners.
//  - Other truthy values become attributes; nullish/false skip.
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
