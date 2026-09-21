// Phase-1 build: bundle the two JS entries with esbuild and copy static
// assets verbatim. Name mapping (phase 1): settings.html still loads
// `settings.js` and `localization.js`, so outputs keep those legacy names
// until the HTML tags are renamed (S10).
import { context } from 'esbuild'
import { copyFile, cp, mkdir } from 'node:fs/promises'

const watch = process.argv.includes('--watch')
const dist = 'dist'

const bundles = [
  { entry: 'src/content/entry.js', outfile: 'dist/content.js' },
  { entry: 'src/popup/entry.js', outfile: 'dist/settings.js' }, // settings.html loads settings.js
]

const esbuildOptions = {
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: false, // keep output stable/readable for Chrome Web Store review
  sourcemap: false,
  logLevel: 'info',
}

async function copyStatic() {
  await mkdir(dist, { recursive: true })
  await copyFile('manifest.json', `${dist}/manifest.json`)
  await copyFile('icon128.png', `${dist}/icon128.png`)
  await copyFile('src/popup/settings.html', `${dist}/settings.html`)
  await copyFile('src/popup/labels.js', `${dist}/localization.js`) // settings.html loads localization.js
  await copyFile('src/injected/injected.js', `${dist}/injected.js`)
  await cp('_locales', `${dist}/_locales`, { recursive: true })
}

const contexts = await Promise.all(
  bundles.map(({ entry, outfile }) => context({ ...esbuildOptions, entryPoints: [entry], outfile })),
)
await Promise.all(contexts.map(ctx => ctx.rebuild()))
await copyStatic()

if (watch) {
  await Promise.all(contexts.map(ctx => ctx.watch()))
  console.log('[build] watching for changes...')
} else {
  await Promise.all(contexts.map(ctx => ctx.dispose()))
}
