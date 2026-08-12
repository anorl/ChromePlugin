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

  function classifyResult(title, message) {
    const text = `${title || ""} ${message || ""}`;

    // 这些错误不会因为换一个种子而消失，应暂停并交给用户处理。
    if (
      /猫粮.{0,8}不足|余额.{0,8}不足|达到.{0,8}上限|超过.{0,8}上限|无权限|请.{0,4}登录|登录.{0,4}失效|请求失败|操作.{0,4}频繁|稍后再试|验证码|封禁/i.test(
        text
      )
    ) {
      return "fatal";
    }

    // 认领具有竞争性。被别人抢先、条目失效等只跳过当前项。
    if (
      /已被.{0,12}认领|已经被.{0,12}认领|重复认领|无需重复|不存在|已失效|认领失败/i.test(
        text
      )
    ) {
      return "skip";
    }

    if (/失败|错误|不能|无法|不足|上限/i.test(text)) return "fatal";
    return "success";
  }

  root.PTClaimLogic = {
    DEFAULT_CONFIG,
    normalizeConfig,
    randomBetween,
    torrentIdFromUrl,
    classifyResult,
    looksLikeFailure(title, message) {
      return classifyResult(title, message) !== "success";
    }
  };
})(globalThis);
