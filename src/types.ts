export interface LinkConfig {
  targetUrl: string;
  title: string;
  description: string;
  imageUrl?: string;
}

export interface ClickRecord {
  id: string;
  slug: string;
  targetUrl: string;
  timestamp: string;
  ip: string;
  referrer: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  userAgent: string;
  isBot: boolean;
}
