import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("interoDesktop", {
  platform: process.platform,
  runtimeVersion: process.versions.electron,
});
