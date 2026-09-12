import { quadFace } from "./quad.js";
/**
 * 立方体：宽/高/深（以原点为中心，各面位于 ±半边长处）。
 */
export function box(width = 1, height = 1, depth = 1) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    // [轴, 朝向, 面内第一切向尺寸, 面内第二切向尺寸, 沿轴到原点的距离]
    const faces = [
        ["x", 1, depth, height, width / 2],
        ["x", -1, depth, height, width / 2],
        ["y", 1, width, depth, height / 2],
        ["y", -1, width, depth, height / 2],
        ["z", 1, width, height, depth / 2],
        ["z", -1, width, height, depth / 2],
    ];
    for (const [axis, sign, w, h, offset] of faces) {
        indices.push(...quadFace(axis, sign, w, h, positions, normals, uvs, offset));
    }
    return { positions, normals, uvs, indices };
}
//# sourceMappingURL=box.js.map