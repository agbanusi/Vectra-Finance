import { describe, expect, it } from "vitest";
import { bufferedGas } from "@/lib/gas";

describe("bufferedGas", () => {
  it("adds 25% headroom and never returns less than the estimate", () => {
    expect(bufferedGas(328_619n)).toBe(410_773n);
    expect(bufferedGas(330_088n) > 330_088n).toBe(true);
  });
});
