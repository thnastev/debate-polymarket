import { describe, it, expect } from 'vitest';
import { oddsText, returnsLine, effectiveOddsText, adminPercent } from './format';

describe('odds display (§9)', () => {
  it('shows two decimals below ×10', () => {
    expect(oddsText(0.25)).toBe('×4.00');
    expect(oddsText(0.38)).toBe('×2.63');
    expect(oddsText(0.5)).toBe('×2.00');
  });

  it('shows one decimal above ×10', () => {
    expect(oddsText(0.05)).toBe('×20.0');
    expect(oddsText(0.02)).toBe('×50.0');
  });

  it('shows ×99+ above 99', () => {
    expect(oddsText(0.001)).toBe('×99+');
    expect(oddsText(0)).toBe('×99+');
  });

  it('never emits a percentage', () => {
    for (const p of [0, 0.001, 0.25, 0.38, 0.999, 1]) {
      expect(oddsText(p)).not.toContain('%');
    }
  });

  it('gives the concrete returns line', () => {
    expect(returnsLine(0.38)).toBe('10 ƀ returns 26');
    expect(returnsLine(0.25)).toBe('10 ƀ returns 40');
  });

  it('effective odds are shares over stake, not the headline', () => {
    // 40 ƀ that buys 93.2 shares is ×2.33 to this trader even if the board
    // still reads ×2.55.
    expect(effectiveOddsText(93.2, 40)).toBe('×2.33');
    expect(effectiveOddsText(0, 40)).toBe('—');
  });

  it('adminPercent is the only thing here that prints a percentage', () => {
    expect(adminPercent(0.382)).toBe('38.2%');
  });
});
