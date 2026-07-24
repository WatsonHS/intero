import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("interoDesktop", {
  platform: process.platform,
  runtimeVersion: process.versions.electron,
  getLocalStatus: () => ipcRenderer.invoke("intero:local-status"),
  setModelEgress: (mode: "managed_api" | "user_provided_api" | "disabled") =>
    ipcRenderer.invoke("intero:set-model-egress", mode),
});
