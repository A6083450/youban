import { afterEach, expect, test } from "bun:test";

afterEach(async () => {
  const { authStore } = await import("../src/services/auth-store.ts");
  authStore.clear();
});

test("auth store notifies preference sync listeners when a session is restored or cleared", async () => {
  (globalThis as any).wx = {
    getStorageSync: (key: string) => {
      if (key === "youban.auth_token") return "restored-token";
      if (key === "youban.user") return {
        user_id: "restored-user", nickname: "微信用户", avatar_url: "/api/avatars/avatar.png", profile_complete: true,
      };
      return null;
    },
    setStorageSync: () => undefined,
    removeStorageSync: () => undefined,
  };
  const { authStore } = await import("../src/services/auth-store.ts");
  const states: boolean[] = [];
  const unsubscribe = authStore.subscribe((authenticated) => states.push(authenticated));

  authStore.restore();
  authStore.clear();
  unsubscribe();

  expect(states).toEqual([true, false]);
});

test("first WeChat login is persisted only after the chosen avatar is uploaded", async () => {
  const uploads: any[] = [];
  const storage = new Map<string, unknown>();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key) || "",
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    login: ({ success }: any) => success({ code: "wx-code" }),
    request: ({ success }: any) => success({
      statusCode: 200,
      data: {
        token: "wechat-session",
        user: { user_id: "wechat-user", nickname: "微信用户", avatar_url: null, profile_complete: false },
      },
    }),
    uploadFile: (options: any) => {
      uploads.push(options);
      expect(storage.has("youban.auth_token")).toBe(false);
      options.success({
        statusCode: 200,
        data: JSON.stringify({
          user: {
            user_id: "wechat-user",
            nickname: "微信用户",
            avatar_url: "/api/avatars/0123456789abcdef0123456789abcdef.png",
            profile_complete: true,
          },
        }),
      });
    },
  };
  const { authStore, resolveAvatarUrl } = await import("../src/services/auth-store.ts");

  await authStore.loginWithAvatar("wxfile://chosen-avatar");

  expect(uploads).toHaveLength(1);
  expect(authStore.isReady()).toBe(true);
  expect(storage.get("youban.auth_token")).toBe("wechat-session");
  expect(resolveAvatarUrl("/api/avatars/0123456789abcdef0123456789abcdef.png"))
    .toBe("https://youban.me/api/avatars/0123456789abcdef0123456789abcdef.png");
});

test("failed avatar upload clears the pending WeChat session", async () => {
  const storage = new Map<string, unknown>();
  const requests: any[] = [];
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key) || "",
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    login: ({ success }: any) => success({ code: "wx-code" }),
    request: (options: any) => {
      requests.push(options);
      if (options.url.endsWith("/api/auth/logout")) return options.success({ statusCode: 200, data: {} });
      return options.success({
        statusCode: 200,
        data: {
          token: "pending-session",
          user: { user_id: "wechat-user", nickname: "微信用户", avatar_url: null, profile_complete: false },
        },
      });
    },
    uploadFile: ({ success }: any) => success({ statusCode: 422, data: JSON.stringify({ detail: "头像无效" }) }),
  };
  const { authStore } = await import("../src/services/auth-store.ts");

  await expect(authStore.loginWithAvatar("wxfile://bad-avatar")).rejects.toThrow("头像无效");

  expect(authStore.isReady()).toBe(false);
  expect(storage.has("youban.auth_token")).toBe(false);
  expect(requests.some((item) => item.url.endsWith("/api/auth/logout"))).toBe(true);
});

test("avatar upload uses the authenticated file channel and updates the cached profile", async () => {
  const uploads: any[] = [];
  const storage = new Map<string, unknown>();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key) || "",
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    uploadFile: (options: any) => {
      uploads.push(options);
      options.success({
        statusCode: 200,
        data: JSON.stringify({
          user: {
            user_id: "wechat-user",
            nickname: "微信用户",
            avatar_url: "/api/avatars/0123456789abcdef0123456789abcdef.png",
            profile_complete: true,
          },
        }),
      });
    },
  };
  const { authStore } = await import("../src/services/auth-store.ts");
  authStore.token = "wechat-session";
  authStore.user = {
    user_id: "wechat-user", nickname: "微信用户", avatar_url: "/api/avatars/old.png", profile_complete: true,
  };

  const user = await authStore.uploadAvatar("wxfile://chosen-avatar");

  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatchObject({
    url: "https://youban.me/api/account/profile/avatar",
    filePath: "wxfile://chosen-avatar",
    name: "avatar",
    header: { Authorization: "Bearer wechat-session" },
  });
  expect(user.profile_complete).toBe(true);
  expect(authStore.user).toEqual(user);
});

test("secure production avatars can be displayed without a native download copy", async () => {
  const downloads: any[] = [];
  (globalThis as any).wx = {
    getStorageSync: () => "",
    setStorageSync: () => undefined,
    removeStorageSync: () => undefined,
    downloadFile: (options: any) => {
      downloads.push(options);
      options.success({ statusCode: 200, tempFilePath: "wxfile://cached-avatar.jpg" });
    },
  };
  const { authStore, resolveAvatarDisplayUrl } = await import("../src/services/auth-store.ts");
  authStore.token = "wechat-session";

  const avatarUrl = await resolveAvatarDisplayUrl("/api/avatars/local-http-avatar.jpg");

  expect(avatarUrl).toBe("https://youban.me/api/avatars/local-http-avatar.jpg");
  expect(downloads).toHaveLength(0);
});

test("does not route secure production avatars through the legacy HTTP fallback", async () => {
  (globalThis as any).wx = {
    getStorageSync: () => "",
    setStorageSync: () => undefined,
    removeStorageSync: () => undefined,
    downloadFile: ({ fail }: any) => fail(new Error("offline")),
  };
  const { resolveAvatarDisplayUrl } = await import("../src/services/auth-store.ts");

  await expect(resolveAvatarDisplayUrl("/api/avatars/unavailable-http-avatar.jpg"))
    .resolves.toBe("https://youban.me/api/avatars/unavailable-http-avatar.jpg");
});
