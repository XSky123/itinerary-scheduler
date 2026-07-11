import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

const binaryExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.woff', '.woff2',
])
const decoder = new TextDecoder('utf-8', { fatal: true })
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString('utf8').split('\0').filter(Boolean)

const failures = []
for (const file of files) {
  if (binaryExtensions.has(extname(file).toLowerCase())) continue
  const bytes = readFileSync(file)
  let text
  try {
    text = decoder.decode(bytes)
  } catch {
    failures.push(`${file}: not valid UTF-8`)
    continue
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) failures.push(`${file}: UTF-8 BOM is not allowed`)
  if (text.includes('\r')) failures.push(`${file}: use LF instead of CRLF`)
  if (text.includes('\uFFFD')) failures.push(`${file}: contains a replacement character`)
}

if (failures.length > 0) {
  throw new Error(`Text encoding verification failed:\n${failures.join('\n')}`)
}
console.log(`UTF-8/LF verification passed (${files.length} files)`)
