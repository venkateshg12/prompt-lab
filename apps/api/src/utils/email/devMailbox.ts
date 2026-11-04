export interface DevMailEntry {
  to: string;
  subject: string;
  text: string;
  link?: string;
  token?: string;
  createdAt: Date;
}

export const devMailbox: DevMailEntry[] = [];
