// Runs before the first paint so a picked theme never flashes the other one.
// Same key and colours as src/theme.ts. External file because the CSP forbids inline scripts.
;(function () {
  var theme = null
  try {
    theme = localStorage.getItem('gargalo:theme')
  } catch {
    // Storage blocked: follow the system.
  }
  var dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme)
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#0f1114' : '#f3f4f1')
})()
