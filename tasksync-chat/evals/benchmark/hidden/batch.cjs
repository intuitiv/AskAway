// Hidden check for batch-01..batch-20: each helper on inputs the visible test does not use.
const assert = require('node:assert');
const path = require('node:path');

const CASES = {
    'batch-01': ['sum', [[-1, 4], 3], [[0, 0], 0]],
    'batch-02': ['max', [[9, 1], 9], [[-3, -2], -2]],
    'batch-03': ['isEven', [[7], false], [[0], true], [[-2], true]],
    'batch-04': ['square', [[5], 25], [[-2], 4]],
    'batch-05': ['last', [[['a']], 'a'], [[[4, 5]], 5]],
    'batch-06': ['upper', [['Hi x'], 'HI X']],
    'batch-07': ['count', [[[]], 0], [[[1, 2, 3, 4]], 4]],
    'batch-08': ['abs', [[3], 3], [[-0.5], 0.5]],
    'batch-09': ['negate', [[false], true]],
    'batch-10': ['first', [['abc'], 'a'], [['z'], 'z']],
    'batch-11': ['reverse', [['hello'], 'olleh'], [[''], '']],
    'batch-12': ['min', [[[5, 9, -1]], -1], [[[2]], 2]],
    'batch-13': ['avg', [[[1, 2, 3, 6]], 3], [[[5]], 5]],
    'batch-14': ['trim', [['x '], 'x'], [[' y'], 'y']],
    'batch-15': ['clamp', [[15, 0, 10], 10], [[5, 0, 10], 5], [[-1, 2, 4], 2]],
    'batch-16': ['startsWithA', [['ba'], false], [['abc'], true]],
    'batch-17': ['double', [[[0, -3]], [0, -6]], [[[]], []]],
    'batch-18': ['unique', [[[3, 1, 3, 2, 1]], [3, 1, 2]]],
    'batch-19': ['join', [[['x']], 'x'], [[['a', 'b', 'c']], 'a,b,c']],
    'batch-20': ['cube', [[3], 27], [[-2], -8]],
};

module.exports = (dir, taskId) => {
    const helpers = require(path.join(dir, 'src', 'batch.js'));
    const [name, ...cases] = CASES[taskId];
    return cases.map(([input, expected]) => [`${name}(${JSON.stringify(input).slice(1, -1)})`, () => {
        assert.deepStrictEqual(helpers[name](...input), expected);
        return true;
    }]);
};
