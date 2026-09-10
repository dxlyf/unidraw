import { BindGroup } from "../../../resources.js";
import type { BindGroupDescriptor } from "../../../descriptors.js";
import { assert } from "../../../../util/assert.js";
import { MockDevice } from "../MockDevice.js";
import { assertResourceType } from "../gpuUtils.js";

export class MockBindGroup extends BindGroup {
  constructor(device: MockDevice, desc: BindGroupDescriptor) {
    super(desc);
    const byBinding = new Map(desc.layout.entries.map((e) => [e.binding, e]));
    for (const entry of desc.entries) {
      const layout = byBinding.get(entry.binding);
      assert(layout, `bind group 包含布局未声明的 binding=${entry.binding}`);
      assertResourceType(layout.type, entry.resource, entry.binding);
    }
    device.register(this);
  }
  protected destroyNative(): void {}
}
