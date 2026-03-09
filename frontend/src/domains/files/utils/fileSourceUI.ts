import { Cloud, Globe, Home, type LucideIcon } from 'lucide-react';
import { FILE_SOURCE_TYPE, PROVIDER_DISPLAY_NAME, PROVIDER_ACCENT_COLOR, PROVIDER_ID } from '@bc-agent/shared';

interface FileSourceUIConfig {
  Icon: LucideIcon;
  displayName: string;
  accentColor?: string;
}

const SOURCE_UI_MAP: Record<string, FileSourceUIConfig> = {
  [FILE_SOURCE_TYPE.ONEDRIVE]: {
    Icon: Cloud,
    displayName: PROVIDER_DISPLAY_NAME[PROVIDER_ID.ONEDRIVE],
    accentColor: PROVIDER_ACCENT_COLOR[PROVIDER_ID.ONEDRIVE],
  },
  [FILE_SOURCE_TYPE.SHAREPOINT]: {
    Icon: Globe,
    displayName: PROVIDER_DISPLAY_NAME[PROVIDER_ID.SHAREPOINT],
    accentColor: PROVIDER_ACCENT_COLOR[PROVIDER_ID.SHAREPOINT],
  },
};

const DEFAULT_SOURCE_UI: FileSourceUIConfig = { Icon: Home, displayName: 'Files' };

export function getFileSourceUI(sourceType: string | null): FileSourceUIConfig {
  if (!sourceType) return DEFAULT_SOURCE_UI;
  return SOURCE_UI_MAP[sourceType] ?? DEFAULT_SOURCE_UI;
}
