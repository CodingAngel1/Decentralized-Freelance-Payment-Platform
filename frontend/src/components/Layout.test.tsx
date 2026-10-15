import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Layout from "./Layout";

afterEach(() => cleanup());

describe("Layout", () => {
  it("wraps its children in the shared page container", () => {
    const { container } = render(
      <Layout>
        <h1>My Jobs</h1>
      </Layout>,
    );

    // Every route renders through here, so the container class is what gives the
    // app its page width and padding.
    const main = container.querySelector("main.page");
    expect(main).not.toBeNull();
    expect(main?.querySelector("h1")?.textContent).toBe("My Jobs");
  });
});
