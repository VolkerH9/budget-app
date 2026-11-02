// Renders the app icon and the iPhone start screens into public/. Run with: npm run icons
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const ring = (r, from, to, color, width) => {
  const point = (deg) => {
    const a = ((deg - 90) * Math.PI) / 180
    return `${512 + r * Math.cos(a)} ${512 + r * Math.sin(a)}`
  }
  return `<path d="M ${point(from)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`
}

const mark = `
  ${ring(300, 14, 196, '#ffffff', 84)}
  ${ring(300, 224, 286, 'rgba(255,255,255,.62)', 84)}
  ${ring(300, 314, 346, 'rgba(255,255,255,.36)', 84)}
  <path d="M 606 420 A 118 118 0 1 0 606 604" fill="none" stroke="#fff" stroke-width="46" stroke-linecap="round"/>
  <path d="M 396 478 H 548 M 396 546 H 530" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round"/>`

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#047857"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#g)"/>${mark}</svg>`

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
  for (const [scheme, bg] of [['light', '#f2f2f7'], ['dark', '#000000']]) {
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
