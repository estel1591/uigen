import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ToolCallBadge, getToolCallLabel } from "../ToolCallBadge";

afterEach(() => {
  cleanup();
});

// --- getToolCallLabel unit tests ---

test("getToolCallLabel: str_replace_editor create", () => {
  expect(getToolCallLabel("str_replace_editor", { command: "create", path: "src/App.tsx" })).toBe("Creating App.tsx");
});

test("getToolCallLabel: str_replace_editor str_replace", () => {
  expect(getToolCallLabel("str_replace_editor", { command: "str_replace", path: "src/Button.tsx" })).toBe("Editing Button.tsx");
});

test("getToolCallLabel: str_replace_editor insert", () => {
  expect(getToolCallLabel("str_replace_editor", { command: "insert", path: "src/styles.css" })).toBe("Editing styles.css");
});

test("getToolCallLabel: str_replace_editor view", () => {
  expect(getToolCallLabel("str_replace_editor", { command: "view", path: "src/index.ts" })).toBe("Reading index.ts");
});

test("getToolCallLabel: str_replace_editor undo_edit", () => {
  expect(getToolCallLabel("str_replace_editor", { command: "undo_edit", path: "src/helpers.ts" })).toBe("Undoing edit in helpers.ts");
});

test("getToolCallLabel: file_manager rename", () => {
  expect(getToolCallLabel("file_manager", { command: "rename", path: "src/old.tsx", new_path: "src/new.tsx" })).toBe("Renaming old.tsx → new.tsx");
});

test("getToolCallLabel: file_manager delete", () => {
  expect(getToolCallLabel("file_manager", { command: "delete", path: "src/temp.tsx" })).toBe("Deleting temp.tsx");
});

test("getToolCallLabel: unknown tool falls back to tool name", () => {
  expect(getToolCallLabel("some_unknown_tool", { command: "do_thing", path: "foo.ts" })).toBe("some_unknown_tool");
});

test("getToolCallLabel: uses basename of path, not full path", () => {
  expect(getToolCallLabel("str_replace_editor", { command: "create", path: "src/components/ui/Card.tsx" })).toBe("Creating Card.tsx");
});

// --- ToolCallBadge rendering tests ---

test("ToolCallBadge renders label in loading state", () => {
  render(
    <ToolCallBadge
      toolInvocation={{
        toolName: "str_replace_editor",
        args: { command: "create", path: "src/App.tsx" },
        state: "call",
      }}
    />
  );
  expect(screen.getByText("Creating App.tsx")).toBeDefined();
});

test("ToolCallBadge renders label in done state", () => {
  render(
    <ToolCallBadge
      toolInvocation={{
        toolName: "str_replace_editor",
        args: { command: "str_replace", path: "src/Button.tsx" },
        state: "result",
        result: "OK",
      }}
    />
  );
  expect(screen.getByText("Editing Button.tsx")).toBeDefined();
});

test("ToolCallBadge shows spinner when loading", () => {
  const { container } = render(
    <ToolCallBadge
      toolInvocation={{
        toolName: "str_replace_editor",
        args: { command: "create", path: "src/App.tsx" },
        state: "call",
      }}
    />
  );
  expect(container.querySelector(".animate-spin")).toBeDefined();
  expect(container.querySelector(".bg-emerald-500")).toBeNull();
});

test("ToolCallBadge shows green dot when done", () => {
  const { container } = render(
    <ToolCallBadge
      toolInvocation={{
        toolName: "str_replace_editor",
        args: { command: "create", path: "src/App.tsx" },
        state: "result",
        result: "Success",
      }}
    />
  );
  expect(container.querySelector(".bg-emerald-500")).toBeDefined();
  expect(container.querySelector(".animate-spin")).toBeNull();
});
