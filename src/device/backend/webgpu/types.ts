
// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------
export interface WebGPUDeviceOptions {
  powerPreference?: GPUPowerPreference;
  /** 覆盖自动获取的画布格式 */
  forceCanvasFormat?: GPUTextureFormat;
  label?: string;
}
