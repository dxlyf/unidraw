import type { GeometryData } from "../Geometry.js";
/** radiusTop=0 即圆锥；openEnded 可去掉上下盖。 */
export declare function cylinder(radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number, heightSegments?: number, openEnded?: boolean): GeometryData;
/** 圆锥（顶点朝上 +Y） */
export declare function cone(radius?: number, height?: number, radialSegments?: number): GeometryData;
//# sourceMappingURL=cylinder.d.ts.map