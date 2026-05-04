import { NativeImage, WebContentsView } from "electron";
import { networkCapture } from "./cdp/network";
import { domainFor, getAugmentations } from "./memory/service";

export class Tab {
  private webContentsView: WebContentsView;
  private _id: string;
  private _title: string;
  private _url: string;
  private _isVisible: boolean = false;

  constructor(id: string, url: string = "https://www.google.com") {
    this._id = id;
    this._url = url;
    this._title = "New Tab";

    // Create the WebContentsView for web content only
    this.webContentsView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });

    // Set up event listeners
    this.setupEventListeners();

    // Attach the CDP-based network capture to this tab.
    // Done after webContents exists; safe to call before navigation.
    try {
      networkCapture.attachToWebContents(this.webContentsView.webContents, this._id);
    } catch (err) {
      console.warn("[tab] network capture attach failed:", (err as Error).message);
    }

    // Load the initial URL
    this.loadURL(url);
  }

  private setupEventListeners(): void {
    // Update title when page title changes
    this.webContentsView.webContents.on("page-title-updated", (_, title) => {
      this._title = title;
    });

    // Update URL when navigation occurs
    this.webContentsView.webContents.on("did-navigate", (_, url) => {
      this._url = url;
    });

    this.webContentsView.webContents.on("did-navigate-in-page", (_, url) => {
      this._url = url;
    });

    // Auto-replay any saved augmentations for this site once the page is fully
    // loaded. The user already approved each one when the agent originally
    // saved it, so this is consent-respecting.
    this.webContentsView.webContents.on("did-finish-load", () => {
      void this.replaySavedAugmentations();
    });
  }

  private async replaySavedAugmentations(): Promise<void> {
    try {
      const url = this.webContentsView.webContents.getURL();
      const domain = domainFor(url);
      if (!domain) return;
      const augmentations = getAugmentations(domain);
      if (augmentations.length === 0) return;
      // Run sequentially so later scripts can rely on earlier ones being
      // present in the DOM. Each script is wrapped in its own try so one
      // bad augmentation can't stop the rest.
      for (const aug of augmentations) {
        const expr = `(async () => { try { ${aug.script}\n } catch (e) { console.warn("[bb] augmentation ${JSON.stringify(aug.id)} failed:", e); } })()`;
        try {
          await this.webContentsView.webContents.executeJavaScript(expr, true);
        } catch (e) {
          console.warn(`[bb] augmentation ${aug.id} replay failed:`, (e as Error).message);
        }
      }
    } catch (e) {
      console.warn("[bb] replay scheduling failed:", (e as Error).message);
    }
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get title(): string {
    return this._title;
  }

  get url(): string {
    return this._url;
  }

  get isVisible(): boolean {
    return this._isVisible;
  }

  get webContents() {
    return this.webContentsView.webContents;
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }

  // Public methods
  show(): void {
    this._isVisible = true;
    this.webContentsView.setVisible(true);
  }

  hide(): void {
    this._isVisible = false;
    this.webContentsView.setVisible(false);
  }

  async screenshot(): Promise<NativeImage> {
    return await this.webContentsView.webContents.capturePage();
  }

  async runJs(code: string): Promise<any> {
    return await this.webContentsView.webContents.executeJavaScript(code);
  }

  async getTabHtml(): Promise<string> {
    return await this.runJs("document.documentElement.outerHTML");
  }

  async getTabText(): Promise<string> {
    return await this.runJs("document.documentElement.innerText");
  }

  loadURL(url: string): Promise<void> {
    this._url = url;
    return this.webContentsView.webContents.loadURL(url);
  }

  goBack(): void {
    if (this.webContentsView.webContents.navigationHistory.canGoBack()) {
      this.webContentsView.webContents.navigationHistory.goBack();
    }
  }

  goForward(): void {
    if (this.webContentsView.webContents.navigationHistory.canGoForward()) {
      this.webContentsView.webContents.navigationHistory.goForward();
    }
  }

  reload(): void {
    this.webContentsView.webContents.reload();
  }

  stop(): void {
    this.webContentsView.webContents.stop();
  }

  destroy(): void {
    this.webContentsView.webContents.close();
  }
}
