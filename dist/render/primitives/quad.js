// ---------------------------------------------------------------------------
// 基础：轴向面 / 立方体
// ---------------------------------------------------------------------------
/**
 * 生成一个轴向面（两个三角形）并追加到 positions/normals/uvs。
 *
 * @param axis 面法线所在轴
 * @param sign 面朝向（+1 / -1）
 * @param w 面在「第一个切向轴」上的尺寸
 * @param h 面在「第二个切向轴」上的尺寸
 * @param axisOffset 面沿自身轴向到原点的距离（立方体=半边长；平面=0）
 */
export function quadFace(axis, sign, w, h, positions, normals, uvs, axisOffset = 0) {
    const halfW = w / 2;
    const halfH = h / 2;
    const d = sign * axisOffset;
    const corners = axis === "x"
        ? [
            [d, -halfH, -halfW],
            [d, halfH, -halfW],
            [d, halfH, halfW],
            [d, -halfH, halfW],
        ]
        : axis === "y"
            ? [
                [-halfW, d, -halfH],
                [halfW, d, -halfH],
                [halfW, d, halfH],
                [-halfW, d, halfH],
            ]
            : [
                [-halfW, -halfH, d],
                [halfW, -halfH, d],
                [halfW, halfH, d],
                [-halfW, halfH, d],
            ];
    const outward = axis === "x" ? [sign, 0, 0] : axis === "y" ? [0, sign, 0] : [0, 0, sign];
    const p0 = corners[0];
    const p1 = corners[1];
    const p2 = corners[2];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const dot = cross[0] * outward[0] + cross[1] * outward[1] + cross[2] * outward[2];
    const flip = dot < 0;
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
        const [cx, cy, cz] = corners[i];
        positions.push(cx, cy, cz);
        normals.push(outward[0], outward[1], outward[2]);
        const u = i === 0 || i === 3 ? 0 : 1;
        const v = i === 0 || i === 1 ? 0 : 1;
        uvs.push(u, 1 - v);
    }
    if (!flip) {
        return [base, base + 1, base + 2, base, base + 2, base + 3];
    }
    return [base, base + 3, base + 2, base, base + 2, base + 1];
}
//# sourceMappingURL=quad.js.map