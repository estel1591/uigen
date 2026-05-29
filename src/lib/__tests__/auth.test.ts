// @vitest-environment node
import { test, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import { createSession, getSession, verifySession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode("development-secret-key");
const COOKIE_NAME = "auth-token";

beforeEach(() => {
  vi.clearAllMocks();
});

test("createSession sets an httpOnly cookie", async () => {
  await createSession("user-1", "test@example.com");

  expect(mockCookieStore.set).toHaveBeenCalledOnce();
  const [name, , options] = mockCookieStore.set.mock.calls[0];
  expect(name).toBe(COOKIE_NAME);
  expect(options.httpOnly).toBe(true);
  expect(options.sameSite).toBe("lax");
  expect(options.path).toBe("/");
});

test("createSession sets a cookie that expires in ~7 days", async () => {
  const before = Date.now();
  await createSession("user-1", "test@example.com");
  const after = Date.now();

  const [, , options] = mockCookieStore.set.mock.calls[0];
  const expires: Date = options.expires;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  expect(expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
  expect(expires.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
});

test("createSession stores a JWT containing userId and email", async () => {
  await createSession("user-42", "user@example.com");

  const [, token] = mockCookieStore.set.mock.calls[0];
  const { payload } = await jwtVerify(token, JWT_SECRET);
  expect(payload.userId).toBe("user-42");
  expect(payload.email).toBe("user@example.com");
});

test("createSession JWT is not secure in non-production environment", async () => {
  await createSession("user-1", "test@example.com");

  const [, , options] = mockCookieStore.set.mock.calls[0];
  expect(options.secure).toBe(false);
});

// --- getSession ---

async function makeToken(payload: Record<string, unknown>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(JWT_SECRET);
}

test("getSession returns null when no cookie is present", async () => {
  mockCookieStore.get.mockReturnValue(undefined);

  const session = await getSession();

  expect(session).toBeNull();
});

test("getSession returns session payload from a valid JWT cookie", async () => {
  const token = await makeToken({ userId: "user-7", email: "hello@example.com" });
  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();

  expect(session?.userId).toBe("user-7");
  expect(session?.email).toBe("hello@example.com");
});

test("getSession returns null for an invalid JWT", async () => {
  mockCookieStore.get.mockReturnValue({ value: "not.a.valid.token" });

  const session = await getSession();

  expect(session).toBeNull();
});

// --- verifySession ---

function makeRequest(token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["cookie"] = `auth-token=${token}`;
  return new NextRequest("http://localhost/", { headers });
}

test("verifySession returns null when request has no cookie", async () => {
  const session = await verifySession(makeRequest());

  expect(session).toBeNull();
});

test("verifySession returns session payload from a valid JWT cookie", async () => {
  const token = await makeToken({ userId: "user-99", email: "verify@example.com" });

  const session = await verifySession(makeRequest(token));

  expect(session?.userId).toBe("user-99");
  expect(session?.email).toBe("verify@example.com");
});

test("verifySession returns null for an invalid JWT cookie", async () => {
  const session = await verifySession(makeRequest("not.a.valid.token"));

  expect(session).toBeNull();
});
