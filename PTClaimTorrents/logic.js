(function (root) {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    minActionDelayMs: 650,
    maxActionDelayMs: 1200,
    minTorrentDelayMs: 3000,
    maxTorrentDelayMs: 5500
  });

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function normalizeConfig(config) {
    const source = config || {};
    const minActionDelayMs = clampNumber(
      source.minActionDelayMs,
      250,
      10000,
      DEFAULT_CONFIG.minActionDelayMs
    );
    const maxActionDelayMs = Math.max(
      minActionDelayMs,
      clampNumber(source.maxActionDelayMs, 250, 15000, DEFAULT_CONFIG.maxActionDelayMs)
    );
    const minTorrentDelayMs = clampNumber(
      source.minTorrentDelayMs,
      1000,
      60000,
      DEFAULT_CONFIG.minTorrentDelayMs
    );
    const maxTorrentDelayMs = Math.max(
      minTorrentDelayMs,
      clampNumber(source.maxTorrentDelayMs, 1000, 120000, DEFAULT_CONFIG.maxTorrentDelayMs)
    );

    return { minActionDelayMs, maxActionDelayMs, minTorrentDelayMs, maxTorrentDelayMs };
  }

  function randomBetween(min, max, randomValue) {
    const low = Math.ceil(Math.min(min, max));
    const high = Math.floor(Math.max(min, max));
    const random = Number.isFinite(randomValue) ? randomValue : Math.random();
    return Math.floor(random * (high - low + 1)) + low;
  }

  function torrentIdFromUrl(url) {
    if (!url) return null;
    try {
      return new URL(url, "https://pterclub.net/").searchParams.get("add_torrent_id");
    } catch (_) {
      return null;
    }
  }

  function looksLikeFailure(title, message) {
    return /失败|错误|请求失败|不足|不能|无法|上限|已被.{0,4}认领|不存在|无权限/i.test(
      `${title || ""} ${message || ""}`
    );
  }

  root.PTClaimLogic = {
    DEFAULT_CONFIG,
    normalizeConfig,
    randomBetween,
    torrentIdFromUrl,
    looksLikeFailure
  };
})(globalThis);
