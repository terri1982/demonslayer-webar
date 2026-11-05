// Resolve all runtime assets relative to index.html so the static bundle works
// identically on root domains, GitHub Pages subpaths (/demonslayer-webar/), and local servers
// without any external CDN dependency.
export function assetUrl(relativePath) {
  const clean = String(relativePath || '').replace(/^\.?\/+/, '');
  return new URL(`./${clean}`, document.baseURI).href;
}
