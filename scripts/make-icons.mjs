// Renders the app icon and the iPhone start screens into public/. Run with: npm run icons
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

// The euro sign of Volker's picture, redrawn: an open ring and two bars, glowing blue,
// with fine digital lines inside, above a lit base on a dark blue gradient
const cx = 548
const cy = 500
const r = 232
const pt = (deg) => {
  const a = (deg * Math.PI) / 180
  return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy - r * Math.sin(a)).toFixed(1)}`
}
const glyph = (w) => `
  <path d="M ${pt(48)} A ${r} ${r} 0 1 0 ${pt(-48)}" fill="none" stroke-width="${w}"/>
  <path d="M 228 ${cy - 62} H 600 M 228 ${cy + 62} H 580" fill="none" stroke-width="${w * 0.62}"/>`

let rain = ''
for (let x = 250; x < 800; x += 22) {
  for (let y = 220; y < 780; y += 34 + ((x * 7) % 23)) {
    const h = 8 + ((x * 13 + y) % 22)
    rain += `<rect x="${x}" y="${y}" width="3" height="${h}" rx="1.5" fill="#8fcbff" opacity="${(0.25 + ((x + y) % 50) / 100).toFixed(2)}"/>`
  }
}

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2257"/><stop offset="1" stop-color="#020817"/></linearGradient>
    <radialGradient id="halo" cx="0.52" cy="0.48" r="0.5"><stop offset="0" stop-color="#2f7bff" stop-opacity=".45"/><stop offset="1" stop-color="#2f7bff" stop-opacity="0"/></radialGradient>
    <radialGradient id="base" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#cfe6ff" stop-opacity=".95"/><stop offset=".35" stop-color="#3d8bff" stop-opacity=".55"/><stop offset="1" stop-color="#3d8bff" stop-opacity="0"/></radialGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
    <mask id="body"><g stroke="#fff">${glyph(104)}</g></mask>
    <mask id="edge"><g stroke="#fff">${glyph(104)}</g><g stroke="#000">${glyph(78)}</g></mask>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#halo)"/>
  <ellipse cx="512" cy="852" rx="300" ry="44" fill="url(#base)"/>
  <g stroke="#2f86ff" opacity=".95" filter="url(#glow)">${glyph(120)}</g>
  <g mask="url(#body)"><rect width="1024" height="1024" fill="#0d3c9e" opacity=".92"/>${rain}</g>
  <g mask="url(#edge)"><rect width="1024" height="1024" fill="#d8ecff"/></g>
  <g mask="url(#edge)" filter="url(#soft)"><rect width="1024" height="1024" fill="#7fb8ff"/></g>
</svg>`

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).flatten().png({ compressionLevel: 9 }).toBuffer()

for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  writeFileSync(`public/icons/${name}.png`, await png(icon, size))
}

const screens = [
  [402, 874], // iPhone 17, 17 Pro, 16 Pro
  [440, 956], // Pro Max
  [393, 852], // iPhone 15, 16
  [390, 844], // iPhone 14
]
const links = []
for (const [w, h] of screens) {
  for (const [scheme, bg] of [['light', '#e8f0fd'], ['dark', '#000000']]) {
    const logo = await sharp(await png(icon, 264))
      .composite([{ input: Buffer.from(`<svg width="264" height="264"><rect width="264" height="264" rx="59" fill="#fff"/></svg>`), blend: 'dest-in' }])
      .png().toBuffer()
    const out = await sharp({ create: { width: w * 3, height: h * 3, channels: 3, background: bg } })
      .composite([{ input: logo, gravity: 'center' }])
      .png({ compressionLevel: 9, palette: true }).toBuffer()
    const file = `${w}x${h}-${scheme}.png`
    writeFileSync(`public/splash/${file}`, out)
    links.push(`    <link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: ${scheme})" href="%BASE_URL%splash/${file}" />`)
  }
}
const html = readFileSync('index.html', 'utf8')
writeFileSync('index.html', html.replace(/( *<!-- SPLASH -->[\s\S]*?)?( *<\/head>)/, `    <!-- SPLASH -->\n${links.join('\n')}\n$2`))
