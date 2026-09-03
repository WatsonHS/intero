import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  ipcMain,
  nativeImage,
  type IpcMainInvokeEvent,
  type NativeImage,
} from "electron";

import {
  parseDesktopNotifyRequest,
  type DesktopNotifyRequest,
} from "./notify-request.js";

interface DesktopSettings {
  closeToTray: boolean;
}

const defaultSettings: DesktopSettings = { closeToTray: false };

let tray: Tray | undefined;
let unreadCount = 0;
let settings: DesktopSettings = { ...defaultSettings };
let quitting = false;

export function registerDesktopNotificationBridge(input: {
  assertTrustedRenderer: (event: IpcMainInvokeEvent) => void;
}): void {
  ipcMain.removeHandler("intero:notify");
  ipcMain.removeHandler("intero:badge-count");
  ipcMain.removeHandler("intero:set-close-to-tray");
  ipcMain.removeHandler("intero:desktop-settings");
  ipcMain.handle("intero:notify", (event, payload: unknown) => {
    input.assertTrustedRenderer(event);
    showNativeNotification(parseDesktopNotifyRequest(payload));
  });
  ipcMain.handle("intero:badge-count", (event, count: unknown) => {
    input.assertTrustedRenderer(event);
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
      throw new Error("Unread count must be a non-negative number.");
    }
    setUnreadBadge(Math.floor(count));
  });
  ipcMain.handle(
    "intero:set-close-to-tray",
    async (event, enabled: unknown) => {
      input.assertTrustedRenderer(event);
      if (typeof enabled !== "boolean") {
        throw new Error("closeToTray must be a boolean.");
      }
      settings = { closeToTray: enabled };
      await persistSettings();
      return settings;
    },
  );
  ipcMain.handle("intero:desktop-settings", (event) => {
    input.assertTrustedRenderer(event);
    return settings;
  });
}

export async function loadDesktopSettings(): Promise<DesktopSettings> {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    settings = {
      closeToTray:
        parsed !== null &&
        typeof parsed === "object" &&
        (parsed as DesktopSettings).closeToTray === true,
    };
  } catch {
    settings = { ...defaultSettings };
  }
  return settings;
}

export function attachWindowCloseBehavior(window: BrowserWindow): void {
  window.on("close", (event) => {
    if (settings.closeToTray && !quitting) {
      event.preventDefault();
      window.hide();
    }
  });
}

export function markDesktopQuitting(): void {
  quitting = true;
}

export function createDesktopTray(): void {
  tray?.destroy();
  tray = new Tray(trayIcon(unreadCount > 0));
  tray.setToolTip("Intero");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show Intero",
        click: () => showMainWindow(),
      },
    ]),
  );
  tray.on("click", () => showMainWindow());
}

export function disposeDesktopTray(): void {
  tray?.destroy();
  tray = undefined;
}

function showNativeNotification(input: DesktopNotifyRequest): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: input.title,
    ...(input.body ? { body: input.body } : {}),
    silent: false,
  });
  notification.on("click", () => {
    const window = showMainWindow();
    window?.webContents.send("intero:notify-clicked", {
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
    });
  });
  notification.show();
}

function setUnreadBadge(count: number): void {
  unreadCount = count;
  if (process.platform === "win32") {
    for (const window of BrowserWindow.getAllWindows()) {
      if (count <= 0) {
        window.setOverlayIcon(null, "");
      } else {
        window.setOverlayIcon(badgeIcon(count), `${count} unread`);
      }
    }
  } else {
    app.setBadgeCount(count);
  }
  tray?.setImage(trayIcon(count > 0));
}

function showMainWindow(): BrowserWindow | undefined {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return undefined;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

function settingsPath(): string {
  return join(app.getPath("userData"), "desktop-settings.json");
}

async function persistSettings(): Promise<void> {
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
}

function trayIcon(unread: boolean): NativeImage {
  return bitmapIcon(unread ? [220, 64, 52] : [46, 125, 92]);
}

function badgeIcon(count: number): NativeImage {
  const image = bitmapIcon(count > 0 ? [220, 64, 52] : [46, 125, 92]);
  return image;
}

function bitmapIcon(rgb: [number, number, number]): NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const inside = dx * dx + dy * dy <= 7.2 * 7.2;
      const offset = (y * size + x) * 4;
      if (inside) {
        buffer[offset] = rgb[0];
        buffer[offset + 1] = rgb[1];
        buffer[offset + 2] = rgb[2];
        buffer[offset + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}
