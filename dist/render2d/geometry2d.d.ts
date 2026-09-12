import { Path2D } from "./path.js";
import type { DeviceRect } from "./types.js";
export declare function normalOffset(ax: number, ay: number, bx: number, by: number, hw: number): {
    x: number;
    y: number;
};
export declare function unitDir(ax: number, ay: number, bx: number, by: number): {
    x: number;
    y: number;
};
export declare function lineIntersect(ax: number, ay: number, dx1: number, dy1: number, bx: number, by: number, dx2: number, dy2: number): {
    x: number;
    y: number;
} | null;
export declare function intersectRects(a: DeviceRect, b: DeviceRect): DeviceRect;
export declare function sameClip(a: DeviceRect | null, b: DeviceRect | null): boolean;
export declare function detectRectContour(path: Path2D): [number, number, number, number] | null;
//# sourceMappingURL=geometry2d.d.ts.map