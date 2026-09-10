import { Program } from "../../../resources.js";
import type { ProgramDescriptor } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import { WebGPUDevice } from "../WebGPUDevice.js";

export class WebGPUProgram extends Program {
  readonly gpuModule: GPUShaderModule;
  readonly vertexEntryPoint: string;
  readonly fragmentEntryPoint: string;

  constructor(device: WebGPUDevice, desc: ProgramDescriptor) {
    super(desc);
    assert(desc.wgsl, `program("${desc.label}") 缺少 wgsl 源码，无法在 WebGPU 后端使用`);
    this.vertexEntryPoint = desc.wgsl.vertexEntryPoint ?? "vs_main";
    this.fragmentEntryPoint = desc.wgsl.fragmentEntryPoint ?? "fs_main";
    this.gpuModule = device.gpu.createShaderModule({ label: desc.label, code: desc.wgsl.code });
    device.register(this);
    // 异步取回编译诊断（不阻塞创建，出错时尽快打印到控制台）
    this.gpuModule
      .getCompilationInfo()
      .then((info) => {
        if (info.messages.length > 0) {
          const lines = info.messages.map((m) => `  [${m.type}] ${m.message} (${m.lineNum ?? "?"}:${m.linePos ?? "?"})`);
          console.error(`[unidraw] WGSL 编译诊断 "${desc.label ?? "program"}":\n${lines.join("\n")}`);
        }
      })
      .catch(() => {});
  }

  protected destroyNative(): void {}
}
