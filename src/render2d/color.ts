import { Color } from "../math/color.js";

export interface GradientStop {
  offset: number; // 0..1
  color: Color;
}

export function hexColor(hex: string): Color {
  const c = new Color(1, 1, 1, 1);
  if (hex.startsWith("#")) c.setHex(hex);
  else if (hex.startsWith("rgba(")) c.setHex("#ffffff");
  else c.setHex("#" + hex.replace(/^#/, ""));
  return c;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}
