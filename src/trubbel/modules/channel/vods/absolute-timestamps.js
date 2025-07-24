const { createElement, on, off } = FrankerFaceZ.utilities.dom;

import GET_VIDEO from "../../../utilities/graphql/video-info.gql";

export class AbsoluteTimestamps {
  constructor(parent) {
    this.parent = parent;
    this.isActive = false;
    this.timestampDisplay = null;
    this.vodStartTime = null;
    this.observer = null;
    this.currentTimeElement = null;

    this.initialize = this.initialize.bind(this);
    this.handleSettingChange = this.handleSettingChange.bind(this);
    this.handleNavigation = this.handleNavigation.bind(this);
    this.enableTimestampDisplay = this.enableTimestampDisplay.bind(this);
    this.disableTimestampDisplay = this.disableTimestampDisplay.bind(this);
    this.createTimestampDisplay = this.createTimestampDisplay.bind(this);
    this.setupObserver = this.setupObserver.bind(this);
    this.updateTimestamp = this.updateTimestamp.bind(this);
    this.getVideoStartTime = this.getVideoStartTime.bind(this);
    this.parseTimeToSeconds = this.parseTimeToSeconds.bind(this);
    this.cleanup = this.cleanup.bind(this);
  }

  initialize() {
    const enabled = this.parent.settings.get("addon.trubbel.channel.vods-absolute_timestamps");
    if (enabled) {
      this.handleNavigation();
    }
  }

  handleSettingChange(enabled) {
    if (enabled) {
      this.parent.log.info("[VOD Absolute Timestamps] Enabling absolute timestamps.");
      this.handleNavigation();
    } else {
      this.parent.log.info("[VOD Absolute Timestamps] Disabling absolute timestamps.");
      this.disableTimestampDisplay();
    }
  }

  async handleNavigation() {
    const currentRoute = this.parent.router?.current?.name;
    if (currentRoute === "video") {
      const enabled = this.parent.settings.get("addon.trubbel.channel.vods-absolute_timestamps");
      if (enabled && !this.isActive) {
        this.parent.log.info("[VOD Absolute Timestamps] Entering video page, enabling timestamps.");
        await this.waitForPlayerToLoad();
      }
    } else {
      if (this.isActive) {
        this.parent.log.info("[VOD Absolute Timestamps] Leaving video page, disabling timestamps.");
        this.disableTimestampDisplay();
      }
    }
  }

  async waitForPlayerToLoad() {
    try {
      await this.parent.site.awaitElement("[data-a-target=\"player-seekbar-current-time\"]", document.documentElement, 10000);
      await this.parent.site.awaitElement("[data-a-target=\"player-seekbar-duration\"]", document.documentElement, 5000);
      await this.parent.site.awaitElement(".video-player__container", document.documentElement, 5000);

      this.parent.log.info("[VOD Absolute Timestamps] Player elements found.");
      await this.getVideoStartTime();
      this.enableTimestampDisplay();
    } catch (error) {
      this.parent.log.warn("[VOD Absolute Timestamps] Failed to initialize:", error);
    }
  }

  async getVideoStartTime() {
    this.parent.log.info("[VOD Absolute Timestamps] Getting VOD start time.");
    const videoId = location.pathname.match(/\/videos\/(\d+)/);

    if (videoId) {
      const createdAt = await this.fetchTimestamp(videoId[1]);
      if (createdAt) {
        this.vodStartTime = new Date(createdAt);
      }
    }
    if (!this.vodStartTime) {
      this.parent.log.warn("[VOD Absolute Timestamps] Error getting VOD start time:", error);
    }
  }

  async fetchTimestamp(id) {
    try {
      const apollo = this.parent.site.apollo
      if (!apollo) {
        this.parent.log.error("[VOD Absolute Timestamps] Apollo client not resolved.");
        return null;
      }

      const query = GET_VIDEO;
      const variables = { id };

      const result = await apollo.client.query({
        query,
        variables,
      });

      return result?.data?.video?.createdAt;
    } catch (error) {
      this.parent.log.error(`[VOD Absolute Timestamps] Error fetching data:`, error);
      return null;
    }
  }

  async enableTimestampDisplay() {
    if (this.isActive) return;
    this.parent.log.info("[VOD Absolute Timestamps] Setting up timestamp display.");
    this.createTimestampDisplay();
    this.isActive = true;
    await this.setupObserver();
    this.updateCSS();
  }

  disableTimestampDisplay() {
    if (!this.isActive) return;
    this.parent.log.info("[VOD Absolute Timestamps] Cleaning up timestamp display.");
    this.cleanup();
    this.isActive = false;
    this.updateCSS();
  }

  createTimestampDisplay() {
    if (this.timestampDisplay) return;

    try {
      const durationElement = document.querySelector("[data-a-target=\"player-seekbar-duration\"]");

      this.timestampDisplay = createElement("p", {
        className: "vod-timestamp-display"
      });

      // Insert below the seekbar
      durationElement.parentElement.parentElement.insertAdjacentElement('beforeend', this.timestampDisplay);

      this.parent.log.info("[VOD Absolute Timestamps] Timestamp display created.");
    } catch (error) {
      this.parent.log.warn("[VOD Absolute Timestamps] Failed to create timestamp display:", error);
    }
  }

  parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const [hours, minutes, seconds] = timeStr.split(":").map(Number);
    return (hours * 3600) + (minutes * 60) + seconds;
  }

  updateTimestamp() {
    if (!this.timestampDisplay || !this.vodStartTime) return;

    try {
      if (!this.currentTimeElement) return;

      const currentTime = this.currentTimeElement.textContent.trim();
      const currentSeconds = this.parseTimeToSeconds(currentTime);

      const secondsSync = currentTime.split(":")[2]

      const actualDateTime = new Date(this.vodStartTime.getTime() + (currentSeconds * 1000));

      // fix desync from floating point calculation
      actualDateTime.setSeconds(secondsSync)

      const formattedDateTime = this.parent.i18n.formatDateTime(actualDateTime);;

      this.timestampDisplay.textContent = formattedDateTime;

    } catch (error) {
      this.parent.log.warn("[VOD Absolute Timestamps] Error updating timestamp:", error);
    }
  }

  async setupObserver() {
    if (this.observer) this.observer.disconnect();

    try {
      this.currentTimeElement = document.querySelector("[data-a-target=\"player-seekbar-current-time\"]");

      this.observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') {
            this.updateTimestamp();
          }
        }
      })

      this.observer.observe(this.currentTimeElement, {
        characterData: true,
        subtree: true
      });

      this.updateTimestamp();
    } catch (error) {
      this.parent.log.warn("[VOD Absolute Timestamps] Failed to find player current time for observer:", error);
    }
  }

  cleanup() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.timestampDisplay) {
      this.timestampDisplay.remove();
      this.timestampDisplay = null;
    }

    if (this.currentTimeElement) {
      this.currentTimeElement = null;
    }
  }

  updateCSS() {
    if (this.parent.settings.get("addon.trubbel.channel.vods-absolute_timestamps")) {
      this.parent.style.set("vod-absolute-timestamps", `
        .vod-timestamp-display {
          user-select: none;
          white-space: nowrap;
        }
      `);
    } else {
      this.parent.style.delete("vod-absolute-timestamps");
    }
  }
}
