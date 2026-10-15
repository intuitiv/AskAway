// Hidden check for complex-1: every functional requirement of specs/001-discount-codes.
const path = require('node:path');

module.exports = (dir) => {
    const { applyDiscount } = require(path.join(dir, 'src', 'discount.js'));
    const throwsUnknown = () => { try { applyDiscount(10, 'NOPE'); return false; } catch (error) { return error.message === 'unknown code'; } };
    return [
        ['FR-002 SAVE10', () => applyDiscount(100, 'SAVE10') === 90],
        ['FR-002 FLAT5', () => applyDiscount(20, 'FLAT5') === 15],
        ['FR-003 never below 0', () => applyDiscount(3, 'FLAT5') === 0],
        ['FR-004 case-insensitive', () => applyDiscount(50, 'save10') === 45],
        ['FR-005 rounded to cents', () => applyDiscount(19.99, 'SAVE10') === 17.99],
        ['FR-006 unknown code throws', throwsUnknown],
    ];
};
