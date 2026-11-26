export interface Member {
  slug: string;
  name: string;
  status: 'live' | 'planned';
  path: string;
  pkg: string;
  milestone: string;
  summary: string;
  gradedBy: string;
}
export declare const SITE: { origin: string; base: string; repo: string; name: string; tagline: string };
export declare const HUB_PATH: string;
export declare const MEMBERS: Member[];
export declare const appPath: (member: Member) => string;
export declare const hubPagePath: (member: Member) => string;
