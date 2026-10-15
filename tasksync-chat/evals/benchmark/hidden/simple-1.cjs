// Hidden check for simple-1: percent() on inputs the visible test does not use.
const path = require('node:path');

module.exports = (dir) => {
    const { percent } = require(path.join(dir, 'src', 'math.js'));
    return [
        ['percent(1,3) is 33', () => percent(1, 3) === 33],
        ['percent(0,5) is 0', () => percent(0, 5) === 0],
        ['percent(5,5) is 100', () => percent(5, 5) === 100],
        ['percent(2,8) is 25', () => percent(2, 8) === 25],
    ];
};
