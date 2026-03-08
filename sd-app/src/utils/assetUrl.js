/**
 * Returns the full URL for a static asset in the public directory.
 * Prepends the Vite base URL to handle deployment on subpaths (e.g., GitHub Pages).
 * @param {string} path - Asset path starting with '/' (e.g., '/templates/cubes1/contruct.png')
 * @returns {string} Full asset URL
 */
export function assetUrl(path) {
  const base = import.meta.env.BASE_URL
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `${base}${cleanPath}`
}
