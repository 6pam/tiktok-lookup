import axios from "axios";
import * as cheerio from "cheerio";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const formatNumber = (value: number) => {
  if (value >= 1000000) return (value / 1000000).toFixed(1) + "m";
  if (value >= 1000) return (value / 1000).toFixed(1) + "k";
  return value.toString();
};

function getFlagEmoji(countryCode: string) {
  if (!countryCode || countryCode.length !== 2) return "🏳️";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

const countryNames: Record<string, string> = {
  US: "United States", GB: "United Kingdom", IT: "Italy", FR: "France", DE: "Germany",
  JP: "Japan", CN: "China", IN: "India", BR: "Brazil", RU: "Russia", CA: "Canada",
  AU: "Australia", KR: "South Korea", ES: "Spain", AR: "Argentina", MX: "Mexico",
  TR: "Turkey", SA: "Saudi Arabia", AE: "United Arab Emirates", ID: "Indonesia",
  VN: "Vietnam", TH: "Thailand", MY: "Malaysia", PH: "Philippines", EG: "Egypt",
  DZ: "Algeria", MA: "Morocco",
};


const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "upgrade-insecure-requests": "1",
};

type UserDetail = { statusCode?: number; userInfo?: { user?: any; stats?: any } };

function extractUserDetail(html: string): UserDetail | null {
  const $ = cheerio.load(html);

 
  const rehydration = $("#__UNIVERSAL_DATA_FOR_REHYDRATION__").text();
  if (rehydration) {
    try {
      const detail = JSON.parse(rehydration)?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
      if (detail) return detail;
    } catch {
   
    }
  }


  let found: UserDetail | null = null;
  $("script").each((_, el) => {
    if (found) return;
    const text = $(el).text();
    if (!text.includes("userInfo")) return;
    try {
      const detail = JSON.parse(text)?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
      if (detail) found = detail;
    } catch {
  
    }
  });
  if (found) return found;

 
  const sigi = $("#SIGI_STATE").text();
  if (sigi) {
    try {
      const data = JSON.parse(sigi);
      const key = Object.keys(data?.UserModule?.users ?? {})[0];
      if (key) {
        return {
          statusCode: 0,
          userInfo: {
            user: data.UserModule.users[key],
            stats: data.UserModule.stats?.[key],
          },
        };
      }
    } catch {
    
    }
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawUsername = Array.isArray(req.query.username)
    ? req.query.username[0]
    : req.query.username;
  const cleanUsername = (rawUsername ?? "").replace(/^@/, "").trim();
  const debug = req.query.debug === "1";

  if (!/^[A-Za-z0-9._]{1,24}$/.test(cleanUsername)) {
    return res.status(400).json({ error: "Invalid username" });
  }

  try {
    const response = await axios.get(
      `https://www.tiktok.com/@${encodeURIComponent(cleanUsername)}`,
      {
        headers: BROWSER_HEADERS,
        timeout: 10000,
        responseType: "text",
        transformResponse: (d) => d, 
        validateStatus: () => true, 
      }
    );

    const html: string = typeof response.data === "string" ? response.data : "";
    const detail = html ? extractUserDetail(html) : null;

    if (debug) {
      console.log("[debug]", {
        status: response.status,
        htmlLength: html.length,
        hasRehydrationTag: html.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__"),
        statusCode: detail?.statusCode,
        userKeys: Object.keys(detail?.userInfo?.user ?? {}),
        regionRaw: detail?.userInfo?.user?.region,
      });
    }

    if (response.status !== 200) {
      return res.status(502).json({
        error: `TikTok returned HTTP ${response.status}`,
        blocked: true,
      });
    }

    if (!detail?.userInfo?.user) {
     
      const notFound = detail?.statusCode === 10202;
      return res.status(notFound ? 404 : 502).json({
        error: notFound
          ? "User not found"
          : "TikTok did not return profile data (likely bot protection)",
        statusCode: detail?.statusCode ?? null,
      });
    }

    const { user, stats = {} } = detail.userInfo;

    const regionCode: string | null =
      typeof user.region === "string" && /^[A-Za-z]{2}$/.test(user.region)
        ? user.region.toUpperCase()
        : null;

    const body: Record<string, unknown> = {
      username: user.uniqueId,
      nickname: user.nickname || "N/A",
      avatar: user.avatarLarger || user.avatarMedium || user.avatarThumb,
      bio: user.signature || "N/A",
      region: regionCode ?? "N/A",
      regionAvailable: regionCode !== null,
      countryName: regionCode ? countryNames[regionCode] ?? regionCode : "Unknown",
      countryCode: regionCode ?? "N/A",
      flag: regionCode ? getFlagEmoji(regionCode) : "🏳️",
      followers: formatNumber(stats.followerCount || 0),
      following: formatNumber(stats.followingCount || 0),
      likes: formatNumber(stats.heartCount || 0),
      videos: formatNumber(stats.videoCount || 0),
      profileUrl: `https://www.tiktok.com/@${user.uniqueId}`,
    };

    if (debug) {
      body._debug = {
        httpStatus: response.status,
        userKeys: Object.keys(user),
        regionRaw: user.region ?? null,
      };
    }

    return res.json(body);
  } catch (error: any) {
    console.error("Scraping error:", error.message);
    return res.status(500).json({ error: "Failed to fetch TikTok data." });
  }
}
