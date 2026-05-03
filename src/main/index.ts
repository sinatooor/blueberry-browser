import { app, BrowserWindow, session } from "electron";
import { electronApp } from "@electron-toolkit/utils";
import { Window } from "./Window";
import { AppMenu } from "./Menu";
import { EventManager } from "./EventManager";
import { initProjectStore } from "./projects/store";
import { registerWorkbenchIpc, getActiveProjectId } from "./ipc/handlers";
import { attachDownloadRouter, bindDownloadRouter } from "./downloads/router";
import { createPyodideHost, warmupPyodide } from "./code/pyodide-host";
import { networkCapture } from "./cdp/network";

let mainWindow: Window | null = null;
let eventManager: EventManager | null = null;
let menu: AppMenu | null = null;

const createWindow = (): Window => {
  const window = new Window();
  menu = new AppMenu(window);
  eventManager = new EventManager(window);

  registerWorkbenchIpc(window);

  // Tell the network capture which tab/project is active so persistence
  // is scoped correctly.
  const updateActive = (): void => {
    const tab = window.activeTab;
    if (tab) networkCapture.setActiveTab(tab.id, getActiveProjectId() ?? undefined);
  };
  updateActive();
  // Hook into tab switches by polling on a short cadence (cheap; off the hot path).
  setInterval(updateActive, 500);

  return window;
};

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.electron");

  // Initialize SQLite store once so handlers and routers can rely on it.
  initProjectStore();

  // Smart downloads: rewrite save paths into project sandboxes.
  bindDownloadRouter({
    getActiveProjectId: () => getActiveProjectId(),
    emit: (channel, payload) => {
      mainWindow?.sidebar.view.webContents.send(channel, payload);
    },
  });
  attachDownloadRouter(session.defaultSession);

  mainWindow = createWindow();

  // Warm up Pyodide in the background so the first run is fast.
  createPyodideHost();
  setTimeout(() => {
    void warmupPyodide();
  }, 1200);

  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (eventManager) {
    eventManager.cleanup();
    eventManager = null;
  }

  // Clean up references
  if (mainWindow) {
    mainWindow = null;
  }
  if (menu) {
    menu = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
