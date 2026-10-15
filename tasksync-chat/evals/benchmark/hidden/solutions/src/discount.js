// Reference solution for complex-1.
const CODES = { SAVE10: (s) => s * 0.9, FLAT5: (s) => s - 5 };

function applyDiscount(subtotal, code) {
    const rule = CODES[String(code).toUpperCase()];
    if (!rule) { throw new Error('unknown code'); }
    return Math.max(0, Math.round(rule(subtotal) * 100) / 100);
}

module.exports = { applyDiscount };
