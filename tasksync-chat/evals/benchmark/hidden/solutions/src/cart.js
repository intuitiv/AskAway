// Reference solution for medium-1 (with format.js).
const { RATE } = require('./tax');
const { money } = require('./format');

function cartSummary(items) {
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    return money(subtotal * (1 + RATE));
}

module.exports = { cartSummary };
