// Builds the single self-contained app file: dist/DepositManager.html
// (and copies it into the Android project's assets when that folder exists).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ORDER = ['vendor-jszip.min.js', 'core.js', 'xlsx.js', 'data.js', 'platform.js', 'ui-kit.js', 'app.js', 'screens.js', 'main.js'];

let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'css', 'app.css'), 'utf8');
const js = ORDER.map(f => {
  const code = fs.readFileSync(path.join(SRC, 'js', f), 'utf8');
  if (code.includes('</script')) throw new Error(f + ' contains a closing script tag');
  return '<script>\n' + code + '\n</script>';
}).join('\n');

html = html.replace('<!--CSS-->', () => '<style>\n' + css + '\n</style>').replace('<!--JS-->', () => js);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'DepositManager.html');
fs.writeFileSync(out, html);
console.log('built', out, (html.length / 1024).toFixed(1) + ' KB');

// Copy into the Android project: either ./android (local layout) or the parent folder
// (repository layout, where this web source lives in web/ next to the Android project).
for (const proj of [path.join(ROOT, 'android'), path.join(ROOT, '..')]) {
  if (!fs.existsSync(path.join(proj, 'settings.gradle'))) continue;
  const assets = path.join(proj, 'app', 'src', 'main', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'index.html'), html);
  console.log('copied to', path.join(assets, 'index.html'));
}
