/**
 * No component may be declared inside another component.
 *
 * A component created inside another one's body is a brand-new component on
 * every render, so React throws away everything it draws and builds it again
 * each time the parent re-renders. With a text box inside, that's one letter
 * per focus: the box is rebuilt after every keystroke, the keyboard closes, and
 * iOS clears a password field when it's refocused. The "Set a new password"
 * screen shipped exactly that way. Declare components at the top level of the
 * file instead, and pass what they need as props.
 *
 * Run with: npm run test:components
 */
const fs = require('fs');
const path = require('path');

const files: string[] = ['App.tsx'];
(function walk(dir: string) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(full);
    } else if (name.endsWith('.tsx')) files.push(full);
  }
})('src');

// Indented, so inside some other function: `const Foo = (...) =>`,
// `const Foo = ({ a }: P) =>`, `const Foo = function`, or `function Foo(`.
// PascalCase only (Foo, not FOO): constants in capitals are fine.
const INNER = [
  /^\s+(?:const|let)\s+([A-Z][a-z]\w*)\s*(?::[^=]+)?=\s*(?:React\.memo\()?(?:async\s*)?(?:\([^)]*\)|[a-z]\w*)\s*(?::[^=]+)?=>/,
  /^\s+(?:const|let)\s+([A-Z][a-z]\w*)\s*=\s*function\b/,
  /^\s+function\s+([A-Z][a-z]\w*)\s*\(/,
];

const found: string[] = [];
for (const file of files) {
  const lines: string[] = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // `React.forwardRef(\n  function Input(props, ref) {` names the function it
    // hands over; it's still declared once, at the top of the file.
    const prev = lines.slice(0, i).reverse().find((l) => l.trim()) ?? '';
    for (const re of INNER) {
      const m = line.match(re);
      if (m && !(re === INNER[2] && /\(\s*$/.test(prev))) found.push(`${file}:${i + 1}  ${m[1]}`);
    }
  });
}

console.log(`Checked ${files.length} files`);
if (found.length) {
  console.log('FAIL  components declared inside other components (move them to the top level):');
  for (const f of found) console.log(`      ${f}`);
  process.exit(1);
}
console.log('PASS  no component is declared inside another');
