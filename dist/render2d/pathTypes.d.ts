import type { Pt2 } from "./matrix.js";
export type PathOp = {
    type: "move";
    x: number;
    y: number;
} | {
    type: "line";
    x: number;
    y: number;
} | {
    type: "quad";
    x1: number;
    y1: number;
    x: number;
    y: number;
} | {
    type: "cubic";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    x: number;
    y: number;
} | {
    type: "arc";
    cx: number;
    cy: number;
    r: number;
    a0: number;
    a1: number;
    ccw: boolean;
} | {
    type: "arcTo";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    r: number;
} | {
    type: "ellipse";
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    rot: number;
    a0: number;
    a1: number;
    ccw: boolean;
} | {
    type: "close";
};
/** 压平后的子路径 */
export interface Contour {
    points: Pt2[];
    closed: boolean;
}
export declare const TAU: number;
export declare function curveSteps(flatTolerance: number): number;
//# sourceMappingURL=pathTypes.d.ts.map