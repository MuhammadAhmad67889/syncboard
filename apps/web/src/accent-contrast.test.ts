// Guards the accent-button contrast fix: light text on a filled
// accent surface must reach WCAG AA (4.5:1) in every theme.
// The plain --color-accent stays light for text on paper, so filled
// surfaces use --color-accent-solid instead — this test reads the
// real values out of tokens.css, so a future token change that
// breaks the ratio fails here instead of shipping.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function hexLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function oklchLuminance(lightness: number, chroma: number, hue: number): number {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s = lightness - 0.0894841775 * a - 1.2914855480 * b;
  const [lr, mg, sb] = [l, m, s].map((v) => v ** 3);
  const r = +4.0767416621 * lr - 3.3077115913 * mg + 0.2309699292 * sb;
  const g = -1.2684380046 * lr + 2.6097574011 * mg - 0.3413193965 * sb;
  const bl = -0.0041960863 * lr - 0.7034186147 * mg + 1.7076147010 * sb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function luminance(value: string): number {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return hexLuminance(hex[0]);
  const oklch = value.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (oklch) {
    return oklchLuminance(
      parseFloat(oklch[1]) / 100,
      parseFloat(oklch[2]),
      parseFloat(oklch[3]),
    );
  }
  throw new Error(`Cannot read colour value: ${value}`);
}

function contrastRatio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function themeBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Missing theme block: ${selector}`);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing token --${name}`);
  return match[1].trim();
}

function resolve(value: string, block: string): string {
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(token(block, ref[1]), block) : value;
}

describe("accent-solid contrast (WCAG AA 4.5:1)", () => {
  const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
  const themes: [string, string][] = [
    ["Dose", ":root {"],
    ["Dark", '[data-theme="dark"] {'],
    ["Light", '[data-theme="light"] {'],
  ];

  for (const [name, selector] of themes) {
    it(`${name}: accent-ink on accent-solid passes 4.5:1`, () => {
      const block = themeBlock(css, selector);
      const solid = resolve(token(block, "color-accent-solid"), block);
      const ink = resolve(token(block, "color-accent-ink"), block);
      expect(contrastRatio(ink, solid)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
