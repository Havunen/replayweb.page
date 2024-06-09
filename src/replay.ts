import { LitElement, html, css, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";

import { wrapCss } from "./misc";
import type { ItemType } from "./types";

// ===========================================================================
class Replay extends LitElement {
  @property({ type: Object })
  collInfo: ItemType | Record<string, never> | null = null;

  @property({ type: String })
  sourceUrl: string | null = null;

  // external url set from parent
  @property({ type: String })
  url = "";

  @property({ type: String })
  ts = "";

  // actual replay url
  @property({ type: String })
  replayUrl = "";

  @property({ type: String })
  replayTS = "";

  @property({ type: String })
  actualTS = "";

  @property({ type: String })
  title = "";

  @property({ type: String })
  iframeUrl: string | null = null;

  @property({ type: Boolean })
  showAuth = false;

  @property({ type: Object })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- requestPermission() type mismatch
  authFileHandle: any = null;

  private reauthWait: null | Promise<void> = null;

  private _loadPoll: null | number = null;

  firstUpdated() {
    window.addEventListener("message", (event) => this.onReplayMessage(event));
    // TODO: Fix this the next time the file is edited.
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    navigator.serviceWorker.addEventListener("message", (event) =>
      this.handleAuthMessage(event),
    );
  }

  // @ts-expect-error [// TODO: Fix this the next time the file is edited.] - TS7006 - Parameter 'event' implicitly has an 'any' type.
  async handleAuthMessage(event) {
    if (
      event.data.type === "authneeded" &&
      this.collInfo &&
      event.data.coll === this.collInfo.coll
    ) {
      if (event.data.fileHandle) {
        this.authFileHandle = event.data.fileHandle;
        try {
          if (
            (await this.authFileHandle.requestPermission({ mode: "read" })) ===
            "granted"
          ) {
            this.showAuth = false;
            this.reauthWait = null;
            this.refresh();
            return;
          }
        } catch (e) {
          console.warn(e);
        }
      } else {
        this.authFileHandle = null;
      }

      if (this.reauthWait) {
        await this.reauthWait;
      } else {
        this.showAuth = true;
      }
    }
  }

  doSetIframeUrl() {
    this.iframeUrl =
      this.url && this.collInfo
        ? `${this.collInfo.replayPrefix}/${this.ts || ""}mp_/${this.url}`
        : "";

    console.log(this.iframeUrl);
  }

  updated(changedProperties: PropertyValues<this>) {
    if (
      changedProperties.has("sourceUrl") ||
      changedProperties.has("collInfo")
    ) {
      this.reauthWait = null;
    }

    if (
      this.url &&
      (this.replayUrl != this.url || this.replayTS != this.ts) &&
      (changedProperties.has("url") || changedProperties.has("ts"))
    ) {
      this.replayUrl = this.url;
      this.replayTS = this.ts;
      this.showAuth = false;
      this.reauthWait = null;
      this.doSetIframeUrl();
    }

    if (this.iframeUrl && changedProperties.has("iframeUrl")) {
      this.waitForLoad();

      const detail = { title: "Archived Page", replayTitle: false };
      this.dispatchEvent(
        new CustomEvent("update-title", {
          bubbles: true,
          composed: true,
          detail,
        }),
      );
    }

    if (
      (this.replayUrl && changedProperties.has("replayUrl")) ||
      (this.replayTS && changedProperties.has("replayTS"))
    ) {
      const data = {
        url: this.replayUrl,
        ts: this.replayTS,
      };

      this.dispatchEvent(
        new CustomEvent("coll-tab-nav", { detail: { replaceLoc: true, data } }),
      );
    }

    if (
      this.title &&
      (changedProperties.has("title") || changedProperties.has("actualTS"))
    ) {
      const detail = {
        title: this.title,
        url: this.replayUrl,
        // send actual ts even if live
        ts: this.actualTS,

        replayTitle: true,
      };
      this.dispatchEvent(
        new CustomEvent("update-title", {
          bubbles: true,
          composed: true,
          detail,
        }),
      );
    }
  }

  setDisablePointer(disable: boolean) {
    const iframe = this.renderRoot.querySelector("iframe");

    if (iframe) {
      iframe.style.pointerEvents = disable ? "none" : "all";
    }
  }

  onReplayMessage(event: MessageEvent) {
    const iframe = this.renderRoot.querySelector("iframe");

    if (iframe && event.source === iframe.contentWindow) {
      if (
        event.data.wb_type === "load" ||
        event.data.wb_type === "replace-url"
      ) {
        this.replayTS = event.data.is_live ? "" : event.data.ts;
        this.actualTS = event.data.ts;
        this.replayUrl = event.data.url;
        this.title = event.data.title || this.title;
        this.clearLoading(iframe.contentWindow);

        if (event.data.icons) {
          const icons = event.data.icons;
          this.dispatchEvent(
            new CustomEvent("replay-favicons", {
              bubbles: true,
              composed: true,
              detail: { icons },
            }),
          );
        }
      } else if (event.data.wb_type === "title") {
        this.title = event.data.title;
      }
    }
  }

  // @ts-expect-error [// TODO: Fix this the next time the file is edited.] - TS7006 - Parameter 'event' implicitly has an 'any' type.
  onReAuthed(event) {
    this.reauthWait = (async () => {
      if (!this.authFileHandle) {
        // google drive reauth
        const headers = event.detail.headers;

        await fetch(`${this.collInfo!.apiPrefix}/updateAuth`, {
          method: "POST",
          body: JSON.stringify({ headers }),
        });
      } else {
        if (
          (await this.authFileHandle.requestPermission({ mode: "read" })) !==
          "granted"
        ) {
          this.reauthWait = null;
          return;
        }
        this.authFileHandle = null;
      }

      if (this.showAuth) {
        this.showAuth = false;
        this.reauthWait = null;
      }
      this.refresh();
    })();
  }

  waitForLoad() {
    this.setLoading();
    this._loadPoll = window.setInterval(() => {
      const iframe = this.renderRoot.querySelector("iframe");
      if (
        !iframe?.contentDocument ||
        !iframe.contentWindow ||
        (iframe.contentDocument.readyState === "complete" &&
          !(iframe.contentWindow as Window & { _WBWombat: unknown })._WBWombat)
      ) {
        this.clearLoading(iframe?.contentWindow);
      }
    }, 5000);
  }

  // @ts-expect-error [// TODO: Fix this the next time the file is edited.] - TS7006 - Parameter 'iframeWin' implicitly has an 'any' type.
  clearLoading(iframeWin) {
    this.dispatchEvent(
      new CustomEvent("replay-loading", { detail: { loading: false } }),
    );

    if (this._loadPoll) {
      window.clearInterval(this._loadPoll);
      this._loadPoll = null;
    }

    if (iframeWin) {
      iframeWin.addEventListener("beforeunload", () => {
        this.setLoading();
      });
    }
  }

  setLoading() {
    this.dispatchEvent(
      new CustomEvent("replay-loading", { detail: { loading: true } }),
    );
  }

  refresh() {
    const iframe = this.renderRoot.querySelector("iframe");

    if (!iframe) {
      return;
    }

    const oldIframeUrl = this.iframeUrl;
    // set iframe url to expected, refresh if same url
    this.doSetIframeUrl();
    if (oldIframeUrl === this.iframeUrl || this.url === this.replayUrl) {
      this.waitForLoad();
      iframe.contentWindow?.location.reload();
    }
  }

  static get styles() {
    return wrapCss(css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .iframe-container {
        position: relative;
        width: 100%;
        height: 100%;
        border: 0px;
      }

      .iframe-main {
        position: absolute;
        top: 0px;
        left: 0px;
        right: 0px;
        bottom: 0px;
        width: 100%;
        height: 100%;
      }

      .intro-panel .panel-heading {
        font-size: 1em;
        display: inline-block;
      }

      .iframe-main.modal-bg {
        z-index: 200;
        background-color: rgba(10, 10, 10, 0.7);
      }

      #wrlogo {
        vertical-align: middle;
      }

      .intro-panel .panel-block {
        padding: 1em;
        flex-direction: column;
        line-height: 2.5em;
      }

      div.intro-panel.panel {
        min-width: 40%;
        display: flex;
        flex-direction: column;
        margin: 3em;
        background-color: white;
      }
    `);
  }

  render() {
    return html`<iframe
      class="iframe-main"
      name="___wb_replay_top_frame"
      @message="${this.onReplayMessage}"
      allow="autoplay 'self'; fullscreen"
      allowfullscreen
      src="${this.iframeUrl as string}"
    ></iframe>`;
  }
}

customElements.define("wr-coll-replay", Replay);

export { Replay };
