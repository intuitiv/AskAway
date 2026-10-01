const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const run = (...args) => {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'tools', 'batch.cjs'), ...args], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout };
};

let r = run('echo a', 'echo b');
assert.equal(r.code, 0);
assert.match(r.out, /\$ echo a\na\nexit=0 \d+ms\n\$ echo b\nb\nexit=0 \d+ms\n/);
assert.match(r.out, /BATCH ok=2 failed=0 skipped=0\n$/);

r = run('echo a', 'exit 3', 'echo never');
assert.equal(r.code, 3, 'exit code is the first failing code');
assert.match(r.out, /exit=3 \d+ms/);
assert.ok(!r.out.includes('never'));
assert.match(r.out, /BATCH ok=1 failed=1 skipped=1\n$/);

r = run('--keep-going', 'exit 2', 'echo after', 'exit 5');
assert.equal(r.code, 2);
assert.ok(r.out.includes('after'));
assert.match(r.out, /BATCH ok=1 failed=2 skipped=0\n$/);

r = run('--tail', '2', 'printf "1\\n2\\n3\\n4\\n"');
assert.ok(r.out.includes('3\n4\n') && !r.out.includes('\n2\n'), 'only the last N lines');

console.log('PASS EV-BATCH');
