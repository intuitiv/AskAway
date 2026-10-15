// Visible tests: node test/visible.cjs. Prints one line per task and exits 1 when any fails.
const assert = require('node:assert');
const path = require('node:path');
const src = (name) => require(path.join(__dirname, '..', 'src', name));

const batch = [
    ['sum', [2, 3], 5], ['max', [2, 7], 7], ['isEven', [4], true], ['square', [3], 9], ['last', [[1, 2, 3]], 3],
    ['upper', ['ab'], 'AB'], ['count', [[1, 2]], 2], ['abs', [-4], 4], ['negate', [true], false], ['first', ['xy'], 'x'],
    ['reverse', ['abc'], 'cba'], ['min', [[3, 1, 2]], 1], ['avg', [[2, 4]], 3], ['trim', ['  a  '], 'a'], ['clamp', [-5, 0, 10], 0],
    ['startsWithA', ['ab'], true], ['double', [[1, 2]], [2, 4]], ['unique', [[1, 1, 2]], [1, 2]], ['join', [['a', 'b']], 'a,b'], ['cube', [2], 8],
];

const tests = [
    ['simple-1', () => assert.strictEqual(src('math').percent(1, 4), 25)],
    ['medium-1', () => assert.strictEqual(src('cart').cartSummary([{ price: 5, qty: 2 }]), '$12.00')],
    ['complex-1', () => assert.strictEqual(src('discount').applyDiscount(100, 'SAVE10'), 90)],
    ...batch.map(([name, input, expected], i) => [`batch-${String(i + 1).padStart(2, '0')}`, () => assert.deepStrictEqual(src('batch')[name](...input), expected)]),
];

let failed = 0;
for (const [id, run] of tests) {
    try { run(); console.log(`ok ${id}`); } catch (error) { failed++; console.log(`FAIL ${id}: ${String(error.message).split('\n')[0]}`); }
}
console.log(`visible: ${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
