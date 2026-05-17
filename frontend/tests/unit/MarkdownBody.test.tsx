/**
 * Tests for MarkdownBody render stability.
 *
 * The component is wrapped in `React.memo` so that re-parenting (e.g. a
 * chat list re-render) does not re-render every message body. For memo to
 * actually short-circuit, the props (`children` string) must be the only
 * input — `remarkPlugins` and `components` must NOT be re-created inline
 * on every render of the parent, because they're closed over by the
 * react-markdown subtree and would force its work to be redone.
 *
 * These tests assert:
 *   1. With the same `children` string, MarkdownBody's React.memo blocks
 *      re-render — verified by observing the inner Markdown component is
 *      not re-invoked.
 *   2. With a different `children` string, MarkdownBody re-renders.
 *   3. The hoisted REMARK_PLUGINS array and MARKDOWN_COMPONENTS object
 *      are exported (or at least referenced by stable identity), so the
 *      react-markdown subtree's memoization can take effect.
 */

import { describe, it, expect, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { MarkdownBody } from "../../src/components/chat/MarkdownBody";

// Spy on react-markdown's default export. If MarkdownBody's React.memo is
// honoring stable identity, the underlying Markdown component should NOT be
// invoked again when the parent re-renders with the same `children`.
let markdownInvocations = 0;
const markdownPropsHistory: { remarkPlugins?: unknown; components?: unknown }[] = [];
vi.mock("react-markdown", async () => {
  const actual = await vi.importActual<typeof import("react-markdown")>("react-markdown");
  return {
    ...actual,
    default: (props: { children: string; remarkPlugins?: unknown; components?: unknown }) => {
      markdownInvocations++;
      markdownPropsHistory.push({ remarkPlugins: props.remarkPlugins, components: props.components });
      // Render the actual Markdown component so the DOM still gets text.
      const Real = actual.default;
      return <Real {...props} />;
    },
  };
});

describe("MarkdownBody", () => {
  it("does not re-invoke the inner Markdown when the parent re-renders with the same children", () => {
    markdownInvocations = 0;

    function Harness() {
      const [, setTick] = useState(0);
      return (
        <div>
          <MarkdownBody>hello world</MarkdownBody>
          <button onClick={() => { setTick((t) => t + 1); }}>tick</button>
        </div>
      );
    }

    const { getByText } = render(<Harness />);

    const before = markdownInvocations;
    expect(before).toBeGreaterThan(0);

    // Force a parent re-render — the children prop to MarkdownBody is the
    // SAME string ("hello world"), so React.memo's default equality should
    // short-circuit and the Markdown inner component should NOT be
    // re-invoked.
    const btn = getByText("tick");
    act(() => { fireEvent.click(btn); });
    act(() => { fireEvent.click(btn); });
    act(() => { fireEvent.click(btn); });

    expect(markdownInvocations).toBe(before);
  });

  it("re-invokes Markdown when the children string changes", () => {
    markdownInvocations = 0;

    function Harness() {
      const [text, setText] = useState("initial-text");
      return (
        <div>
          <MarkdownBody>{text}</MarkdownBody>
          <button onClick={() => { setText("changed-text"); }}>change</button>
        </div>
      );
    }

    const { getByText, container } = render(<Harness />);
    expect(container.textContent).toContain("initial-text");

    // Reset invocation count, then trigger a real props change.
    markdownInvocations = 0;
    act(() => { fireEvent.click(getByText("change")); });

    // After the state change, MarkdownBody's children prop differs, so
    // React.memo's default equality must let the update through.
    expect(markdownInvocations).toBeGreaterThan(0);
    expect(container.textContent).toContain("changed-text");
  });

  it("renders markdown content (smoke test)", () => {
    const { container } = render(<MarkdownBody>{`**bold** and _italic_`}</MarkdownBody>);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("passes the same remarkPlugins and components references across distinct MarkdownBody instances", () => {
    // Hoisting REMARK_PLUGINS / MARKDOWN_COMPONENTS to module level means
    // every call site (and every re-render) hands react-markdown the SAME
    // array / object references. If they were inline literals in the JSX,
    // each render would build a fresh array+object pair, defeating
    // react-markdown's internal stability.
    markdownPropsHistory.length = 0;

    render(<MarkdownBody>{`one`}</MarkdownBody>);
    render(<MarkdownBody>{`two`}</MarkdownBody>);
    render(<MarkdownBody>{`three`}</MarkdownBody>);

    expect(markdownPropsHistory.length).toBe(3);
    // All renders must pass the SAME remarkPlugins array (by reference).
    expect(markdownPropsHistory[0].remarkPlugins).toBe(markdownPropsHistory[1].remarkPlugins);
    expect(markdownPropsHistory[1].remarkPlugins).toBe(markdownPropsHistory[2].remarkPlugins);
    // All renders must pass the SAME components object (by reference).
    expect(markdownPropsHistory[0].components).toBe(markdownPropsHistory[1].components);
    expect(markdownPropsHistory[1].components).toBe(markdownPropsHistory[2].components);
  });
});
