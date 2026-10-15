# Feature Specification: Discount codes

**Status**: Ready

## User Story 1 - Apply a discount code at checkout (Priority: P1)

A shopper enters a discount code and sees the subtotal after the discount.

**Acceptance Scenarios**:

1. **Given** a subtotal of 100 and code `SAVE10`, **When** the code is applied, **Then** the result is 90.
2. **Given** a subtotal of 20 and code `FLAT5`, **When** the code is applied, **Then** the result is 15.

## Functional Requirements

- **FR-001**: `applyDiscount(subtotal, code)` in `src/discount.js` returns the discounted subtotal.
- **FR-002**: `SAVE10` takes 10% off; `FLAT5` takes 5 off.
- **FR-003**: The result never goes below 0.
- **FR-004**: Codes are case-insensitive (`save10` equals `SAVE10`).
- **FR-005**: The result is rounded to cents (2 decimals).
- **FR-006**: An unknown code throws an `Error` whose message is `unknown code`.
