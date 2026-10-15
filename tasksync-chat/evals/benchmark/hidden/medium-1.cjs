// Hidden check for medium-1: quantities, several items, empty cart and money format.
const path = require('node:path');

module.exports = (dir) => {
    const { cartSummary } = require(path.join(dir, 'src', 'cart.js'));
    const { money } = require(path.join(dir, 'src', 'format.js'));
    return [
        ['two items with quantities', () => cartSummary([{ price: 1.5, qty: 3 }, { price: 2, qty: 1 }]) === '$7.80'],
        ['empty cart', () => cartSummary([]) === '$0.00'],
        ['money(3) is $3.00', () => money(3) === '$3.00'],
        ['money(0.1) is $0.10', () => money(0.1) === '$0.10'],
    ];
};
