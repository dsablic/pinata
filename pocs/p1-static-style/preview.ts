export type AbPair = { left: string, right: string }

function escapeHtml (text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function abSection (pairs: AbPair[]): string {
  if (pairs.length === 0) {
    return '<p>No reference sprites in <code>refs/p1/</code> yet. See <code>refs/README.md</code>.</p>'
  }
  return pairs.map((p, i) => `<figure>
<figcaption>Pair ${i + 1}: which looks more hand-made? Left, right, or can't tell?</figcaption>
<img class="px" src="${p.left}"><img class="px" src="${p.right}">
</figure>`).join('\n')
}

export function previewHtml (summary: string, pairs: AbPair[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>P1 static style</title>
<style>
body { font-family: system-ui, sans-serif; margin: 24px; background: #f4f4f4; color: #222; }
img { image-rendering: pixelated; display: block; margin: 8px 0; max-width: 100%; }
img.px { display: inline-block; margin-right: 32px; background: #c8c8c8; }
pre { background: #fff; padding: 12px; }
</style>
</head>
<body>
<h1>P1 static style</h1>
<pre>${escapeHtml(summary)}</pre>
<h2>Checklist</h2>
<ol>
<li>For each column of the contact sheet, write which way the character faces (front, front-left, left, back-left,
back, back-right, right, front-right). Compare with <code>facing</code> in <code>ab-key.json</code> afterwards.</li>
<li>In the 32px rows, can you point to the head, torso, arms, legs, cape and sword?</li>
<li>Answer each A/B pair below before opening <code>ab-key.json</code>.</li>
</ol>
<h2>Contact sheet</h2>
<p>Rows: 32px side, 32px 3/4, 48px side, 48px 3/4. Columns: 8 directions, 45 degrees apart.</p>
<img src="sheet.png">
<h2>Debug passes</h2>
<img src="debug-parts.png">
<img src="debug-normals.png">
<img src="debug-depth.png">
<h2>A/B</h2>
${abSection(pairs)}
<script>
for (const img of document.querySelectorAll('img.px')) {
  const grow = () => { img.width = img.naturalWidth * 8 }
  if (img.complete) grow()
  else img.addEventListener('load', grow)
}
</script>
</body>
</html>
`
}
