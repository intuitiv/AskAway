const assert = require('node:assert/strict');
const { reconcileLogCursor } = require('/tmp/askaway-log-cursor.cjs');

assert.deepEqual(reconcileLogCursor(undefined, 20, undefined, 'file-1'), { byteOffset: 0, lineCount: 0, headHash: undefined, fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 20, lineCount: 1, fileId: 'file-1' }, 40, undefined, 'file-1'), { byteOffset: 20, lineCount: 1, headHash: undefined, fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5, headHash: 'same', fileId: 'file-1' }, 150, 'same', 'file-1'), { byteOffset: 100, lineCount: 5, headHash: 'same', fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5, headHash: 'same', fileId: 'file-1' }, 25, undefined, 'file-1'), { byteOffset: 0, lineCount: 0, headHash: undefined, fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5, headHash: 'old', fileId: 'file-1' }, 100, 'new', 'file-1'), { byteOffset: 0, lineCount: 0, headHash: 'new', fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5, headHash: 'same', fileId: 'file-1' }, 150, 'same', 'file-2'), { byteOffset: 0, lineCount: 0, headHash: 'same', fileId: 'file-2' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5 }, 150, 'baseline', 'file-1'), { byteOffset: 100, lineCount: 5, headHash: 'baseline', fileId: 'file-1' });
console.log('PASS log cursor append, shrink, replacement, and migration');