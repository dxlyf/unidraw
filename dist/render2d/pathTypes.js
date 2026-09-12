export const TAU = Math.PI * 2;
export function curveSteps(flatTolerance) {
    // 容差越小采样越多；至少 4 段
    return Math.max(4, Math.ceil((Math.PI / 2) * Math.sqrt(1 / Math.max(1e-6, flatTolerance))));
}
//# sourceMappingURL=pathTypes.js.map