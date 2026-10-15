// Cart summary: sum of price x qty, plus tax, formatted as money.
const { RATE } = require('./tax');
const { money } = require('./format');

function cartSummary(items) {
    const subtotal = items.reduce((sum, item) => sum + item.price, 0);
    return money(subtotal * (1 + RATE));
}

module.exports = { cartSummary };
